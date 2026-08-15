import type { KnowledgeGraph, SprangEdge, SprangNode } from '../schema/types.js';

/**
 * Community detection over the file-level import graph (Louvain).
 *
 * Why this exists
 * ---------------
 * Sprang can already say what a single file does. What it could not say is
 * "which files form a *module* in practice", independent of what the directory
 * tree claims. Directories are what somebody intended two years ago; the import
 * graph is what the code actually does today. Louvain communities surface the
 * difference — a `utils/` folder that is really three unrelated clusters, or a
 * feature whose implementation is smeared across four top-level directories.
 *
 * Everything here is a pure, deterministic function of the graph: no clock, no
 * I/O and no `Math.random`. Two scans of an unchanged repository must produce
 * byte-identical communities, otherwise every scan shows up as a diff and the
 * output becomes noise. Determinism is achieved by iterating nodes in sorted
 * id order and by breaking every tie on the lowest community index — the
 * classic Louvain "shuffle the node order" step is deliberately omitted.
 *
 * Algorithm: Blondel, Guillaume, Lambiotte & Lefebvre (2008),
 * "Fast unfolding of communities in large networks".
 */

/** A detected cluster of files. */
export interface Community {
  /** Stable id of the form `community-<n>`, assigned after final ordering. */
  id: string;
  /** Member node ids (file nodes), sorted lexicographically. */
  nodeIds: string[];
  /** Human-facing name — a directory when one describes the members well. */
  label: string;
  /** Distinct undirected import pairs with both endpoints inside. */
  internalEdges: number;
  /** Distinct undirected import pairs with exactly one endpoint inside. */
  externalEdges: number;
}

export interface LouvainOptions {
  /**
   * Resolution `gamma`. Above 1 yields more, smaller communities; below 1
   * yields fewer, larger ones. Default 1 (classic modularity).
   */
  resolution?: number;
  /** Maximum number of Louvain levels (local moving + aggregation). Default 10. */
  maxPasses?: number;
  /**
   * Accepted for API compatibility and ignored: this implementation contains
   * no randomness, so there is nothing to seed. It is part of the signature so
   * callers that expect the usual Louvain knobs do not have to special-case us.
   */
  seed?: number;
}

/**
 * The subset of a `KnowledgeGraph` these functions actually read.
 *
 * Accepting the narrow shape means tests (and callers holding a partially
 * built graph) do not have to fabricate `stats`, `tours` and friends. A full
 * `KnowledgeGraph` is assignable to it, so the documented signature still holds.
 */
export type GraphInput = Pick<KnowledgeGraph, 'nodes' | 'edges'>;

/** Edge type that defines the dependency structure between files. */
const IMPORT_EDGE: SprangEdge['type'] = 'imports';

/** Floating point slack — modularity gains below this are treated as zero. */
const EPSILON = 1e-12;

/** Safety valve on the local-moving sweep, which is guaranteed to converge. */
const MAX_LOCAL_MOVING_SWEEPS = 64;

// ─── Graph extraction ────────────────────────────────────────────────

/** Best-effort project-relative path for a node. */
function pathOf(node: SprangNode): string | undefined {
  const raw = node.filePath ?? node.location?.file;
  if (typeof raw === 'string' && raw.length > 0) return raw;
  if (node.id.startsWith('file:')) {
    const tail = node.id.slice('file:'.length);
    return tail.length > 0 ? tail : undefined;
  }
  return undefined;
}

/**
 * An undirected weighted graph in adjacency-map form.
 *
 * `adj[i]` maps neighbour index -> weight; a self-loop is stored once with its
 * raw weight. Degrees follow the standard convention `k_i = sum_j A_ij` where
 * `A_ii = 2 * selfLoopWeight`, so `twoM = sum_i k_i`.
 */
interface WeightedGraph {
  size: number;
  adj: Array<Map<number, number>>;
  k: number[];
  twoM: number;
}

function emptyWeightedGraph(size: number): WeightedGraph {
  const adj: Array<Map<number, number>> = [];
  for (let i = 0; i < size; i++) adj.push(new Map<number, number>());
  return { size, adj, k: new Array<number>(size).fill(0), twoM: 0 };
}

function addWeight(g: WeightedGraph, i: number, j: number, w: number): void {
  if (w === 0) return;
  const ai = g.adj[i];
  const aj = g.adj[j];
  if (ai === undefined || aj === undefined) return;
  if (i === j) {
    ai.set(i, (ai.get(i) ?? 0) + w);
    g.k[i] = (g.k[i] ?? 0) + 2 * w;
  } else {
    ai.set(j, (ai.get(j) ?? 0) + w);
    aj.set(i, (aj.get(i) ?? 0) + w);
    g.k[i] = (g.k[i] ?? 0) + w;
    g.k[j] = (g.k[j] ?? 0) + w;
  }
  g.twoM += 2 * w;
}

interface ExtractedGraph {
  /** File node ids in sorted order; index into the weighted graph. */
  ids: string[];
  /** node id -> index. */
  index: Map<string, number>;
  /** Project-relative path per index (falls back to the id). */
  paths: string[];
  weighted: WeightedGraph;
}

/**
 * Project the knowledge graph down to "files connected by imports".
 *
 * Import edges are frequently recorded between symbol nodes (a function that
 * imports a module, say). Those are lifted to their containing file so that a
 * symbol-level scan and a file-level scan produce the same communities. Edges
 * whose endpoints cannot be resolved to a known file node are dropped.
 *
 * The graph is treated as undirected: for clustering purposes `a imports b`
 * and `b imports a` are the same evidence of cohesion. Parallel edges are
 * summed, so a reciprocal import is simply a heavier edge.
 */
function extractFileGraph(graph: GraphInput): ExtractedGraph {
  const nodeById = new Map<string, SprangNode>();
  for (const node of graph.nodes) nodeById.set(node.id, node);

  const fileIds: string[] = [];
  for (const node of graph.nodes) {
    if (node.type === 'file') fileIds.push(node.id);
  }
  fileIds.sort();

  const index = new Map<string, number>();
  fileIds.forEach((id, i) => index.set(id, i));

  const paths = fileIds.map((id) => {
    const node = nodeById.get(id);
    return (node ? pathOf(node) : undefined) ?? id;
  });

  /** Resolve any node id to the index of the file node that contains it. */
  const resolve = (id: string): number | undefined => {
    const direct = index.get(id);
    if (direct !== undefined) return direct;
    const node = nodeById.get(id);
    if (node === undefined) return undefined;
    const path = pathOf(node);
    if (path === undefined) return undefined;
    return index.get(`file:${path}`);
  };

  const weighted = emptyWeightedGraph(fileIds.length);
  for (const edge of graph.edges) {
    if (edge.type !== IMPORT_EDGE) continue;
    const a = resolve(edge.source);
    const b = resolve(edge.target);
    if (a === undefined || b === undefined) continue;
    const w = typeof edge.weight === 'number' && Number.isFinite(edge.weight) && edge.weight > 0 ? edge.weight : 1;
    addWeight(weighted, a, b, w);
  }

  return { ids: fileIds, index, paths, weighted };
}

// ─── Modularity ──────────────────────────────────────────────────────

/**
 * Modularity of a partition given as an array of community ids per index.
 *
 * `Q = (1/2m) * sum_ij [A_ij - gamma * k_i*k_j/(2m)] * delta(c_i, c_j)`
 */
function partitionModularity(g: WeightedGraph, membership: number[], resolution: number): number {
  if (g.twoM === 0) return 0;
  let internal = 0; // sum of A_ij over same-community pairs, both orientations
  const totals = new Map<number, number>();
  for (let i = 0; i < g.size; i++) {
    const ci = membership[i];
    if (ci === undefined) continue;
    totals.set(ci, (totals.get(ci) ?? 0) + (g.k[i] ?? 0));
    const neighbours = g.adj[i];
    if (neighbours === undefined) continue;
    for (const [j, w] of neighbours) {
      if (j < i) continue; // count each unordered pair once
      if (membership[j] !== ci) continue;
      internal += 2 * w; // A_ij + A_ji, and A_ii = 2*w for self-loops
    }
  }
  let expected = 0;
  for (const total of totals.values()) expected += total * total;
  return internal / g.twoM - (resolution * expected) / (g.twoM * g.twoM);
}

/**
 * Public modularity of an explicit set of communities.
 *
 * Nodes not mentioned by any community are treated as singletons, and a node
 * listed in two communities is attributed to the first one in the given order,
 * so a malformed partition degrades rather than throws.
 */
export function modularity(graph: GraphInput, communities: Community[], resolution = 1): number {
  const extracted = extractFileGraph(graph);
  const g = extracted.weighted;
  if (g.size === 0 || g.twoM === 0) return 0;

  const membership = new Array<number>(g.size).fill(-1);
  communities.forEach((community, ci) => {
    for (const nodeId of community.nodeIds) {
      const idx = extracted.index.get(nodeId);
      if (idx === undefined) continue;
      if (membership[idx] !== -1) continue;
      membership[idx] = ci;
    }
  });
  // Unassigned nodes become singletons with ids beyond the community range.
  let next = communities.length;
  for (let i = 0; i < membership.length; i++) {
    if (membership[i] === -1) membership[i] = next++;
  }
  return partitionModularity(g, membership, resolution);
}

// ─── Louvain ─────────────────────────────────────────────────────────

/**
 * Phase 1: greedily move each node to the neighbouring community that yields
 * the largest modularity gain, repeating until no node moves.
 *
 * Gain of moving isolated node `i` into community `c`:
 *   `dQ = k_i_in/m - gamma * (sigma_tot * k_i) / (2m^2)`
 * which is O(deg(i)) to evaluate for every candidate community, and is what
 * makes Louvain fast. Nodes are visited in index order (== sorted id order)
 * and ties go to the lowest community index, which is what makes it
 * deterministic.
 */
function localMoving(g: WeightedGraph, resolution: number): number[] {
  const membership: number[] = [];
  for (let i = 0; i < g.size; i++) membership.push(i);
  if (g.twoM === 0) return membership;

  const m = g.twoM / 2;
  const sigmaTot = g.k.slice();

  for (let sweep = 0; sweep < MAX_LOCAL_MOVING_SWEEPS; sweep++) {
    let moved = false;
    for (let i = 0; i < g.size; i++) {
      const ki = g.k[i] ?? 0;
      const current = membership[i];
      const neighbours = g.adj[i];
      if (current === undefined || neighbours === undefined) continue;

      // Temporarily isolate i so its own degree does not appear in sigma_tot.
      sigmaTot[current] = (sigmaTot[current] ?? 0) - ki;

      const weightTo = new Map<number, number>();
      for (const [j, w] of neighbours) {
        if (j === i) continue; // a self-loop moves with the node
        const cj = membership[j];
        if (cj === undefined) continue;
        weightTo.set(cj, (weightTo.get(cj) ?? 0) + w);
      }

      const gainOf = (c: number): number =>
        (weightTo.get(c) ?? 0) / m - (resolution * (sigmaTot[c] ?? 0) * ki) / (2 * m * m);

      let best = current;
      let bestGain = gainOf(current);
      const candidates = [...weightTo.keys()].sort((a, b) => a - b);
      for (const c of candidates) {
        if (c === current) continue;
        const gain = gainOf(c);
        if (gain > bestGain + EPSILON) {
          bestGain = gain;
          best = c;
        }
      }

      sigmaTot[best] = (sigmaTot[best] ?? 0) + ki;
      if (best !== current) {
        membership[i] = best;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return membership;
}

/** Renumber arbitrary community labels to a dense `0..n-1` in first-seen order. */
function densify(membership: number[]): { dense: number[]; count: number } {
  const remap = new Map<number, number>();
  const dense: number[] = [];
  for (const c of membership) {
    let mapped = remap.get(c);
    if (mapped === undefined) {
      mapped = remap.size;
      remap.set(c, mapped);
    }
    dense.push(mapped);
  }
  return { dense, count: remap.size };
}

/** Phase 2: collapse each community into a single node of the next level. */
function aggregate(g: WeightedGraph, dense: number[], count: number): WeightedGraph {
  const next = emptyWeightedGraph(count);
  for (let i = 0; i < g.size; i++) {
    const ci = dense[i];
    const neighbours = g.adj[i];
    if (ci === undefined || neighbours === undefined) continue;
    for (const [j, w] of neighbours) {
      if (j < i) continue; // each unordered pair once
      const cj = dense[j];
      if (cj === undefined) continue;
      addWeight(next, ci, cj, w);
    }
  }
  return next;
}

// ─── Post-hoc connectivity split ─────────────────────────────────────

/**
 * Split any community that is not internally connected.
 *
 * Louvain can provably return communities whose induced subgraph is
 * disconnected (Traag, Waltman & van Eck, 2019 — "From Louvain to Leiden"):
 * a node that acted as a bridge can be moved away in a later sweep, leaving
 * the two halves it joined in the same community with no path between them.
 * Such a community is meaningless to a human reading it as "a module".
 *
 * The Leiden algorithm fixes this properly with a refinement phase. Running
 * connected components over each community afterwards and splitting the
 * disconnected ones is a fraction of the code and removes the pathology that
 * actually matters here — roughly 90% of Leiden's practical benefit for 10% of
 * the effort. What it does not recover is Leiden's better partition *quality*
 * (its refinement can also find splits that raise modularity); we accept that,
 * because for Sprang a slightly-suboptimal-but-connected partition is far more
 * useful than an optimal one containing incoherent bags of files.
 */
function splitDisconnected(g: WeightedGraph, membership: number[]): number[] {
  const groups = new Map<number, number[]>();
  for (let i = 0; i < membership.length; i++) {
    const c = membership[i];
    if (c === undefined) continue;
    const bucket = groups.get(c);
    if (bucket === undefined) groups.set(c, [i]);
    else bucket.push(i);
  }

  const out = membership.slice();
  let nextLabel = 0;
  for (const c of [...groups.keys()].sort((a, b) => a - b)) {
    const members = groups.get(c) ?? [];
    const memberSet = new Set(members);
    const seen = new Set<number>();
    for (const start of members) {
      if (seen.has(start)) continue;
      // BFS over the induced subgraph; self-loops connect nothing.
      const label = nextLabel++;
      const queue = [start];
      seen.add(start);
      while (queue.length > 0) {
        const node = queue.shift();
        if (node === undefined) continue;
        out[node] = label;
        const neighbours = g.adj[node];
        if (neighbours === undefined) continue;
        for (const j of [...neighbours.keys()].sort((a, b) => a - b)) {
          if (j === node || !memberSet.has(j) || seen.has(j)) continue;
          seen.add(j);
          queue.push(j);
        }
      }
    }
  }
  return out;
}

// ─── Labelling ───────────────────────────────────────────────────────

function directoryOf(path: string): string[] {
  const parts = path.split('/').filter((p) => p.length > 0);
  return parts.slice(0, -1); // drop the filename
}

/**
 * Name a community after the code, not after a counter.
 *
 * Preference order, most to least informative:
 *  1. the longest common directory prefix of all members (`src/graph`),
 *  2. the most common top-level directory when members are spread out
 *     (`src/*`), which still tells a reader where to look,
 *  3. `community-<n>` when the members share nothing at all — a genuinely
 *     cross-cutting cluster, and worth seeing as such.
 */
function labelFor(paths: string[], fallbackIndex: number): string {
  const fallback = `community-${fallbackIndex}`;
  if (paths.length === 0) return fallback;

  const dirs = paths.map(directoryOf);
  const first = dirs[0];
  if (first !== undefined) {
    let common = first.length;
    for (const d of dirs) {
      let i = 0;
      while (i < common && i < d.length && d[i] === first[i]) i++;
      common = i;
      if (common === 0) break;
    }
    if (common > 0) return first.slice(0, common).join('/');
  }

  const counts = new Map<string, number>();
  for (const d of dirs) {
    const top = d[0];
    if (top === undefined) continue;
    counts.set(top, (counts.get(top) ?? 0) + 1);
  }
  if (counts.size > 0) {
    const ranked = [...counts.entries()].sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]));
    const winner = ranked[0];
    if (winner !== undefined) return `${winner[0]}/*`;
  }
  return fallback;
}

// ─── Public entry point ──────────────────────────────────────────────

/**
 * Detect communities of files over the `imports` graph.
 *
 * Guarantees:
 *  - every `file` node appears in exactly one community (isolated files become
 *    singletons, so the result is a true partition);
 *  - each community's induced subgraph is connected;
 *  - output order is deterministic: largest first, ties broken by first
 *    member id, and `id`/`label` are assigned only after ordering.
 */
export function detectCommunities(graph: KnowledgeGraph | GraphInput, opts?: LouvainOptions): Community[] {
  const resolution = opts?.resolution !== undefined && Number.isFinite(opts.resolution) && opts.resolution > 0
    ? opts.resolution
    : 1;
  const maxPasses = opts?.maxPasses !== undefined && Number.isFinite(opts.maxPasses) && opts.maxPasses > 0
    ? Math.floor(opts.maxPasses)
    : 10;

  const extracted = extractFileGraph(graph);
  const base = extracted.weighted;
  if (base.size === 0) return [];

  // Start from the singleton partition; that is also the answer for an
  // edge-less graph, where no move can ever improve modularity.
  let membership: number[] = [];
  for (let i = 0; i < base.size; i++) membership.push(i);
  let bestQ = partitionModularity(base, membership, resolution);

  let level = base;
  let levelMembership = membership; // base index -> current level node
  for (let pass = 0; pass < maxPasses && level.twoM > 0 && level.size > 1; pass++) {
    const moved = localMoving(level, resolution);
    const { dense, count } = densify(moved);
    if (count === level.size) break; // nothing merged: converged

    const candidate = levelMembership.map((c) => dense[c] ?? 0);
    const q = partitionModularity(base, candidate, resolution);
    if (q <= bestQ + 1e-9) break; // Q stopped improving

    bestQ = q;
    membership = candidate;
    levelMembership = candidate;
    level = aggregate(level, dense, count);
  }

  const split = splitDisconnected(base, membership);
  const { dense } = densify(split);

  // Group indices, then order communities deterministically.
  const buckets = new Map<number, number[]>();
  for (let i = 0; i < dense.length; i++) {
    const c = dense[i];
    if (c === undefined) continue;
    const bucket = buckets.get(c);
    if (bucket === undefined) buckets.set(c, [i]);
    else bucket.push(i);
  }

  const ordered = [...buckets.values()].sort((a, b) => {
    if (b.length !== a.length) return b.length - a.length;
    const ai = extracted.ids[a[0] ?? 0] ?? '';
    const bi = extracted.ids[b[0] ?? 0] ?? '';
    return ai.localeCompare(bi);
  });

  return ordered.map((indices, n) => {
    const memberSet = new Set(indices);
    let internalEdges = 0;
    let externalEdges = 0;
    for (const i of indices) {
      const neighbours = base.adj[i];
      if (neighbours === undefined) continue;
      for (const j of neighbours.keys()) {
        if (memberSet.has(j)) {
          if (j >= i) internalEdges++; // each unordered pair once; self-loop counts
        } else {
          externalEdges++;
        }
      }
    }
    const nodeIds = indices.map((i) => extracted.ids[i] ?? '').sort();
    const paths = indices.map((i) => extracted.paths[i] ?? '').sort();
    return {
      id: `community-${n}`,
      nodeIds,
      label: labelFor(paths, n),
      internalEdges,
      externalEdges,
    };
  });
}
