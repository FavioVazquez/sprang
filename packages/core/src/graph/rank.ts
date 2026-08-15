import type { KnowledgeGraph, SprangEdge, SprangNode } from '../schema/types.js';

/** Edge types that represent one file *referencing* something defined elsewhere. */
const REFERENCE_EDGE_TYPES = new Set<string>(['calls', 'imports']);

/** An identifier defined in more than this many distinct files is treated as generic noise. */
const GENERIC_IDENT_FILE_THRESHOLD = 5;

/** Minimum length before a name can qualify as "distinctive". */
const DISTINCTIVE_MIN_LENGTH = 8;

export interface RankOptions {
  /** Files the agent is actively working on — get 100x personalization and 50x outbound edge weight. */
  seedFiles?: string[];
  /** Files named in the user's query — get the same personalization mass as seeds. */
  mentionedFiles?: string[];
  /** Identifiers named in the user's query — boost edges carrying them 10x. */
  mentionedIdents?: string[];
  /** Damping factor. Default 0.85. */
  alpha?: number;
  /** Hard cap on power iterations. Default 100. */
  maxIterations?: number;
  /** L1 convergence tolerance (scaled by node count). Default 1e-6. */
  tolerance?: number;
}

export interface RankResult {
  /** file path -> PageRank score. */
  fileRank: Map<string, number>;
  /** `"path::ident"` -> share of the referencing files' rank that flowed into that definition. */
  symbolRank: Map<string, number>;
  /** Number of power iterations actually performed. */
  iterations: number;
  /** True when the L1 delta fell below `tolerance * nodeCount` before `maxIterations`. */
  converged: boolean;
}

/** One (referencer -> definer, ident) bucket of the file multigraph. */
interface RefEdge {
  from: number;
  to: number;
  ident: string;
  count: number;
  weight: number;
}

/** Compact adjacency entry used by the power iteration. */
interface OutEdge {
  to: number;
  ident: string;
  weight: number;
}

const EMPTY_STRING_ARRAY: readonly string[] = [];

/** Strip the `file:` / `function:` / `class:` prefix and recover the file path from a node id. */
function filePathFromId(id: string): string {
  // `file:src/a.ts` -> `src/a.ts`; `function:src/a.ts:doThing` -> `src/a.ts`
  const first = id.indexOf(':');
  if (first === -1) return id;
  const rest = id.slice(first + 1);
  const second = rest.lastIndexOf(':');
  if (second === -1) return rest;
  // Only treat the tail as a symbol name when it looks like one (no path separator).
  const tail = rest.slice(second + 1);
  if (tail.includes('/')) return rest;
  return rest.slice(0, second);
}

/** Recover the identifier a node defines from its id, e.g. `function:src/a.ts:doThing` -> `doThing`. */
function identFromId(id: string): string {
  const idx = id.lastIndexOf(':');
  if (idx === -1) return id;
  return id.slice(idx + 1);
}

function basename(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx === -1 ? path : path.slice(idx + 1);
}

function stripExtension(name: string): string {
  const idx = name.lastIndexOf('.');
  return idx <= 0 ? name : name.slice(0, idx);
}

/** File a node belongs to. Prefers explicit metadata, falls back to parsing the id. */
function fileOfNode(node: SprangNode | undefined, id: string): string {
  if (node === undefined) return filePathFromId(id);
  if (node.type === 'file') return node.filePath ?? node.location?.file ?? filePathFromId(node.id);
  return node.location?.file ?? node.filePath ?? filePathFromId(node.id);
}

/** Identifier a node defines. */
function identOfNode(node: SprangNode | undefined, id: string): string {
  if (node === undefined) return identFromId(id);
  if (node.type === 'file') {
    return stripExtension(basename(fileOfNode(node, id)));
  }
  return node.name ?? node.label ?? identFromId(node.id);
}

/**
 * A name is "distinctive" when it is long enough to be unlikely to collide and
 * carries word structure — snake_case, kebab-case or camelCase. Aider uses the
 * same heuristic to favour references to purpose-built symbols over references
 * to short generic ones.
 */
function isDistinctive(ident: string): boolean {
  if (ident.length < DISTINCTIVE_MIN_LENGTH) return false;
  if (ident.includes('_') || ident.includes('-')) return true;
  return /[a-z]/.test(ident) && /[A-Z]/.test(ident);
}

/** Path components used for the "file path mentions an identifier" personalization rule. */
function pathComponents(path: string): string[] {
  const parts = path.split('/').filter((p) => p.length > 0);
  const last = parts.length > 0 ? parts[parts.length - 1] : undefined;
  if (last !== undefined) {
    const bare = stripExtension(last);
    if (bare !== last) parts.push(bare);
  }
  return parts;
}

/**
 * Personalized PageRank over the *file reference graph*, following Aider's
 * repomap ranking algorithm (`aider/repomap.py`, `RepoMap.get_ranked_tags`).
 *
 * ## Why importance flows referencer -> definer
 *
 * Every `calls` / `imports` edge is turned into a directed edge from the file
 * doing the referencing to the file holding the definition. PageRank mass
 * therefore accrues to *the thing being used*, not to the thing doing the
 * using: a utility module that fifty files call is far more valuable context
 * than any one of its fifty callers. Because the flow is transitive, a module
 * used by a file that is itself heavily used ranks higher than one used only
 * by leaves — which is exactly the "what does this codebase revolve around?"
 * signal we want when packing a context window.
 *
 * ## Why the multiplier cascade exists
 *
 * A raw reference count is a bad proxy for relevance, so each edge's weight is
 * adjusted before the iteration (multiplicatively, in this order):
 *
 * - **x10 mentioned identifier** — the user literally named it; nothing in the
 *   graph is better evidence of relevance.
 * - **x10 distinctive name** — long snake_case/camelCase names are almost
 *   always domain-specific, so a reference to one is a real semantic link.
 * - **x0.1 leading underscore** — private/internal by convention; callers of it
 *   rarely explain the architecture.
 * - **x0.1 defined in more than five files** — `get`, `run`, `init` and friends.
 *   Their edges are mostly name collisions from imprecise symbol resolution and
 *   would otherwise create a dense fog that flattens the whole ranking.
 * - **x50 referencer is a seed file** — the agent is editing that file, so what
 *   *it* depends on matters much more than the codebase average.
 * - **x sqrt(references)** — repeated references mean more, but sub-linearly, so
 *   one file spamming a helper cannot dominate the graph.
 *
 * Seed files, mentioned files and files whose path components match a mentioned
 * identifier receive personalization mass (`100 / seedCount`, normalized to sum
 * to 1). The *same* vector absorbs dangling-node mass: if dangling mass were
 * spread uniformly instead, every leaf file in the repo would quietly bleed the
 * personalization away and the result would drift back towards plain PageRank.
 *
 * Finally the converged file rank is pushed back down onto symbols: each file
 * hands its rank to its out-edges in proportion to their weight, accumulating
 * into `symbolRank["destFile::ident"]`. That is the step that turns "important
 * files" into "important symbols", which is what a repo map actually renders.
 *
 * Deterministic: all maps are iterated in sorted key order, so two runs on the
 * same input produce bit-identical numbers.
 */
export function rankGraph(graph: KnowledgeGraph, opts: RankOptions = {}): RankResult {
  const alpha = opts.alpha ?? 0.85;
  const maxIterations = opts.maxIterations ?? 100;
  const tolerance = opts.tolerance ?? 1e-6;
  const mentionedIdents = new Set(opts.mentionedIdents ?? EMPTY_STRING_ARRAY);
  const seedFiles = new Set(opts.seedFiles ?? EMPTY_STRING_ARRAY);
  const mentionedFiles = new Set(opts.mentionedFiles ?? EMPTY_STRING_ARRAY);

  // ── 1. Collect the file universe ────────────────────────────────────────
  const nodeById = new Map<string, SprangNode>();
  for (const node of graph.nodes) nodeById.set(node.id, node);

  const fileSet = new Set<string>();
  for (const node of graph.nodes) {
    const path = fileOfNode(node, node.id);
    if (path.length > 0) fileSet.add(path);
  }
  for (const edge of graph.edges) {
    if (!REFERENCE_EDGE_TYPES.has(edge.type)) continue;
    for (const id of [edge.source, edge.target]) {
      const path = fileOfNode(nodeById.get(id), id);
      if (path.length > 0) fileSet.add(path);
    }
  }

  const files = [...fileSet].sort();
  const n = files.length;
  if (n === 0) {
    return { fileRank: new Map(), symbolRank: new Map(), iterations: 0, converged: true };
  }

  const indexOfFile = new Map<string, number>();
  for (let i = 0; i < n; i++) indexOfFile.set(files[i] as string, i);

  // ── 2. Build the (referencer, definer, ident) multigraph ────────────────
  const buckets = new Map<string, RefEdge>();
  /** ident -> distinct files that define it (used for the generic-noise demotion). */
  const definersByIdent = new Map<string, Set<string>>();

  for (const edge of graph.edges as SprangEdge[]) {
    if (!REFERENCE_EDGE_TYPES.has(edge.type)) continue;

    const sourceNode = nodeById.get(edge.source);
    const targetNode = nodeById.get(edge.target);
    const referencer = fileOfNode(sourceNode, edge.source);
    const definer = fileOfNode(targetNode, edge.target);
    if (referencer.length === 0 || definer.length === 0) continue;
    if (referencer === definer) continue; // self-edges carry no information

    const ident =
      edge.type === 'imports'
        ? basename(definer)
        : identOfNode(targetNode, edge.target);
    if (ident.length === 0) continue;

    let definers = definersByIdent.get(ident);
    if (definers === undefined) {
      definers = new Set<string>();
      definersByIdent.set(ident, definers);
    }
    definers.add(definer);

    const from = indexOfFile.get(referencer);
    const to = indexOfFile.get(definer);
    if (from === undefined || to === undefined) continue;

    const key = `${referencer}\u0000${definer}\u0000${ident}`;
    const existing = buckets.get(key);
    if (existing === undefined) {
      buckets.set(key, { from, to, ident, count: 1, weight: 0 });
    } else {
      existing.count += 1;
    }
  }

  // ── 3. Weight cascade ───────────────────────────────────────────────────
  const bucketKeys = [...buckets.keys()].sort();
  const outEdges: OutEdge[][] = Array.from({ length: n }, () => []);
  const totalOutWeight = new Float64Array(n);

  for (const key of bucketKeys) {
    const bucket = buckets.get(key) as RefEdge;
    const { ident } = bucket;
    let weight = 1;
    if (mentionedIdents.has(ident)) weight *= 10;
    if (isDistinctive(ident)) weight *= 10;
    if (ident.startsWith('_')) weight *= 0.1;
    if ((definersByIdent.get(ident)?.size ?? 0) > GENERIC_IDENT_FILE_THRESHOLD) weight *= 0.1;
    if (seedFiles.has(files[bucket.from] as string)) weight *= 50;
    weight *= Math.sqrt(bucket.count);
    bucket.weight = weight;

    if (weight <= 0) continue;
    (outEdges[bucket.from] as OutEdge[]).push({ to: bucket.to, ident, weight });
    totalOutWeight[bucket.from] = (totalOutWeight[bucket.from] ?? 0) + weight;
  }

  // ── 4. Personalization vector ───────────────────────────────────────────
  const personalization = new Float64Array(n);
  const explicitSeeds = new Set<string>([...seedFiles, ...mentionedFiles]);
  const seedCount = Math.max(1, explicitSeeds.size);
  const perSeed = 100 / seedCount;

  const personalized = new Set<string>();
  for (const path of [...explicitSeeds].sort()) {
    if (indexOfFile.has(path)) personalized.add(path);
  }
  if (mentionedIdents.size > 0) {
    for (const path of files) {
      if (personalized.has(path)) continue;
      // Added once per file, no matter how many components match.
      if (pathComponents(path).some((c) => mentionedIdents.has(c))) personalized.add(path);
    }
  }

  let personalizationTotal = 0;
  for (const path of [...personalized].sort()) {
    const idx = indexOfFile.get(path);
    if (idx === undefined) continue;
    personalization[idx] = (personalization[idx] ?? 0) + perSeed;
    personalizationTotal += perSeed;
  }

  if (personalizationTotal > 0) {
    for (let i = 0; i < n; i++) personalization[i] = (personalization[i] ?? 0) / personalizationTotal;
  } else {
    // No personalization requested (or none of the seeds exist) -> plain PageRank.
    for (let i = 0; i < n; i++) personalization[i] = 1 / n;
  }

  // ── 5. Power iteration ──────────────────────────────────────────────────
  let rank = new Float64Array(n);
  for (let i = 0; i < n; i++) rank[i] = 1 / n;
  let next = new Float64Array(n);

  const danglingNodes: number[] = [];
  for (let i = 0; i < n; i++) if ((totalOutWeight[i] ?? 0) === 0) danglingNodes.push(i);

  let iterations = 0;
  let converged = false;
  const threshold = tolerance * n;

  for (let iter = 0; iter < maxIterations; iter++) {
    iterations = iter + 1;

    let danglingMass = 0;
    for (const i of danglingNodes) danglingMass += rank[i] ?? 0;

    const teleport = (1 - alpha) + alpha * danglingMass;
    for (let i = 0; i < n; i++) next[i] = teleport * (personalization[i] ?? 0);

    for (let u = 0; u < n; u++) {
      const total = totalOutWeight[u] ?? 0;
      if (total === 0) continue;
      const share = (alpha * (rank[u] ?? 0)) / total;
      if (share === 0) continue;
      for (const e of outEdges[u] as OutEdge[]) {
        next[e.to] = (next[e.to] ?? 0) + share * e.weight;
      }
    }

    let delta = 0;
    for (let i = 0; i < n; i++) delta += Math.abs((next[i] ?? 0) - (rank[i] ?? 0));

    const swap = rank;
    rank = next;
    next = swap;

    if (delta < threshold) {
      converged = true;
      break;
    }
  }

  const fileRank = new Map<string, number>();
  for (let i = 0; i < n; i++) fileRank.set(files[i] as string, rank[i] ?? 0);

  // ── 6. Push file rank down onto symbols ─────────────────────────────────
  const symbolRank = new Map<string, number>();
  for (let u = 0; u < n; u++) {
    const total = totalOutWeight[u] ?? 0;
    if (total === 0) continue;
    const r = rank[u] ?? 0;
    if (r === 0) continue;
    for (const e of outEdges[u] as OutEdge[]) {
      const key = `${files[e.to] as string}::${e.ident}`;
      symbolRank.set(key, (symbolRank.get(key) ?? 0) + (r * e.weight) / total);
    }
  }

  return { fileRank, symbolRank, iterations, converged };
}
