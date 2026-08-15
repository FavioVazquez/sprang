import type { KnowledgeGraph, SprangNode } from '../schema/types.js';

/**
 * Duplicate-code (clone) detection over the functions in a knowledge graph.
 *
 * Why this exists
 * ---------------
 * "The same logic lives in three places" is the single most actionable smell an
 * agent can be handed: it is objective, it is cheap to verify, and fixing it
 * removes future bugs rather than reshuffling them. Sprang already knows where
 * every function starts and ends; given the file contents it can compare them.
 *
 * The design is deliberately two-stage, because the naive version (compare every
 * function against every other) is quadratic in the number of functions and
 * would dominate scan time on any real repository:
 *
 *  1. **Fingerprint** — a cheap, structural, O(chars) signature. Functions with
 *     different fingerprints are never compared. This turns the quadratic
 *     problem into "quadratic inside small buckets".
 *  2. **Confirm** — a normalized LCS similarity, only for pairs that already
 *     share a fingerprint, and only over a bounded prefix (see
 *     {@link SIMILARITY_SAMPLE_CHARS}).
 *
 * Everything is pure and deterministic: the same graph and sources always
 * produce the same groups, in the same order.
 */

/** A set of functions believed to be copies of one another. */
export interface CloneGroup {
  /** The structural fingerprint shared by every member. */
  fingerprint: string;
  /** Members, sorted by node id. */
  members: Array<{ nodeId: string; file: string; name: string; line?: number }>;
  /** Mean confirmed pairwise similarity within the group, in `(0, 1]`. */
  similarity: number;
}

export interface DetectClonesOptions {
  /** Confirmation threshold; a pair must exceed it strictly. Default 0.7. */
  minSimilarity?: number;
  /** Functions spanning fewer source lines than this are ignored. Default 5. */
  minLines?: number;
}

/**
 * The subset of a `KnowledgeGraph` this module reads. A full `KnowledgeGraph`
 * is assignable to it, so callers are unaffected.
 */
// Re-exported from communities.ts so the same alias is not declared twice at
// the package boundary; both modules want exactly this shape.
export type { GraphInput } from './communities.js';
type LocalGraphInput = Pick<KnowledgeGraph, 'nodes' | 'edges'>;

/**
 * Only the first N characters of each normalized body are compared.
 *
 * LCS is O(n*m) in time. On a 20k-character generated file that is 4*10^8 cell
 * updates *per pair* — one pathological bucket would hang the whole scan, and a
 * scan that hangs is a scan nobody runs. Clones are overwhelmingly similar from
 * their first statement onwards (they were copy-pasted), so a bounded prefix
 * loses very little recall while capping the cost of any single comparison at
 * 500*500 = 250k cell updates. Two functions that differ only after character
 * 500 are reported as clones — which, for "you duplicated this", is the right
 * answer anyway.
 */
export const SIMILARITY_SAMPLE_CHARS = 500;

/**
 * Hard cap on pairwise comparisons inside one fingerprint bucket.
 *
 * A bucket is quadratic: 50 members is 1,225 pairs, 200 members is 19,900. Big
 * buckets are almost always generated code, migrations or test scaffolding —
 * exactly the material that is *supposed* to look alike — so spending unbounded
 * time on them buys nothing. Pairs are enumerated in sorted node-id order and
 * the enumeration simply stops at this cap, which keeps the result
 * deterministic (a truncated bucket always truncates in the same place) at the
 * cost of possibly missing clones among the tail members.
 */
export const MAX_PAIRS_PER_BUCKET = 1000;

/**
 * Names that are duplicated *by design*, and must never be reported.
 *
 * Framework contracts, language protocols and test scaffolding force many
 * functions to have the same shape: every `componentDidMount` sets state and
 * subscribes, every Alembic `upgrade` calls `op.create_table`, every
 * `beforeEach` builds a fixture. Reporting those is not just noise — it is
 * actively harmful, because an agent that learns Sprang's clone findings are
 * usually wrong will discount the real ones too. Suppressing the allowlist
 * costs a handful of true positives and removes the overwhelming majority of
 * false ones.
 *
 * Matching is case-insensitive, so `GET` also covers `get`.
 */
export const COMMON_FUNCTION_NAMES: readonly string[] = [
  // React lifecycle / conventions
  'render', 'componentDidMount', 'componentWillUnmount', 'componentDidUpdate',
  'shouldComponentUpdate', 'getDerivedStateFromProps', 'componentDidCatch',
  'getSnapshotBeforeUpdate', 'useEffect', 'useMemo', 'useCallback',
  // Vue lifecycle
  'setup', 'data', 'created', 'mounted', 'beforeMount', 'beforeUpdate',
  'updated', 'beforeUnmount', 'unmounted', 'beforeDestroy', 'destroyed',
  'activated', 'deactivated',
  // Python dunders and protocol methods
  '__init__', '__str__', '__repr__', '__eq__', '__hash__', '__len__',
  '__iter__', '__next__', '__enter__', '__exit__', '__call__', '__main__',
  // HTTP route handlers (Next.js, Deno, Remix, FastAPI conventions)
  'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS',
  'handler', 'handle', 'loader', 'action', 'middleware',
  // Database migrations (Alembic, Knex, TypeORM)
  'upgrade', 'downgrade', 'up', 'down', 'migrate', 'rollback',
  // Test scaffolding
  'beforeEach', 'afterEach', 'beforeAll', 'afterAll', 'setUp', 'tearDown',
  'setUpClass', 'tearDownClass', 'main',
  // Object protocol
  'toString', 'toJSON', 'equals', 'hashCode', 'clone', 'compareTo',
  'constructor', 'dispose', 'init', 'initialize', 'reset', 'close',
  // Generic accessors
  'get', 'set', 'getInstance', 'getValue', 'setValue', 'getName', 'setName',
  'getId', 'setId', 'getConfig', 'valueOf',
];

const COMMON_NAME_SET = new Set(COMMON_FUNCTION_NAMES.map((n) => n.toLowerCase()));

/** True when a function name is duplicated by convention rather than by copy-paste. */
export function isCommonFunctionName(name: string): boolean {
  return COMMON_NAME_SET.has(name.toLowerCase());
}

// ─── Normalization ───────────────────────────────────────────────────

/**
 * Remove comments and string *contents* from source text.
 *
 * Comments and literals are where two copies of the same logic differ most
 * (a renamed message, a translated docstring), and where two unrelated
 * functions can accidentally look alike (a shared licence header). Stripping
 * them makes the comparison about control flow. Quote characters are kept so
 * that the token structure survives.
 *
 * This is a language-agnostic scanner, not a parser: it understands `//`, `#`,
 * `/* ... *\/`, single/double/backtick strings and Python triple quotes, which
 * covers every language Sprang indexes well enough for a similarity heuristic.
 */
function stripCommentsAndStrings(code: string): string {
  let out = '';
  let i = 0;
  const n = code.length;
  while (i < n) {
    const c = code[i] ?? '';
    const next = i + 1 < n ? code[i + 1] ?? '' : '';

    if (c === '/' && next === '/') {
      while (i < n && code[i] !== '\n') i++;
      continue;
    }
    if (c === '#') {
      while (i < n && code[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < n && !(code[i] === '*' && code[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const triple = code[i + 1] === c && code[i + 2] === c;
      out += c + c; // empty literal placeholder
      if (triple) {
        i += 3;
        while (i < n && !(code[i] === c && code[i + 1] === c && code[i + 2] === c)) i++;
        i += 3;
      } else {
        i += 1;
        while (i < n) {
          const ch = code[i];
          if (ch === '\\') { i += 2; continue; }
          if (ch === c || ch === '\n') { i += 1; break; }
          i += 1;
        }
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

const LOOP_RE = /\b(for|while|foreach|do|loop)\b/g;
const CONDITION_RE = /\b(if|elif|else|switch|case|when|unless|catch|match)\b/g;
const RETURN_RE = /\b(return|yield)\b/g;
/** `name(` — a call site. Control-flow keywords are excluded below. */
const CALL_RE = /\b([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g;
const CALL_KEYWORDS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'foreach',
  'elif', 'with', 'do', 'when', 'match', 'except', 'print',
]);

const IDENTIFIER_RE = /[A-Za-z_$][A-Za-z0-9_$]*/g;
const NUMBER_RE = /\b\d+(?:\.\d+)?\b/g;

/**
 * Reserved words that survive normalization instead of folding to `I`.
 *
 * The rule is "every identifier becomes `I`", and a keyword is lexically an
 * identifier — but folding keywords too is measurably wrong here. Once `if`,
 * `for` and `return` all read as `I`, the normalized text of *any* two
 * functions is mostly `I`s and punctuation, and the LCS similarity of two
 * completely unrelated functions of similar shape lands around 0.75 — above
 * the default threshold. Keeping the control-flow skeleton visible is what
 * makes the confirmation stage able to say no. User-chosen names, which are
 * exactly what a copy-paste-and-rename changes, are still erased.
 */
const RESERVED_WORDS = new Set([
  'if', 'else', 'elif', 'for', 'while', 'do', 'switch', 'case', 'default',
  'break', 'continue', 'return', 'yield', 'await', 'async', 'function', 'def',
  'lambda', 'class', 'const', 'let', 'var', 'new', 'delete', 'typeof',
  'instanceof', 'in', 'of', 'is', 'not', 'and', 'or', 'try', 'catch', 'except',
  'finally', 'throw', 'raise', 'this', 'self', 'super', 'null', 'nil', 'none',
  'undefined', 'true', 'false', 'import', 'from', 'export', 'with', 'as',
  'pass', 'assert', 'match', 'when', 'interface', 'type', 'enum', 'struct',
  'public', 'private', 'protected', 'static', 'extends', 'implements',
]);

/**
 * Comment/string-free source with every (non-reserved) identifier folded to
 * `I` and every number to `N`, whitespace collapsed.
 *
 * This is the representation both the length bucket and the similarity measure
 * work on, which is what makes the detector immune to renaming: a copy-pasted
 * function whose variables were renamed normalizes to exactly the same text.
 * See {@link RESERVED_WORDS} for why keywords are exempt.
 */
export function normalizeCode(code: string): string {
  const stripped = stripCommentsAndStrings(code);
  return stripped
    .replace(NUMBER_RE, 'N')
    .replace(IDENTIFIER_RE, (match) => {
      if (match === 'N') return 'N';
      return RESERVED_WORDS.has(match.toLowerCase()) ? match.toLowerCase() : 'I';
    })
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Structural signature of a snippet: `L<loops>C<conditions>F<calls>R<returns>S<bucket>`.
 *
 * It is intentionally coarse. Its job is not to decide whether two functions
 * are clones — that is {@link codeSimilarity}'s job — but to be a cheap hash
 * that never groups things that obviously differ, so the expensive comparison
 * runs on a tiny fraction of the pairs. `S` is `floor(chars/50)` of the
 * normalized text, which lets a small edit slide within a bucket while keeping
 * a 30-line function away from a 300-line one.
 */
export function codeFingerprint(code: string): string {
  const stripped = stripCommentsAndStrings(code);
  const loops = (stripped.match(LOOP_RE) ?? []).length;
  const conditions = (stripped.match(CONDITION_RE) ?? []).length;
  const returns = (stripped.match(RETURN_RE) ?? []).length;

  let calls = 0;
  CALL_RE.lastIndex = 0;
  for (;;) {
    const match = CALL_RE.exec(stripped);
    if (match === null) break;
    const name = match[1];
    if (name !== undefined && !CALL_KEYWORDS.has(name)) calls++;
  }

  const normalized = normalizeCode(code);
  const bucket = Math.floor(normalized.length / 50);
  return `L${loops}C${conditions}F${calls}R${returns}S${bucket}`;
}

/**
 * Normalized longest-common-subsequence similarity in `[0, 1]`.
 *
 * `lcsLength / max(lenA, lenB)` over the first {@link SIMILARITY_SAMPLE_CHARS}
 * characters of each normalized body. The DP table is held as two
 * `Uint16Array` rolling rows: 500 is far below `Uint16` range and the two rows
 * are 2 KB total, so no allocation pressure and no O(n*m) memory.
 *
 * Returns 0 when either side normalizes to nothing — two empty bodies are not
 * a duplication finding, and reporting them as a perfect match would be a
 * guaranteed false positive.
 */
export function codeSimilarity(a: string, b: string): number {
  const na = normalizeCode(a).slice(0, SIMILARITY_SAMPLE_CHARS);
  const nb = normalizeCode(b).slice(0, SIMILARITY_SAMPLE_CHARS);
  const lenA = na.length;
  const lenB = nb.length;
  if (lenA === 0 || lenB === 0) return 0;

  let prev = new Uint16Array(lenB + 1);
  let curr = new Uint16Array(lenB + 1);
  for (let i = 1; i <= lenA; i++) {
    const ca = na.charCodeAt(i - 1);
    curr[0] = 0;
    for (let j = 1; j <= lenB; j++) {
      if (ca === nb.charCodeAt(j - 1)) {
        curr[j] = (prev[j - 1] ?? 0) + 1;
      } else {
        const up = prev[j] ?? 0;
        const left = curr[j - 1] ?? 0;
        curr[j] = up >= left ? up : left;
      }
    }
    const swap = prev;
    prev = curr;
    curr = swap;
  }
  const lcs = prev[lenB] ?? 0;
  return lcs / Math.max(lenA, lenB);
}

// ─── Detection ───────────────────────────────────────────────────────

interface Candidate {
  nodeId: string;
  file: string;
  name: string;
  line: number;
  body: string;
  fingerprint: string;
}

function nameOf(node: SprangNode): string {
  if (typeof node.name === 'string' && node.name.length > 0) return node.name;
  if (node.label.length > 0) return node.label;
  const parts = node.id.split(':');
  return parts[parts.length - 1] ?? node.id;
}

/** Inclusive 1-based line span of a node, if it records one. */
function spanOf(node: SprangNode): [number, number] | undefined {
  const range = node.lineRange;
  if (Array.isArray(range) && range.length === 2) {
    const [s, e] = range;
    if (Number.isFinite(s) && Number.isFinite(e) && s >= 1 && e >= s) return [s, e];
  }
  const loc = node.location;
  if (loc !== undefined && typeof loc.start_line === 'number' && typeof loc.end_line === 'number') {
    if (loc.start_line >= 1 && loc.end_line >= loc.start_line) return [loc.start_line, loc.end_line];
  }
  return undefined;
}

function fileOf(node: SprangNode): string | undefined {
  const raw = node.filePath ?? node.location?.file;
  return typeof raw === 'string' && raw.length > 0 ? raw : undefined;
}

/** Minimal union-find over bucket-local indices, used to merge confirmed pairs. */
function makeUnionFind(size: number): { find: (x: number) => number; union: (a: number, b: number) => void } {
  const parent: number[] = [];
  for (let i = 0; i < size; i++) parent.push(i);
  const find = (x: number): number => {
    let root = x;
    while ((parent[root] ?? root) !== root) root = parent[root] ?? root;
    let cur = x;
    while ((parent[cur] ?? cur) !== cur) {
      const next = parent[cur] ?? cur;
      parent[cur] = root;
      cur = next;
    }
    return root;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;
    if (ra < rb) parent[rb] = ra;
    else parent[ra] = rb;
  };
  return { find, union };
}

/**
 * Find groups of duplicated functions.
 *
 * `sources` maps project-relative file path -> file content and is supplied by
 * the caller: this module does no I/O, so it stays pure and testable and the
 * caller keeps control over what gets read. A function whose file is absent
 * from the map is skipped silently — a partial source map is the normal case
 * during incremental scans, not an error.
 *
 * Results are sorted by descending similarity, then fingerprint, then first
 * member id, so two runs over the same input are byte-identical.
 */
export function detectClones(
  graph: KnowledgeGraph | LocalGraphInput,
  sources: Map<string, string>,
  opts?: DetectClonesOptions,
): CloneGroup[] {
  const minSimilarity = typeof opts?.minSimilarity === 'number' && Number.isFinite(opts.minSimilarity)
    ? opts.minSimilarity
    : 0.7;
  const minLines = typeof opts?.minLines === 'number' && Number.isFinite(opts.minLines) && opts.minLines > 0
    ? Math.floor(opts.minLines)
    : 5;

  if (graph.nodes.length === 0 || sources.size === 0) return [];

  // ── Stage 0: collect comparable function bodies ──
  const candidates: Candidate[] = [];
  for (const node of graph.nodes) {
    if (node.type !== 'function') continue;
    const name = nameOf(node);
    if (isCommonFunctionName(name)) continue;
    const file = fileOf(node);
    if (file === undefined) continue;
    const span = spanOf(node);
    if (span === undefined) continue;
    const [start, end] = span;
    if (end - start + 1 < minLines) continue;
    const source = sources.get(file);
    if (source === undefined) continue;

    const lines = source.split('\n');
    if (start > lines.length) continue;
    const body = lines.slice(start - 1, Math.min(end, lines.length)).join('\n');
    if (body.trim().length === 0) continue;

    candidates.push({ nodeId: node.id, file, name, line: start, body, fingerprint: codeFingerprint(body) });
  }
  if (candidates.length < 2) return [];

  // ── Stage 1: bucket by fingerprint ──
  const buckets = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    const bucket = buckets.get(candidate.fingerprint);
    if (bucket === undefined) buckets.set(candidate.fingerprint, [candidate]);
    else bucket.push(candidate);
  }

  // ── Stage 2: confirm pairs with the (bounded) similarity measure ──
  const groups: CloneGroup[] = [];
  for (const fingerprint of [...buckets.keys()].sort()) {
    const members = (buckets.get(fingerprint) ?? []).slice().sort((a, b) => a.nodeId.localeCompare(b.nodeId));
    if (members.length < 2) continue;

    const uf = makeUnionFind(members.length);
    const confirmed: Array<{ a: number; b: number; score: number }> = [];
    let pairs = 0;
    outer: for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        if (pairs >= MAX_PAIRS_PER_BUCKET) break outer;
        pairs++;
        const a = members[i];
        const b = members[j];
        if (a === undefined || b === undefined) continue;
        const score = codeSimilarity(a.body, b.body);
        if (score > minSimilarity) {
          uf.union(i, j);
          confirmed.push({ a: i, b: j, score });
        }
      }
    }
    if (confirmed.length === 0) continue;

    // Mean similarity per merged group, keyed by union-find root.
    const scores = new Map<number, number[]>();
    for (const pair of confirmed) {
      const root = uf.find(pair.a);
      const list = scores.get(root);
      if (list === undefined) scores.set(root, [pair.score]);
      else list.push(pair.score);
    }

    const byRoot = new Map<number, number[]>();
    for (let i = 0; i < members.length; i++) {
      const root = uf.find(i);
      const list = byRoot.get(root);
      if (list === undefined) byRoot.set(root, [i]);
      else list.push(i);
    }

    for (const root of [...byRoot.keys()].sort((a, b) => a - b)) {
      const indices = byRoot.get(root) ?? [];
      if (indices.length < 2) continue;
      const pairScores = scores.get(root) ?? [];
      const mean = pairScores.length > 0
        ? pairScores.reduce((sum, s) => sum + s, 0) / pairScores.length
        : 0;
      groups.push({
        fingerprint,
        members: indices.map((i) => {
          const member = members[i];
          return {
            nodeId: member?.nodeId ?? '',
            file: member?.file ?? '',
            name: member?.name ?? '',
            line: member?.line,
          };
        }),
        similarity: mean,
      });
    }
  }

  groups.sort((a, b) => {
    if (b.similarity !== a.similarity) return b.similarity - a.similarity;
    if (a.fingerprint !== b.fingerprint) return a.fingerprint.localeCompare(b.fingerprint);
    const am = a.members[0]?.nodeId ?? '';
    const bm = b.members[0]?.nodeId ?? '';
    return am.localeCompare(bm);
  });
  return groups;
}
