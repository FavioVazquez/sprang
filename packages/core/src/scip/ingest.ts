import type { KnowledgeGraph, SprangEdge, SprangNode } from '../schema/types.js';
import {
  ScipDecodeError,
  asMessage,
  asNumber,
  asString,
  decodeMessage,
  decodePackedVarints,
  fieldsByNumber,
  WIRE_LENGTH_DELIMITED,
  WIRE_VARINT,
  type ProtoField,
} from './decode.js';

/**
 * SCIP index ingestion — **strictly optional** call-graph enrichment.
 *
 * ## What this buys, and what it costs
 *
 * Sprang resolves calls by matching a callee name against the exported symbols of
 * directly-imported files. When several files export the same name it takes the
 * first and labels the edge `imported-ambiguous`, which is an honest way of
 * saying *guess*. A SCIP index — produced by `scip-typescript`, `scip-python`,
 * `rust-analyzer` or `scip-java` — carries the compiler's own answer. Where an
 * index exists, those guesses can be replaced with facts.
 *
 * The cost is why this is optional and must stay optional: every SCIP indexer
 * requires a *building* project with its dependencies installed, the right
 * toolchain version and often a successful compile. Sprang's promise is that it
 * works on a bare `git clone` in a sandbox with no network. Tree-sitter parsing
 * and regex extraction are therefore the floor and always run; **SCIP is never
 * required, never assumed present, and its absence is not a degraded mode.** No
 * caller should make an index a precondition for anything.
 *
 * Consistent with that, {@link enrichWithScip} never throws. A malformed,
 * mismatched or empty index yields an {@link EnrichmentResult} whose `notes`
 * explain the problem and whose counters are zero, with the graph untouched.
 * {@link parseScipIndex} *does* throw, because a caller handing over bytes wants
 * to know they were not a SCIP index at all.
 *
 * ## The slice of scip.proto this reads
 *
 * Field numbers, from Sourcegraph's `scip.proto` (see
 * https://github.com/sourcegraph/scip/blob/main/scip.proto):
 *
 * ```text
 * Index
 *   1  Metadata          metadata
 *   2  repeated Document documents
 *   3  repeated SymbolInformation external_symbols
 * Document
 *   1  string                     language
 *   2  string                     relative_path
 *   3  repeated Occurrence        occurrences
 *   4  repeated SymbolInformation symbols
 * Occurrence
 *   1  repeated int32 range           (packed; [startLine, startChar, endLine, endChar]
 *                                      or the 3-element single-line form)
 *   2  string         symbol
 *   3  int32          symbol_roles    (bitfield; 0x1 = Definition)
 *   6  SyntaxKind     syntax_kind
 * SymbolInformation
 *   1  string          symbol
 *   2  repeated string documentation
 *   4  Kind            kind
 * ```
 *
 * Everything else in the schema (diagnostics, relationships, signatures) is
 * skipped by the field-number switch and costs nothing to ignore.
 *
 * **Ranges are zero-based** in SCIP and one-based in Sprang's graph. The
 * conversion happens exactly once, in {@link enrichWithScip}; {@link ScipSymbol}
 * reports the line as the index recorded it.
 */

/** A single symbol occurrence, as the index recorded it. */
export interface ScipSymbol {
  /** SCIP symbol string, e.g. `scip-typescript npm pkg 1.0 src/a.ts/foo().`. */
  symbol: string;
  /** `relative_path` of the document this occurred in, as written in the index. */
  path: string;
  /** Zero-based start line, straight from the index. Add 1 for graph lines. */
  line: number;
  /** True when `symbol_roles & 0x1` is set: this occurrence *is* the definition. */
  isDefinition: boolean;
}

/** A decoded SCIP index, reduced to the parts Sprang can use. */
export interface ScipIndex {
  documents: Array<{ path: string; language: string; occurrences: ScipSymbol[] }>;
  /**
   * Distinct symbol strings seen anywhere in the index: occurrences, per-document
   * `SymbolInformation` and the index-level external symbols. A rough measure of
   * how much the index knows, useful for sanity-checking before enrichment.
   */
  symbolCount: number;
}

/** `symbol_roles` bit 0x1. Every other role value means "reference". */
export const ROLE_DEFINITION = 0x1;

const INDEX_DOCUMENTS = 2;
const INDEX_EXTERNAL_SYMBOLS = 3;
const DOC_LANGUAGE = 1;
const DOC_RELATIVE_PATH = 2;
const DOC_OCCURRENCES = 3;
const DOC_SYMBOLS = 4;
const OCC_RANGE = 1;
const OCC_SYMBOL = 2;
const OCC_ROLES = 3;
const SYMINFO_SYMBOL = 1;

/** Last occurrence wins, matching protobuf's rule for singular fields. */
function last(fields: ProtoField[] | undefined): ProtoField | undefined {
  if (fields === undefined || fields.length === 0) return undefined;
  return fields[fields.length - 1];
}

/**
 * Read `Occurrence.range`, which producers may emit packed or unpacked.
 *
 * Packed is one length-delimited field holding back-to-back varints; unpacked is
 * the same field number repeated with wire type 0. Both are legal for
 * `repeated int32`, and real indexers differ, so both are accepted.
 *
 * Returns the start line only — the character columns and end position are not
 * needed to map an occurrence onto a function node.
 */
function readStartLine(rangeFields: ProtoField[] | undefined): number | null {
  if (rangeFields === undefined || rangeFields.length === 0) return null;
  const first = rangeFields[0];
  if (first === undefined) return null;
  if (first.wireType === WIRE_LENGTH_DELIMITED && first.value instanceof Uint8Array) {
    const values = decodePackedVarints(first.value);
    const head = values[0];
    if (head === undefined) return null;
    return Number(head);
  }
  if (first.wireType === WIRE_VARINT) return asNumber(first);
  return null;
}

/**
 * Decode SCIP bytes into the reduced {@link ScipIndex} shape.
 *
 * Throws {@link ScipDecodeError} when the bytes are not protobuf, are truncated,
 * or use a construct this reader rejects. Callers that would rather degrade
 * quietly should catch it — the graph is perfectly usable without an index.
 *
 * Documents with no `relative_path` are dropped: an occurrence that cannot be
 * attributed to a file cannot be attributed to a node either.
 */
export function parseScipIndex(buf: Uint8Array): ScipIndex {
  const top = fieldsByNumber(decodeMessage(buf));
  const documents: ScipIndex['documents'] = [];
  const symbols = new Set<string>();

  for (const docField of top.get(INDEX_DOCUMENTS) ?? []) {
    const doc = fieldsByNumber(asMessage(docField));
    const pathField = last(doc.get(DOC_RELATIVE_PATH));
    if (pathField === undefined) continue;
    const path = asString(pathField);
    if (path === '') continue;
    const languageField = last(doc.get(DOC_LANGUAGE));
    const language = languageField === undefined ? '' : asString(languageField);

    const occurrences: ScipSymbol[] = [];
    for (const occField of doc.get(DOC_OCCURRENCES) ?? []) {
      const occ = fieldsByNumber(asMessage(occField));
      const symbolField = last(occ.get(OCC_SYMBOL));
      if (symbolField === undefined) continue;
      const symbol = asString(symbolField);
      if (symbol === '') continue;
      const line = readStartLine(occ.get(OCC_RANGE));
      if (line === null || line < 0) continue;
      const rolesField = last(occ.get(OCC_ROLES));
      const roles = rolesField === undefined ? 0 : asNumber(rolesField);
      symbols.add(symbol);
      occurrences.push({
        symbol,
        path,
        line,
        isDefinition: (roles & ROLE_DEFINITION) !== 0,
      });
    }

    for (const infoField of doc.get(DOC_SYMBOLS) ?? []) {
      const info = fieldsByNumber(asMessage(infoField));
      const symbolField = last(info.get(SYMINFO_SYMBOL));
      if (symbolField !== undefined) symbols.add(asString(symbolField));
    }

    documents.push({ path, language, occurrences });
  }

  for (const extField of top.get(INDEX_EXTERNAL_SYMBOLS) ?? []) {
    const info = fieldsByNumber(asMessage(extField));
    const symbolField = last(info.get(SYMINFO_SYMBOL));
    if (symbolField !== undefined) symbols.add(asString(symbolField));
  }

  return { documents, symbolCount: symbols.size };
}

/** What an enrichment pass changed, and what it could not. */
export interface EnrichmentResult {
  /** Existing `calls` edges promoted from a guess to `structural` / confidence 1. */
  upgraded: number;
  /** `calls` edges the index proved and Sprang had missed entirely. */
  added: number;
  /** References that could not be mapped onto two graph nodes. */
  unresolved: number;
  /** Anything a reader would be surprised by: path mismatches, empty input, errors. */
  notes: string[];
}

interface RangedNode {
  id: string;
  start: number;
  end: number;
}

function normalise(path: string): string {
  const forward = path.replace(/\\/g, '/');
  return forward.startsWith('./') ? forward.slice(2) : forward;
}

function fileOfNode(node: SprangNode): string | null {
  const raw = node.filePath ?? node.location?.file;
  if (raw !== undefined && raw !== '') return normalise(raw);
  if (node.id.startsWith('file:')) return normalise(node.id.slice(5));
  return null;
}

/** Number of trailing path segments shared by two paths. Mirrors `verify/coverage.ts`. */
function commonSuffixSegments(a: string[], b: string[]): number {
  let i = 0;
  while (i < a.length && i < b.length && a[a.length - 1 - i] === b[b.length - 1 - i]) i++;
  return i;
}

/**
 * Map a SCIP `relative_path` onto a graph file path.
 *
 * The two are both "repo-relative" and still routinely disagree on prefix: an
 * index built inside `packages/core` says `src/a.ts` where a graph rooted at the
 * monorepo says `packages/core/src/a.ts`, and Bazel-style indexers add their own
 * prefixes. Matching is therefore by **longest common path suffix**, with the
 * shorter path required to be a whole-segment suffix of the longer — the same
 * rule `verify/coverage.ts` uses to reconcile CI coverage paths, kept identical
 * on purpose so the two do not disagree about what "the same file" means.
 *
 * Ties break on lexicographic order so the result is deterministic.
 */
function matchPath(scipPath: string, candidates: Array<{ file: string; segments: string[] }>):
  | string
  | null {
  const segments = normalise(scipPath).split('/');
  let best: { file: string; score: number } | null = null;
  for (const candidate of candidates) {
    const score = commonSuffixSegments(segments, candidate.segments);
    if (score === 0) continue;
    if (score < Math.min(segments.length, candidate.segments.length)) continue;
    if (best === null || score > best.score || (score === best.score && candidate.file < best.file)) {
      best = { file: candidate.file, score };
    }
  }
  return best === null ? null : best.file;
}

/** Innermost node whose one-based line range contains `line`. */
function enclosing(nodes: RangedNode[], line: number): RangedNode | null {
  let best: RangedNode | null = null;
  for (const node of nodes) {
    if (line < node.start || line > node.end) continue;
    if (best === null || node.end - node.start < best.end - best.start) best = node;
  }
  return best;
}

/** Node whose definition line is exactly `line`, else the innermost enclosing one. */
function definitionNode(nodes: RangedNode[], line: number): RangedNode | null {
  for (const node of nodes) if (node.start === line) return node;
  return enclosing(nodes, line);
}

function rangedNodesByFile(graph: KnowledgeGraph): Map<string, RangedNode[]> {
  const byFile = new Map<string, RangedNode[]>();
  for (const node of graph.nodes) {
    // Only symbol-level nodes can be call endpoints; file nodes have no range
    // and would swallow every occurrence in the file. (`NodeType` has no
    // `method`; methods are emitted as `function` nodes.)
    if (node.type !== 'function' && node.type !== 'class') continue;
    const file = fileOfNode(node);
    if (file === null) continue;
    const range = node.lineRange;
    const start = range?.[0] ?? node.location?.start_line;
    if (start === undefined) continue;
    const end = range?.[1] ?? node.location?.end_line ?? start;
    const bucket = byFile.get(file);
    const entry: RangedNode = { id: node.id, start, end: Math.max(start, end) };
    if (bucket === undefined) byFile.set(file, [entry]);
    else bucket.push(entry);
  }
  return byFile;
}

/**
 * Upgrade a graph's `calls` edges using a SCIP index. **Mutates `graph.edges`.**
 *
 * For every reference occurrence whose definition also appears in the index:
 *
 * - the *caller* is the innermost function/method/class node containing the
 *   reference line, and the *callee* is the node at the definition line;
 * - an existing `calls` edge between them is set to `resolution: 'structural'`
 *   with `confidence: 1` and counted in `upgraded` — the compiler agreed with
 *   Sprang's guess, so the guess stops being a guess;
 * - a missing edge is appended with the same resolution and counted in `added` —
 *   these are the calls name matching could not see at all (dynamic dispatch,
 *   re-exports, aliased imports);
 * - anything that cannot be mapped to two distinct nodes is counted in
 *   `unresolved` and changes nothing.
 *
 * `resolution` is deliberately one of the existing {@link
 * import('../schema/types.js').EdgeResolution} values: `'structural'` already
 * means "derived from structure rather than a name-matched call site", which is
 * exactly what a compiler-produced index gives. No new vocabulary is introduced
 * for consumers to learn or for old graphs to fail validation against.
 *
 * Never throws. Every failure — a bad index shape, no matching paths, no
 * definitions — is reported through `notes` with the graph left as it was.
 */
export function enrichWithScip(graph: KnowledgeGraph, index: ScipIndex): EnrichmentResult {
  const result: EnrichmentResult = { upgraded: 0, added: 0, unresolved: 0, notes: [] };
  try {
    const documents: unknown = (index as { documents?: unknown } | null | undefined)?.documents;
    if (!Array.isArray(documents)) {
      result.notes.push('index has no documents array; nothing to enrich');
      return result;
    }
    if (documents.length === 0) {
      result.notes.push('index contains no documents; graph unchanged');
      return result;
    }
    if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
      result.notes.push('graph has no nodes or edges array; nothing to enrich');
      return result;
    }

    const nodesByFile = rangedNodesByFile(graph);
    if (nodesByFile.size === 0) {
      result.notes.push(
        'graph has no function-level nodes with line ranges; SCIP occurrences cannot be attributed',
      );
      return result;
    }
    const candidates = [...nodesByFile.keys()].map((file) => ({ file, segments: file.split('/') }));

    // Pass 1: resolve document paths and collect definitions.
    const resolvedPath = new Map<string, string>();
    const unmatchedPaths: string[] = [];
    const renamedPaths: string[] = [];
    const definitions = new Map<string, string>();
    let definitionOccurrences = 0;

    for (const doc of index.documents) {
      const scipPath = normalise(doc.path);
      const match = matchPath(scipPath, candidates);
      if (match === null) {
        unmatchedPaths.push(doc.path);
        continue;
      }
      resolvedPath.set(doc.path, match);
      if (match !== scipPath) renamedPaths.push(`${doc.path} → ${match}`);
      const nodes = nodesByFile.get(match) ?? [];
      for (const occ of doc.occurrences) {
        if (!occ.isDefinition) continue;
        definitionOccurrences += 1;
        // SCIP lines are zero-based; graph lines are one-based.
        const node = definitionNode(nodes, occ.line + 1);
        if (node === null) continue;
        // First definition wins: a symbol defined twice in one index is already
        // a contradiction, and picking arbitrarily on each pass would make the
        // enrichment non-deterministic.
        if (!definitions.has(occ.symbol)) definitions.set(occ.symbol, node.id);
      }
    }

    if (unmatchedPaths.length > 0) {
      const shown = unmatchedPaths.slice(0, 3).join(', ');
      result.notes.push(
        `${unmatchedPaths.length} of ${index.documents.length} index paths matched no graph file (e.g. ${shown}); ` +
          'the index and the graph may be rooted at different directories',
      );
    }
    if (renamedPaths.length > 0) {
      result.notes.push(
        `${renamedPaths.length} index path(s) matched a graph file by suffix rather than exactly (e.g. ${renamedPaths[0] ?? ''})`,
      );
    }
    if (definitionOccurrences === 0) {
      result.notes.push(
        'index contains no definition occurrences (symbol_roles bit 0x1); nothing can be resolved',
      );
      return result;
    }
    if (definitions.size === 0) {
      result.notes.push(
        'no definition occurrence landed inside a graph node; line ranges may be stale — re-scan before trusting the index',
      );
      return result;
    }

    // Pass 2: attribute references to callers and reconcile with the edges.
    const edgeIndex = new Map<string, SprangEdge>();
    for (const edge of graph.edges) {
      if (edge.type !== 'calls') continue;
      const key = `${edge.source}\u0000${edge.target}`;
      if (!edgeIndex.has(key)) edgeIndex.set(key, edge);
    }
    const handled = new Set<string>();

    for (const doc of index.documents) {
      const file = resolvedPath.get(doc.path);
      if (file === undefined) {
        for (const occ of doc.occurrences) if (!occ.isDefinition) result.unresolved += 1;
        continue;
      }
      const nodes = nodesByFile.get(file) ?? [];
      for (const occ of doc.occurrences) {
        if (occ.isDefinition) continue;
        const target = definitions.get(occ.symbol);
        // A reference to a symbol defined outside the index (a dependency) is
        // not a Sprang edge at all; it is still unresolved from our side.
        if (target === undefined) {
          result.unresolved += 1;
          continue;
        }
        const caller = enclosing(nodes, occ.line + 1);
        if (caller === null || caller.id === target) {
          // Top-level references and self-recursion are not call edges Sprang
          // models; counting them as unresolved keeps the number honest.
          result.unresolved += 1;
          continue;
        }
        const key = `${caller.id}\u0000${target}`;
        if (handled.has(key)) continue;
        handled.add(key);
        const existing = edgeIndex.get(key);
        if (existing !== undefined) {
          if (existing.resolution === 'structural' && existing.confidence === 1) continue;
          existing.resolution = 'structural';
          existing.confidence = 1;
          result.upgraded += 1;
          continue;
        }
        const edge: SprangEdge = {
          source: caller.id,
          target,
          type: 'calls',
          resolution: 'structural',
          confidence: 1,
          metadata: { source: 'scip', symbol: occ.symbol },
        };
        graph.edges.push(edge);
        edgeIndex.set(key, edge);
        result.added += 1;
      }
    }

    if (result.upgraded === 0 && result.added === 0) {
      result.notes.push('index resolved no call edges; graph unchanged');
    }
    return result;
  } catch (error) {
    // Enrichment is optional; a failure here must never break a scan.
    const detail = error instanceof ScipDecodeError || error instanceof Error
      ? error.message
      : String(error);
    result.notes.push(`enrichment aborted: ${detail}`);
    return result;
  }
}
