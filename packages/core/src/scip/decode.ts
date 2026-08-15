/**
 * A minimal protobuf wire-format reader.
 *
 * ## Why this exists at all
 *
 * SCIP — Sourcegraph's Code Intelligence Protocol — is a protobuf schema. Sprang
 * reads a SCIP index, when a project happens to have one, purely to *upgrade* the
 * name-matched guesses in its call graph into compiler-accurate facts. That is an
 * **optional enrichment and is never required**: the tree-sitter and regex passes
 * remain the floor, and everything Sprang promises still works on a bare
 * `git clone` with no toolchain, no dependencies installed and no index present.
 *
 * Pulling in `protobufjs` (and a generated schema, and a codegen step) to serve an
 * optional path would be a heavy, permanent dependency for an occasional win. The
 * subset of the wire format SCIP actually uses is small enough to read directly,
 * so this file reads it directly.
 *
 * ## The wire format, in enough detail to extend this
 *
 * A protobuf message is a flat, self-delimiting sequence of fields. There is no
 * header, no length prefix and no field ordering guarantee. Each field is:
 *
 * ```text
 *   key = varint( (fieldNumber << 3) | wireType )
 *   payload = depends on wireType
 * ```
 *
 * A **varint** is a base-128 little-endian integer: each byte contributes 7 bits
 * of payload in its low bits, and its high bit (0x80) is a continuation flag. So
 * `0x96 0x01` is `(0x16) | (0x01 << 7)` = 150.
 *
 * The wire types:
 *
 * | # | Name             | Payload                                    |
 * |---|------------------|--------------------------------------------|
 * | 0 | varint           | a varint (int32/int64/uint/bool/enum)       |
 * | 1 | 64-bit           | exactly 8 bytes, little-endian              |
 * | 2 | length-delimited | varint length, then that many bytes         |
 * | 3 | start group      | **deprecated** — rejected here              |
 * | 4 | end group        | **deprecated** — rejected here              |
 * | 5 | 32-bit           | exactly 4 bytes, little-endian              |
 *
 * Wire type 2 carries strings, `bytes`, nested messages *and* packed repeated
 * scalars — the wire cannot tell them apart. Interpretation is the schema's job,
 * which is why this decoder hands back raw bytes and leaves
 * {@link asString} / {@link asMessage} / {@link decodePackedVarints} to the caller
 * that knows the schema (see `ingest.ts`).
 *
 * Two consequences of that flatness matter when extending this:
 *
 * 1. **Repeated fields are just the same field number appearing more than once.**
 *    Hence {@link fieldsByNumber} returns an array per number, never a single
 *    value. A `repeated int32` may arrive either packed (one length-delimited
 *    field) or unpacked (many wire-type-0 fields); readers must accept both.
 * 2. **Unknown field numbers are skipped, not errors.** A newer indexer writing
 *    fields this code has never heard of must still parse. Only structurally
 *    impossible input throws.
 *
 * ## Safety
 *
 * Every read is bounds-checked, varints are capped at 10 bytes (the maximum for a
 * 64-bit value) and group wire types are rejected rather than skipped. A
 * truncated file, a gzip archive, a PNG or a text file fed to this decoder throws
 * {@link ScipDecodeError} promptly; it can never hang, loop or read past the end
 * of the buffer.
 */

/** Thrown for any malformed, truncated or non-protobuf input. */
export class ScipDecodeError extends Error {
  /** Byte offset at which decoding gave up, when known. */
  readonly offset: number;

  constructor(message: string, offset = -1) {
    super(offset >= 0 ? `${message} (at byte ${offset})` : message);
    this.name = 'ScipDecodeError';
    this.offset = offset;
  }
}

/** Wire type 0: base-128 varint. */
export const WIRE_VARINT = 0;
/** Wire type 1: fixed 8 bytes. */
export const WIRE_FIXED64 = 1;
/** Wire type 2: varint length prefix, then that many bytes. */
export const WIRE_LENGTH_DELIMITED = 2;
/** Wire type 5: fixed 4 bytes. */
export const WIRE_FIXED32 = 5;

/** Maximum bytes a valid varint may occupy (64 bits / 7 bits per byte, rounded up). */
export const MAX_VARINT_BYTES = 10;

/**
 * One decoded field.
 *
 * `value` is shaped by `wireType`, and only by it:
 * - wire type 0 → `bigint` (unsigned; the schema decides how to reinterpret it)
 * - wire type 1 → `bigint` (raw little-endian 64 bits)
 * - wire type 2 → `Uint8Array` (a view into the source buffer, not a copy)
 * - wire type 5 → `number` (raw little-endian 32 bits, unsigned)
 */
export interface ProtoField {
  fieldNumber: number;
  wireType: number;
  value: bigint | Uint8Array | number;
}

/**
 * Read one base-128 varint.
 *
 * Returns the value and the offset just past it, so callers can thread the
 * offset through a loop. Throws when the buffer ends mid-varint or when the
 * continuation bit is still set after {@link MAX_VARINT_BYTES} bytes — the latter
 * is the difference between "reject junk" and "spin forever on a 0xFF run".
 */
export function decodeVarint(buf: Uint8Array, offset: number): { value: bigint; offset: number } {
  if (offset < 0) throw new ScipDecodeError('negative offset', offset);
  let result = 0n;
  let shift = 0n;
  let pos = offset;
  for (let i = 0; i < MAX_VARINT_BYTES; i++) {
    const byte = buf[pos];
    if (byte === undefined) {
      throw new ScipDecodeError('truncated varint: buffer ended mid-value', pos);
    }
    pos += 1;
    result |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return { value: result, offset: pos };
    shift += 7n;
  }
  throw new ScipDecodeError(
    `varint exceeds ${MAX_VARINT_BYTES} bytes; input is not valid protobuf`,
    offset,
  );
}

function readFixed(buf: Uint8Array, offset: number, width: number): bigint {
  if (offset + width > buf.length) {
    throw new ScipDecodeError(`truncated ${width * 8}-bit value`, offset);
  }
  let value = 0n;
  for (let i = width - 1; i >= 0; i--) {
    const byte = buf[offset + i];
    // Unreachable given the bounds check above; kept for noUncheckedIndexedAccess.
    if (byte === undefined) throw new ScipDecodeError('truncated fixed-width value', offset + i);
    value = (value << 8n) | BigInt(byte);
  }
  return value;
}

/**
 * Decode an entire message into its flat list of fields, in wire order.
 *
 * Order is preserved because repeated fields carry meaning by position (a
 * document's occurrences, for instance). Unknown field numbers are returned
 * rather than dropped — the caller ignores what it does not understand.
 *
 * An empty buffer is a valid, empty message and yields `[]`.
 */
export function decodeMessage(buf: Uint8Array): ProtoField[] {
  const fields: ProtoField[] = [];
  let offset = 0;
  while (offset < buf.length) {
    const start = offset;
    const key = decodeVarint(buf, offset);
    offset = key.offset;
    const wireType = Number(key.value & 0x7n);
    const fieldNumber = Number(key.value >> 3n);
    if (fieldNumber === 0) {
      throw new ScipDecodeError('field number 0 is not valid protobuf', start);
    }
    if (wireType === 3 || wireType === 4) {
      // Groups were removed from proto3. Skipping them correctly requires
      // tracking nesting depth to a matching end-group tag; guessing instead
      // risks an unterminated loop, so this is a hard stop.
      throw new ScipDecodeError(
        `deprecated group wire type ${wireType} is not supported`,
        start,
      );
    }
    if (wireType === WIRE_VARINT) {
      const v = decodeVarint(buf, offset);
      offset = v.offset;
      fields.push({ fieldNumber, wireType, value: v.value });
      continue;
    }
    if (wireType === WIRE_FIXED64) {
      fields.push({ fieldNumber, wireType, value: readFixed(buf, offset, 8) });
      offset += 8;
      continue;
    }
    if (wireType === WIRE_FIXED32) {
      fields.push({ fieldNumber, wireType, value: Number(readFixed(buf, offset, 4)) });
      offset += 4;
      continue;
    }
    if (wireType === WIRE_LENGTH_DELIMITED) {
      const lenField = decodeVarint(buf, offset);
      offset = lenField.offset;
      // A length larger than the file cannot be honoured, and a length large
      // enough to overflow Number would silently slice nothing at all.
      if (lenField.value > BigInt(buf.length)) {
        throw new ScipDecodeError(
          `length-delimited field claims ${lenField.value} bytes, buffer has ${buf.length}`,
          start,
        );
      }
      const len = Number(lenField.value);
      if (offset + len > buf.length) {
        throw new ScipDecodeError('truncated length-delimited field', start);
      }
      fields.push({ fieldNumber, wireType, value: buf.subarray(offset, offset + len) });
      offset += len;
      continue;
    }
    throw new ScipDecodeError(`unknown wire type ${wireType}`, start);
  }
  return fields;
}

/**
 * Group fields by field number, preserving wire order within each group.
 *
 * Always an array per number: protobuf represents `repeated` as recurrence, and
 * a non-repeated field may legally appear twice (last one wins, per the spec —
 * that policy is left to the caller, which can just read the last element).
 */
export function fieldsByNumber(fields: ProtoField[]): Map<number, ProtoField[]> {
  const out = new Map<number, ProtoField[]>();
  for (const field of fields) {
    const bucket = out.get(field.fieldNumber);
    if (bucket === undefined) out.set(field.fieldNumber, [field]);
    else bucket.push(field);
  }
  return out;
}

const utf8 = new TextDecoder('utf-8');

/**
 * Interpret a length-delimited field as a UTF-8 string.
 *
 * Invalid UTF-8 is replaced rather than thrown on: a mangled symbol name is a
 * bad enrichment, not a reason to abandon an otherwise good index.
 */
export function asString(field: ProtoField): string {
  if (!(field.value instanceof Uint8Array)) {
    throw new ScipDecodeError(
      `field ${field.fieldNumber} has wire type ${field.wireType}; expected length-delimited for a string`,
    );
  }
  return utf8.decode(field.value);
}

/** Interpret a length-delimited field as a nested message and decode it. */
export function asMessage(field: ProtoField): ProtoField[] {
  if (!(field.value instanceof Uint8Array)) {
    throw new ScipDecodeError(
      `field ${field.fieldNumber} has wire type ${field.wireType}; expected length-delimited for a message`,
    );
  }
  return decodeMessage(field.value);
}

/**
 * Interpret a numeric field as a JavaScript number.
 *
 * Accepts wire types 0, 1 and 5 — everything that can carry a scalar. Values
 * beyond `Number.MAX_SAFE_INTEGER` are rejected instead of being silently
 * rounded; nothing in SCIP (line numbers, enum kinds, role bitfields) comes
 * anywhere near that, so a huge value means the field was misread.
 */
export function asNumber(field: ProtoField): number {
  if (typeof field.value === 'number') return field.value;
  if (typeof field.value === 'bigint') {
    if (field.value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new ScipDecodeError(`field ${field.fieldNumber} value exceeds safe integer range`);
    }
    return Number(field.value);
  }
  throw new ScipDecodeError(
    `field ${field.fieldNumber} has wire type ${field.wireType}; expected a scalar`,
  );
}

/**
 * Read a packed repeated varint field (wire type 2 holding back-to-back varints).
 *
 * Used for SCIP `Occurrence.range`. Note that a producer is free to emit the
 * same field unpacked, as repeated wire-type-0 fields, so callers must handle
 * both shapes; see `readRange` in `ingest.ts`.
 */
export function decodePackedVarints(bytes: Uint8Array): bigint[] {
  const out: bigint[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    const v = decodeVarint(bytes, offset);
    out.push(v.value);
    offset = v.offset;
  }
  return out;
}
