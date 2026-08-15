import { describe, it, expect } from 'vitest';
import {
  ScipDecodeError,
  asMessage,
  asNumber,
  asString,
  decodeMessage,
  decodePackedVarints,
  decodeVarint,
  fieldsByNumber,
  MAX_VARINT_BYTES,
} from '../../src/scip/decode.js';
import { enrichWithScip, parseScipIndex, ROLE_DEFINITION } from '../../src/scip/ingest.js';
import type { ScipIndex } from '../../src/scip/ingest.js';
import type { KnowledgeGraph, SprangEdge, SprangNode } from '../../src/schema/types.js';

// ─── Hand-rolled protobuf encoder ────────────────────────────────────
// The tests build every SCIP message they use, so nothing here depends on a
// fixture binary or on an indexer being installed.

function encodeVarint(value: number | bigint): Uint8Array {
  let v = BigInt(value);
  if (v < 0n) throw new Error('test encoder only handles unsigned varints');
  const bytes: number[] = [];
  do {
    let byte = Number(v & 0x7fn);
    v >>= 7n;
    if (v > 0n) byte |= 0x80;
    bytes.push(byte);
  } while (v > 0n);
  return Uint8Array.from(bytes);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** key = (fieldNumber << 3) | wireType, followed by the raw payload. */
function encodeField(fieldNumber: number, wireType: number, payload: Uint8Array): Uint8Array {
  return concat([encodeVarint((fieldNumber << 3) | wireType), payload]);
}

function varintField(fieldNumber: number, value: number | bigint): Uint8Array {
  return encodeField(fieldNumber, 0, encodeVarint(value));
}

function bytesField(fieldNumber: number, payload: Uint8Array): Uint8Array {
  return encodeField(fieldNumber, 2, concat([encodeVarint(payload.length), payload]));
}

function stringField(fieldNumber: number, value: string): Uint8Array {
  return bytesField(fieldNumber, new TextEncoder().encode(value));
}

function packedField(fieldNumber: number, values: number[]): Uint8Array {
  return bytesField(fieldNumber, concat(values.map(encodeVarint)));
}

function fixed64Field(fieldNumber: number, value: bigint): Uint8Array {
  const buf = new Uint8Array(8);
  new DataView(buf.buffer).setBigUint64(0, value, true);
  return encodeField(fieldNumber, 1, buf);
}

function fixed32Field(fieldNumber: number, value: number): Uint8Array {
  const buf = new Uint8Array(4);
  new DataView(buf.buffer).setUint32(0, value, true);
  return encodeField(fieldNumber, 5, buf);
}

// ─── SCIP message builders ───────────────────────────────────────────

interface OccSpec {
  symbol: string;
  line: number;
  definition?: boolean;
  packed?: boolean;
}

function occurrence(spec: OccSpec): Uint8Array {
  const range = spec.packed === false
    ? concat([varintField(1, spec.line), varintField(1, 0), varintField(1, 4)])
    : packedField(1, [spec.line, 0, spec.line, 8]);
  const parts = [range, stringField(2, spec.symbol)];
  if (spec.definition === true) parts.push(varintField(3, ROLE_DEFINITION));
  return bytesField(3, concat(parts));
}

function document(path: string, language: string, occs: Uint8Array[]): Uint8Array {
  return bytesField(2, concat([stringField(1, language), stringField(2, path), ...occs]));
}

function indexOf(docs: Uint8Array[]): Uint8Array {
  return concat(docs);
}

// ─── Graph builders ──────────────────────────────────────────────────

function fnNode(path: string, name: string, start: number, end: number): SprangNode {
  return {
    id: `function:${path}:${name}`,
    type: 'function',
    name,
    label: name,
    filePath: path,
    lineRange: [start, end],
  };
}

function graphOf(nodes: SprangNode[], edges: SprangEdge[]): KnowledgeGraph {
  return {
    version: '1.0.0',
    generated_at: '2024-01-01T00:00:00.000Z',
    project_root: '/repo',
    project_name: 'demo',
    phase: 'complete',
    nodes,
    edges,
    layers: [],
    tours: [],
    domains: [],
    stats: {
      total_nodes: nodes.length,
      total_edges: edges.length,
      node_types: {},
      edge_types: {},
      files_analyzed: 0,
    },
  };
}

/** caller in src/a.ts (lines 1-10), callee in src/b.ts (lines 1-5). */
function twoFileGraph(edges: SprangEdge[], prefix = ''): KnowledgeGraph {
  return graphOf(
    [
      fnNode(`${prefix}src/a.ts`, 'caller', 1, 10),
      fnNode(`${prefix}src/b.ts`, 'target', 1, 5),
    ],
    edges,
  );
}

const CALLER_ID = 'function:src/a.ts:caller';
const TARGET_ID = 'function:src/b.ts:target';

/** Index where src/a.ts:caller references the symbol defined in src/b.ts. */
function callIndexBytes(pathA = 'src/a.ts', pathB = 'src/b.ts'): Uint8Array {
  return indexOf([
    document(pathB, 'TypeScript', [
      occurrence({ symbol: 'scip ts . . `b.ts`/target().', line: 0, definition: true }),
    ]),
    document(pathA, 'TypeScript', [
      occurrence({ symbol: 'scip ts . . `a.ts`/caller().', line: 0, definition: true }),
      occurrence({ symbol: 'scip ts . . `b.ts`/target().', line: 4 }),
    ]),
  ]);
}

// ─── decodeVarint ────────────────────────────────────────────────────

describe('decodeVarint', () => {
  it('decodes a single-byte value', () => {
    expect(decodeVarint(Uint8Array.from([0x01]), 0)).toEqual({ value: 1n, offset: 1 });
  });

  it('decodes the canonical multi-byte example (150)', () => {
    expect(decodeVarint(Uint8Array.from([0x96, 0x01]), 0)).toEqual({ value: 150n, offset: 2 });
  });

  it('decodes zero', () => {
    expect(decodeVarint(Uint8Array.from([0x00]), 0).value).toBe(0n);
  });

  it('round-trips large 64-bit values', () => {
    const value = 0xdead_beef_cafe_1234n;
    expect(decodeVarint(encodeVarint(value), 0).value).toBe(value);
  });

  it('respects the starting offset and reports the next offset', () => {
    const buf = concat([encodeVarint(7), encodeVarint(300)]);
    const first = decodeVarint(buf, 0);
    expect(first.value).toBe(7n);
    expect(decodeVarint(buf, first.offset).value).toBe(300n);
  });

  it('throws on a varint truncated by the end of the buffer', () => {
    expect(() => decodeVarint(Uint8Array.from([0x96]), 0)).toThrow(ScipDecodeError);
  });

  it(`throws rather than looping past ${MAX_VARINT_BYTES} continuation bytes`, () => {
    const runaway = new Uint8Array(32).fill(0xff);
    expect(() => decodeVarint(runaway, 0)).toThrow(/exceeds 10 bytes/);
  });

  it('throws when the offset is past the end of the buffer', () => {
    expect(() => decodeVarint(Uint8Array.from([0x01]), 5)).toThrow(ScipDecodeError);
  });
});

// ─── decodeMessage: wire types ───────────────────────────────────────

describe('decodeMessage', () => {
  it('treats an empty buffer as an empty message', () => {
    expect(decodeMessage(new Uint8Array(0))).toEqual([]);
  });

  it('decodes wire type 0 (varint) fields', () => {
    const fields = decodeMessage(varintField(3, 300));
    expect(fields).toEqual([{ fieldNumber: 3, wireType: 0, value: 300n }]);
  });

  it('decodes wire type 1 (64-bit) fields little-endian', () => {
    const fields = decodeMessage(fixed64Field(2, 0x0102_0304_0506_0708n));
    expect(fields[0]?.wireType).toBe(1);
    expect(fields[0]?.value).toBe(0x0102_0304_0506_0708n);
  });

  it('decodes wire type 2 (length-delimited) fields', () => {
    const fields = decodeMessage(stringField(1, 'hello'));
    expect(fields[0]?.wireType).toBe(2);
    expect(asString(fields[0]!)).toBe('hello');
  });

  it('decodes wire type 5 (32-bit) fields little-endian', () => {
    const fields = decodeMessage(fixed32Field(4, 0x0a0b0c0d));
    expect(fields[0]).toEqual({ fieldNumber: 4, wireType: 5, value: 0x0a0b0c0d });
  });

  it('decodes several fields in wire order, keeping repeats', () => {
    const fields = decodeMessage(concat([varintField(1, 1), varintField(1, 2), stringField(2, 'x')]));
    expect(fields.map((f) => f.fieldNumber)).toEqual([1, 1, 2]);
  });

  it('rejects deprecated group wire types (3 and 4)', () => {
    expect(() => decodeMessage(encodeField(1, 3, new Uint8Array(0)))).toThrow(/group wire type 3/);
    expect(() => decodeMessage(encodeField(1, 4, new Uint8Array(0)))).toThrow(/group wire type 4/);
  });

  it('rejects wire types 6 and 7, which do not exist', () => {
    expect(() => decodeMessage(encodeField(1, 6, new Uint8Array(0)))).toThrow(ScipDecodeError);
    expect(() => decodeMessage(encodeField(1, 7, new Uint8Array(0)))).toThrow(ScipDecodeError);
  });

  it('rejects field number 0', () => {
    expect(() => decodeMessage(Uint8Array.from([0x00, 0x01]))).toThrow(/field number 0/);
  });

  it('throws on a buffer truncated mid length-delimited payload', () => {
    const full = stringField(1, 'hello world');
    expect(() => decodeMessage(full.subarray(0, full.length - 4))).toThrow(
      /truncated|claims 11 bytes/,
    );
  });

  it('throws when a length prefix claims more bytes than the buffer holds', () => {
    expect(() => decodeMessage(concat([encodeVarint((1 << 3) | 2), encodeVarint(9999)]))).toThrow(
      /claims 9999 bytes/,
    );
  });

  it('throws on a truncated 32-bit field rather than reading out of bounds', () => {
    const full = fixed32Field(1, 7);
    expect(() => decodeMessage(full.subarray(0, 3))).toThrow(/truncated/);
  });

  it('reports the failing byte offset on the error', () => {
    try {
      decodeMessage(Uint8Array.from([0x96]));
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ScipDecodeError);
      expect((error as ScipDecodeError).offset).toBeGreaterThanOrEqual(0);
    }
  });
});

// ─── helpers ─────────────────────────────────────────────────────────

describe('field helpers', () => {
  it('groups repeated field numbers into arrays', () => {
    const map = fieldsByNumber(decodeMessage(concat([varintField(1, 1), varintField(1, 2), varintField(3, 9)])));
    expect(map.get(1)?.length).toBe(2);
    expect(map.get(3)?.length).toBe(1);
    expect(map.get(2)).toBeUndefined();
  });

  it('decodes nested messages via asMessage', () => {
    const nested = bytesField(5, concat([stringField(1, 'inner')]));
    const outer = decodeMessage(nested);
    const inner = asMessage(outer[0]!);
    expect(asString(inner[0]!)).toBe('inner');
  });

  it('asString and asMessage reject non-length-delimited fields', () => {
    const field = decodeMessage(varintField(1, 5))[0]!;
    expect(() => asString(field)).toThrow(ScipDecodeError);
    expect(() => asMessage(field)).toThrow(ScipDecodeError);
  });

  it('asNumber accepts varint and fixed fields but rejects bytes', () => {
    expect(asNumber(decodeMessage(varintField(1, 42))[0]!)).toBe(42);
    expect(asNumber(decodeMessage(fixed32Field(1, 42))[0]!)).toBe(42);
    expect(() => asNumber(decodeMessage(stringField(1, 'x'))[0]!)).toThrow(ScipDecodeError);
  });

  it('decodes packed repeated varints', () => {
    expect(decodePackedVarints(concat([encodeVarint(1), encodeVarint(300), encodeVarint(0)]))).toEqual([
      1n,
      300n,
      0n,
    ]);
    expect(decodePackedVarints(new Uint8Array(0))).toEqual([]);
  });
});

// ─── parseScipIndex ──────────────────────────────────────────────────

describe('parseScipIndex', () => {
  it('parses an empty index', () => {
    expect(parseScipIndex(new Uint8Array(0))).toEqual({ documents: [], symbolCount: 0 });
  });

  it('round-trips Index → Document → Occurrence', () => {
    const index = parseScipIndex(callIndexBytes());
    expect(index.documents.map((d) => d.path)).toEqual(['src/b.ts', 'src/a.ts']);
    expect(index.documents[0]?.language).toBe('TypeScript');
    expect(index.documents[0]?.occurrences).toEqual([
      { symbol: 'scip ts . . `b.ts`/target().', path: 'src/b.ts', line: 0, isDefinition: true },
    ]);
    expect(index.symbolCount).toBe(2);
  });

  it('distinguishes definitions from references via the 0x1 role bit', () => {
    const bytes = indexOf([
      document('src/a.ts', 'TypeScript', [
        occurrence({ symbol: 'S', line: 1, definition: true }),
        occurrence({ symbol: 'S', line: 9 }),
      ]),
    ]);
    const occs = parseScipIndex(bytes).documents[0]?.occurrences ?? [];
    expect(occs.map((o) => o.isDefinition)).toEqual([true, false]);
  });

  it('treats other role bits (e.g. Import 0x2) as references', () => {
    const occ = bytesField(3, concat([packedField(1, [3, 0, 3, 4]), stringField(2, 'S'), varintField(3, 0x2)]));
    const bytes = indexOf([document('src/a.ts', 'TypeScript', [occ])]);
    expect(parseScipIndex(bytes).documents[0]?.occurrences[0]?.isDefinition).toBe(false);
  });

  it('accepts an unpacked repeated range as well as a packed one', () => {
    const bytes = indexOf([
      document('src/a.ts', 'TypeScript', [occurrence({ symbol: 'S', line: 7, packed: false })]),
    ]);
    expect(parseScipIndex(bytes).documents[0]?.occurrences[0]?.line).toBe(7);
  });

  it('counts external SymbolInformation towards symbolCount', () => {
    const external = bytesField(3, stringField(1, 'external-symbol'));
    const bytes = concat([document('src/a.ts', 'TypeScript', []), external]);
    expect(parseScipIndex(bytes).symbolCount).toBe(1);
  });

  it('skips documents with no relative_path', () => {
    const anonymous = bytesField(2, concat([stringField(1, 'TypeScript')]));
    expect(parseScipIndex(anonymous).documents).toEqual([]);
  });

  it('ignores unknown field numbers so newer indexers still parse', () => {
    const bytes = concat([varintField(99, 1), callIndexBytes(), stringField(97, 'future')]);
    expect(parseScipIndex(bytes).documents.length).toBe(2);
  });

  it('throws a typed error on non-protobuf bytes', () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(() => parseScipIndex(png)).toThrow(ScipDecodeError);
  });

  it('throws on a truncated index rather than returning partial nonsense', () => {
    const full = callIndexBytes();
    expect(() => parseScipIndex(full.subarray(0, full.length - 6))).toThrow(ScipDecodeError);
  });
});

// ─── enrichWithScip ──────────────────────────────────────────────────

describe('enrichWithScip', () => {
  it('upgrades an ambiguous call edge to structural with confidence 1', () => {
    const graph = twoFileGraph([
      { source: CALLER_ID, target: TARGET_ID, type: 'calls', resolution: 'imported-ambiguous', confidence: 0.3 },
    ]);
    const result = enrichWithScip(graph, parseScipIndex(callIndexBytes()));
    expect(result.upgraded).toBe(1);
    expect(result.added).toBe(0);
    expect(graph.edges[0]?.resolution).toBe('structural');
    expect(graph.edges[0]?.confidence).toBe(1);
  });

  it('adds a call edge Sprang missed entirely', () => {
    const graph = twoFileGraph([]);
    const result = enrichWithScip(graph, parseScipIndex(callIndexBytes()));
    expect(result.added).toBe(1);
    expect(result.upgraded).toBe(0);
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]).toMatchObject({
      source: CALLER_ID,
      target: TARGET_ID,
      type: 'calls',
      resolution: 'structural',
      confidence: 1,
    });
  });

  it('leaves an already-structural edge alone and says so', () => {
    const graph = twoFileGraph([
      { source: CALLER_ID, target: TARGET_ID, type: 'calls', resolution: 'structural', confidence: 1 },
    ]);
    const result = enrichWithScip(graph, parseScipIndex(callIndexBytes()));
    expect(result).toMatchObject({ upgraded: 0, added: 0 });
    expect(graph.edges).toHaveLength(1);
    expect(result.notes.some((n) => n.includes('resolved no call edges'))).toBe(true);
  });

  it('does not disturb unrelated edges', () => {
    const other: SprangEdge = { source: 'file:src/a.ts', target: 'file:src/b.ts', type: 'imports' };
    const graph = twoFileGraph([other]);
    enrichWithScip(graph, parseScipIndex(callIndexBytes()));
    expect(graph.edges[0]).toBe(other);
    expect(other.resolution).toBeUndefined();
  });

  it('matches index paths to graph paths by longest common suffix', () => {
    const graph = twoFileGraph([], 'packages/core/');
    const result = enrichWithScip(graph, parseScipIndex(callIndexBytes()));
    expect(result.added).toBe(1);
    expect(graph.edges[0]?.source).toBe('function:packages/core/src/a.ts:caller');
    expect(result.notes.some((n) => n.includes('suffix'))).toBe(true);
  });

  it('notes index paths that match no graph file', () => {
    const graph = twoFileGraph([]);
    const bytes = callIndexBytes('vendor/other/x.ts', 'vendor/other/y.ts');
    const result = enrichWithScip(graph, parseScipIndex(bytes));
    expect(result.added).toBe(0);
    expect(result.notes.join(' ')).toMatch(/matched no graph file/);
  });

  it('counts references whose definition is unknown as unresolved', () => {
    const graph = twoFileGraph([]);
    const bytes = indexOf([
      document('src/b.ts', 'TypeScript', [occurrence({ symbol: 'known', line: 0, definition: true })]),
      document('src/a.ts', 'TypeScript', [
        occurrence({ symbol: 'known', line: 4 }),
        occurrence({ symbol: 'lodash-external', line: 5 }),
      ]),
    ]);
    const result = enrichWithScip(graph, parseScipIndex(bytes));
    expect(result.added).toBe(1);
    expect(result.unresolved).toBe(1);
  });

  it('does not create self-call edges from a definition referencing itself', () => {
    const graph = twoFileGraph([]);
    const bytes = indexOf([
      document('src/a.ts', 'TypeScript', [
        occurrence({ symbol: 'self', line: 0, definition: true }),
        occurrence({ symbol: 'self', line: 6 }),
      ]),
    ]);
    const result = enrichWithScip(graph, parseScipIndex(bytes));
    expect(result.added).toBe(0);
    expect(result.unresolved).toBe(1);
    expect(graph.edges).toHaveLength(0);
  });

  it('adds one edge for repeated references to the same symbol', () => {
    const graph = twoFileGraph([]);
    const bytes = indexOf([
      document('src/b.ts', 'TypeScript', [occurrence({ symbol: 'S', line: 0, definition: true })]),
      document('src/a.ts', 'TypeScript', [
        occurrence({ symbol: 'S', line: 3 }),
        occurrence({ symbol: 'S', line: 6 }),
      ]),
    ]);
    expect(enrichWithScip(graph, parseScipIndex(bytes)).added).toBe(1);
    expect(graph.edges).toHaveLength(1);
  });

  it('returns notes, not a throw, for an index with no documents', () => {
    const graph = twoFileGraph([]);
    const result = enrichWithScip(graph, { documents: [], symbolCount: 0 });
    expect(result).toMatchObject({ upgraded: 0, added: 0, unresolved: 0 });
    expect(result.notes.join(' ')).toMatch(/no documents/);
  });

  it('returns notes, not a throw, for a malformed index object', () => {
    const graph = twoFileGraph([]);
    const malformed = { symbolCount: 3 } as unknown as ScipIndex;
    const result = enrichWithScip(graph, malformed);
    expect(result.notes.join(' ')).toMatch(/no documents array/);
    expect(graph.edges).toHaveLength(0);
  });

  it('survives documents whose occurrence list is not an array', () => {
    const graph = twoFileGraph([]);
    const malformed = {
      documents: [{ path: 'src/a.ts', language: 'ts', occurrences: null }],
      symbolCount: 1,
    } as unknown as ScipIndex;
    const result = enrichWithScip(graph, malformed);
    expect(result.notes.length).toBeGreaterThan(0);
    expect(graph.edges).toHaveLength(0);
  });

  it('notes an index with references but no definitions', () => {
    const graph = twoFileGraph([]);
    const bytes = indexOf([document('src/a.ts', 'TypeScript', [occurrence({ symbol: 'S', line: 4 })])]);
    const result = enrichWithScip(graph, parseScipIndex(bytes));
    expect(result.notes.join(' ')).toMatch(/no definition occurrences/);
    expect(graph.edges).toHaveLength(0);
  });

  it('notes a graph with no ranged nodes instead of silently doing nothing', () => {
    const graph = graphOf([{ id: 'file:src/a.ts', type: 'file', label: 'a', filePath: 'src/a.ts' }], []);
    const result = enrichWithScip(graph, parseScipIndex(callIndexBytes()));
    expect(result.notes.join(' ')).toMatch(/no function-level nodes/);
  });

  it('handles an empty graph and an empty index together', () => {
    const graph = graphOf([], []);
    const result = enrichWithScip(graph, { documents: [], symbolCount: 0 });
    expect(result.notes.length).toBeGreaterThan(0);
    expect(result.upgraded + result.added + result.unresolved).toBe(0);
  });

  it('notes stale line ranges when definitions fall outside every node', () => {
    const graph = graphOf([fnNode('src/b.ts', 'target', 100, 120)], []);
    const bytes = indexOf([
      document('src/b.ts', 'TypeScript', [occurrence({ symbol: 'S', line: 0, definition: true })]),
    ]);
    const result = enrichWithScip(graph, parseScipIndex(bytes));
    expect(result.notes.join(' ')).toMatch(/line ranges may be stale/);
  });

  it('attributes a reference to the innermost enclosing node', () => {
    const graph = graphOf(
      [
        fnNode('src/a.ts', 'outer', 1, 20),
        fnNode('src/a.ts', 'inner', 5, 10),
        fnNode('src/b.ts', 'target', 1, 5),
      ],
      [],
    );
    enrichWithScip(graph, parseScipIndex(callIndexBytes()));
    expect(graph.edges[0]?.source).toBe('function:src/a.ts:inner');
  });
});
