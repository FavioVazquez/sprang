import type { KnowledgeGraph, SprangEdge, SprangNode } from '../schema/types.js';

/**
 * Architecture metrics — the numbers that describe the *shape* of a codebase
 * rather than the contents of any one file.
 *
 * Sprang already answers "what is in this file" well. What it could not answer
 * is "is this codebase's dependency structure healthy, and if not, which single
 * edge should I delete first". These three metric families answer that:
 *
 *  - `findCycles`            — where the dependency graph stopped being a DAG.
 *  - `computeMartinMetrics`  — where components sit on the stability/abstraction
 *                              main sequence, and which dependencies point the
 *                              wrong way (SDP violations).
 *  - `computeLcom4`          — which classes are really two classes in a coat.
 *
 * Everything here is a pure function of the graph: no I/O, no clock, no
 * randomness, so results are reproducible and diffable across scans.
 */

// ─── Shared helpers ──────────────────────────────────────────────────

/** Edge type used for the file-level dependency graph. */
const IMPORT_EDGE: SprangEdge['type'] = 'imports';

/**
 * Best-effort project-relative path for a node.
 *
 * Nodes are not guaranteed to carry a location — synthetic nodes (concepts,
 * domains, knowledge articles) legitimately have none — so every caller must
 * cope with `undefined` rather than assuming a path exists.
 */
function pathOf(node: SprangNode): string | undefined {
  const raw = node.filePath ?? node.location?.file;
  if (typeof raw === 'string' && raw.length > 0) return raw;
  // `file:src/a.ts` style ids are the canonical form emitted by the scanner,
  // so they are a safe last resort when location metadata was dropped.
  if (node.type === 'file' && node.id.startsWith('file:')) {
    const tail = node.id.slice('file:'.length);
    return tail.length > 0 ? tail : undefined;
  }
  return undefined;
}

/** Display name for a symbol node, falling back through the id's last segment. */
function nameOf(node: SprangNode): string {
  if (typeof node.name === 'string' && node.name.length > 0) return node.name;
  if (node.label.length > 0) return node.label;
  const parts = node.id.split(':');
  const last = parts[parts.length - 1];
  return last ?? node.id;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: string[] = [];
  for (const item of value) if (typeof item === 'string') out.push(item);
  return out;
}

/**
 * The file-level `imports` graph: only edges whose *both* endpoints resolve to
 * a file node that actually exists in `graph.nodes`.
 *
 * Dangling edges (a target that was filtered out of the scan, or a stale edge
 * left by an incremental rebuild) are dropped rather than treated as phantom
 * nodes, and self-imports are dropped from the adjacency because they are a
 * resolver artefact — `findCycles` reports them separately as self-loops.
 */
interface FileImportGraph {
  /** All file node ids, sorted, so every downstream result is deterministic. */
  nodes: string[];
  /** id → sorted, de-duplicated list of imported file ids (no self-edges). */
  adjacency: Map<string, string[]>;
  /** File ids that import themselves. */
  selfLoops: string[];
  /** `${source}\u0000${target}` → smallest declared weight on that pair. */
  weights: Map<string, number>;
}

function buildFileImportGraph(graph: Pick<KnowledgeGraph, 'nodes' | 'edges'>): FileImportGraph {
  const fileIds = new Set<string>();
  for (const node of graph.nodes) if (node.type === 'file') fileIds.add(node.id);

  const targets = new Map<string, Set<string>>();
  const selfLoops = new Set<string>();
  const weights = new Map<string, number>();

  for (const edge of graph.edges) {
    if (edge.type !== IMPORT_EDGE) continue;
    if (!fileIds.has(edge.source) || !fileIds.has(edge.target)) continue;
    if (edge.source === edge.target) {
      selfLoops.add(edge.source);
      continue;
    }
    let set = targets.get(edge.source);
    if (!set) {
      set = new Set<string>();
      targets.set(edge.source, set);
    }
    set.add(edge.target);

    if (typeof edge.weight === 'number' && Number.isFinite(edge.weight)) {
      const key = `${edge.source}\u0000${edge.target}`;
      const existing = weights.get(key);
      weights.set(key, existing === undefined ? edge.weight : Math.min(existing, edge.weight));
    }
  }

  const adjacency = new Map<string, string[]>();
  for (const [source, set] of targets) adjacency.set(source, [...set].sort());

  return {
    nodes: [...fileIds].sort(),
    adjacency,
    selfLoops: [...selfLoops].sort(),
    weights,
  };
}

// ─── 1. Cycles ───────────────────────────────────────────────────────

export interface CycleCut {
  from: string;
  to: string;
}

export interface DependencyCycle {
  /** Every file node id in the strongly connected component, sorted. */
  members: string[];
  /**
   * A shortest closed walk proving the cycle, first element repeated last:
   * `['file:a', 'file:b', 'file:a']`. A three-file cycle yields four entries.
   */
  witness: string[];
  /** The single edge most worth deleting, or `null` if none could be chosen. */
  suggestedCut: CycleCut | null;
}

/**
 * Above this many intra-component edges the exhaustive "which removal breaks it
 * up most" search is skipped in favour of the witness edge. The search is
 * O(E·(V+E)); real cycles are small, but a pathological monorepo should not
 * turn a metrics pass into a hang.
 */
const MAX_EDGES_FOR_CUT_SEARCH = 400;
/** Above this many members the witness is computed from one member, not all. */
const MAX_MEMBERS_FOR_FULL_WITNESS_SEARCH = 100;

/**
 * Tarjan's strongly-connected-components algorithm, iterative.
 *
 * Deliberately not recursive: import graphs in a large monorepo routinely reach
 * depths in the tens of thousands, and V8's default stack blows out long before
 * that. The explicit frame stack costs a little clarity and buys the ability to
 * run on any graph Sprang can load.
 */
function tarjanScc(nodes: readonly string[], adjacency: Map<string, string[]>): string[][] {
  const index = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Set<string>();
  const pending: string[] = [];
  const components: string[][] = [];
  let counter = 0;

  interface Frame {
    node: string;
    edges: string[];
    cursor: number;
  }

  for (const root of nodes) {
    if (index.has(root)) continue;

    index.set(root, counter);
    lowlink.set(root, counter);
    counter += 1;
    pending.push(root);
    onStack.add(root);

    const frames: Frame[] = [{ node: root, edges: adjacency.get(root) ?? [], cursor: 0 }];

    while (frames.length > 0) {
      const frame = frames[frames.length - 1];
      if (!frame) break;

      if (frame.cursor < frame.edges.length) {
        const next = frame.edges[frame.cursor];
        frame.cursor += 1;
        if (next === undefined) continue;

        if (!index.has(next)) {
          index.set(next, counter);
          lowlink.set(next, counter);
          counter += 1;
          pending.push(next);
          onStack.add(next);
          frames.push({ node: next, edges: adjacency.get(next) ?? [], cursor: 0 });
        } else if (onStack.has(next)) {
          const current = lowlink.get(frame.node) ?? 0;
          lowlink.set(frame.node, Math.min(current, index.get(next) ?? 0));
        }
        continue;
      }

      frames.pop();
      const parent = frames[frames.length - 1];
      if (parent) {
        const parentLow = lowlink.get(parent.node) ?? 0;
        lowlink.set(parent.node, Math.min(parentLow, lowlink.get(frame.node) ?? 0));
      }

      if (lowlink.get(frame.node) === index.get(frame.node)) {
        const component: string[] = [];
        for (;;) {
          const popped = pending.pop();
          if (popped === undefined) break;
          onStack.delete(popped);
          component.push(popped);
          if (popped === frame.node) break;
        }
        components.push(component);
      }
    }
  }

  return components;
}

/** Shortest closed walk from `start` back to `start` inside `adjacency`, or null. */
function shortestCycleFrom(start: string, adjacency: Map<string, string[]>): string[] | null {
  const parent = new Map<string, string>();
  const seen = new Set<string>([start]);
  let frontier: string[] = [start];

  while (frontier.length > 0) {
    const nextFrontier: string[] = [];
    for (const node of frontier) {
      for (const neighbour of adjacency.get(node) ?? []) {
        if (neighbour === start) {
          const path: string[] = [node];
          let cursor = node;
          for (;;) {
            const prev = parent.get(cursor);
            if (prev === undefined) break;
            path.push(prev);
            cursor = prev;
          }
          path.reverse();
          return [...path, start];
        }
        if (seen.has(neighbour)) continue;
        seen.add(neighbour);
        parent.set(neighbour, node);
        nextFrontier.push(neighbour);
      }
    }
    frontier = nextFrontier;
  }
  return null;
}

/** Adjacency restricted to a member set, used for per-cycle analysis. */
function inducedAdjacency(
  members: readonly string[],
  adjacency: Map<string, string[]>,
  skip?: CycleCut,
): Map<string, string[]> {
  const memberSet = new Set(members);
  const induced = new Map<string, string[]>();
  for (const member of members) {
    const kept: string[] = [];
    for (const target of adjacency.get(member) ?? []) {
      if (!memberSet.has(target)) continue;
      if (skip && skip.from === member && skip.to === target) continue;
      kept.push(target);
    }
    induced.set(member, kept);
  }
  return induced;
}

/**
 * Choose the edge to recommend deleting.
 *
 * Two strategies, in order:
 *  1. **Symbol count.** If *every* intra-cycle edge carries a numeric `weight`
 *     (the scanner uses it for the number of distinct imported symbols), the
 *     lightest edge wins — it is the cheapest to replace with an interface, a
 *     parameter, or an event.
 *  2. **Maximum disconnection.** Otherwise, each edge is provisionally removed
 *     and the component re-analysed; the edge that leaves the *smallest largest
 *     remaining* strongly connected component wins, i.e. the one whose removal
 *     breaks the tangle into the most pieces. Ties resolve by fewest nodes left
 *     in any cycle, then lexicographically, so the answer is stable.
 */
function chooseCut(
  members: readonly string[],
  adjacency: Map<string, string[]>,
  weights: Map<string, number>,
  witness: readonly string[],
): CycleCut | null {
  const induced = inducedAdjacency(members, adjacency);
  const edges: CycleCut[] = [];
  for (const member of members) {
    for (const target of induced.get(member) ?? []) edges.push({ from: member, to: target });
  }
  if (edges.length === 0) return null;

  // Strategy 1: weights, when the scanner supplied them for the whole cycle.
  const allWeighted = edges.every((e) => weights.has(`${e.from}\u0000${e.to}`));
  if (allWeighted) {
    let best: CycleCut | null = null;
    let bestWeight = Number.POSITIVE_INFINITY;
    for (const edge of edges) {
      const weight = weights.get(`${edge.from}\u0000${edge.to}`) ?? Number.POSITIVE_INFINITY;
      if (weight < bestWeight) {
        bestWeight = weight;
        best = edge;
      }
    }
    return best;
  }

  const witnessEdge = witnessCut(witness);

  // Strategy 2: exhaustive removal, unless the component is too large to afford it.
  if (edges.length > MAX_EDGES_FOR_CUT_SEARCH) return witnessEdge;

  let best: CycleCut | null = null;
  let bestLargest = Number.POSITIVE_INFINITY;
  let bestCyclic = Number.POSITIVE_INFINITY;
  for (const edge of edges) {
    const trimmed = inducedAdjacency(members, adjacency, edge);
    const components = tarjanScc(members, trimmed);
    let largest = 0;
    let cyclic = 0;
    for (const component of components) {
      if (component.length > largest) largest = component.length;
      if (component.length > 1) cyclic += component.length;
    }
    if (largest < bestLargest || (largest === bestLargest && cyclic < bestCyclic)) {
      bestLargest = largest;
      bestCyclic = cyclic;
      best = edge;
    }
  }
  return best ?? witnessEdge;
}

function witnessCut(witness: readonly string[]): CycleCut | null {
  const from = witness[0];
  const to = witness[1];
  if (from === undefined || to === undefined) return null;
  return { from, to };
}

/**
 * Find every circular dependency between files.
 *
 * A cycle means the files in it cannot be understood, tested, built or extracted
 * independently: they are one unit whether or not anyone decided that. Reporting
 * the whole strongly connected component (not just one loop) is what makes the
 * result actionable — a five-file tangle usually shows up as a dozen distinct
 * two-file loops otherwise, and fixing any one of them changes nothing.
 *
 * For each component you get `members` (everything trapped in the tangle), a
 * `witness` (a shortest concrete loop, so the report can show a real chain
 * rather than an unordered set) and a `suggestedCut` — the single edge whose
 * removal is estimated to do the most good; see `chooseCut` for the two
 * strategies and when each applies.
 *
 * Self-imports are reported as one-member cycles: they are almost always an
 * import-resolution bug worth surfacing, but they are not part of any SCC.
 *
 * Returns an empty array for an empty graph, a graph with no imports, or a
 * perfectly layered (acyclic) one.
 */
export function findCycles(graph: Pick<KnowledgeGraph, 'nodes' | 'edges'>): DependencyCycle[] {
  const { nodes, adjacency, selfLoops, weights } = buildFileImportGraph(graph);
  if (nodes.length === 0) return [];

  const results: DependencyCycle[] = [];

  for (const component of tarjanScc(nodes, adjacency)) {
    if (component.length < 2) continue;
    const members = [...component].sort();

    const starts =
      members.length > MAX_MEMBERS_FOR_FULL_WITNESS_SEARCH ? members.slice(0, 1) : members;
    const induced = inducedAdjacency(members, adjacency);
    let witness: string[] = [];
    for (const start of starts) {
      const candidate = shortestCycleFrom(start, induced);
      if (!candidate) continue;
      if (
        witness.length === 0 ||
        candidate.length < witness.length ||
        (candidate.length === witness.length && candidate.join('>') < witness.join('>'))
      ) {
        witness = candidate;
      }
    }

    results.push({
      members,
      witness,
      suggestedCut: chooseCut(members, adjacency, weights, witness),
    });
  }

  for (const file of selfLoops) {
    results.push({
      members: [file],
      witness: [file, file],
      suggestedCut: { from: file, to: file },
    });
  }

  results.sort((a, b) => {
    if (b.members.length !== a.members.length) return b.members.length - a.members.length;
    return (a.members[0] ?? '').localeCompare(b.members[0] ?? '');
  });
  return results;
}

// ─── 2. Martin package metrics ───────────────────────────────────────

export type MartinZone = 'pain' | 'uselessness' | 'ok';

export interface MartinMetrics {
  /** Component key, e.g. `packages/core` under the default grouping. */
  component: string;
  /** Afferent coupling: distinct files outside the component that import into it. */
  ca: number;
  /** Efferent coupling: distinct files outside the component that it imports. */
  ce: number;
  /** Instability `I = Ce / (Ca + Ce)`; 0 when the component is unconnected. */
  instability: number;
  /** Abstractness `A = abstract classes / all classes`; 0 when there are none. */
  abstractness: number;
  /** Distance from the main sequence, un-normalised: `D = |A + I - 1|`. */
  distance: number;
  zone: MartinZone;
}

export interface MartinOptions {
  /**
   * Map a project-relative file path to a component key. Defaults to the
   * directory at depth 2 (`packages/core/src/x.ts` → `packages/core`).
   */
  componentOf?: (path: string) => string;
}

/**
 * Default component grouping: the first two directory segments of the path.
 *
 * `packages/core/src/graph/x.ts` → `packages/core`, `src/a.ts` → `src`,
 * `a.ts` → `.`. Depth 2 is the sweet spot for both monorepos (`packages/<pkg>`)
 * and single packages (`src/<area>`); pass `opts.componentOf` for anything else.
 */
export function defaultComponentOf(path: string): string {
  const segments = path.split('/').filter((s) => s.length > 0);
  const directories = segments.slice(0, -1);
  if (directories.length === 0) return '.';
  return directories.slice(0, 2).join('/');
}

/** Class names that read as abstractions rather than concretions. */
const ABSTRACT_NAME_HINTS = ['Interface', 'Abstract', 'Protocol', 'Trait'];

function isAbstractType(node: SprangNode): boolean {
  if (node.metadata && node.metadata['isAbstract'] === true) return true;
  const name = nameOf(node);
  // `IFoo` (Hungarian interface prefix) but not `Invoice` — the second char
  // must be upper case for the prefix to be a marker rather than a word.
  if (/^I[A-Z]/.test(name)) return true;
  return ABSTRACT_NAME_HINTS.some((hint) => name.includes(hint));
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

interface ComponentIndex {
  /** file node id → component key. */
  componentByFileId: Map<string, string>;
  /** every component key seen, sorted. */
  components: string[];
}

function indexComponents(
  graph: Pick<KnowledgeGraph, 'nodes' | 'edges'>,
  componentOf: (path: string) => string,
): ComponentIndex {
  const componentByFileId = new Map<string, string>();
  const components = new Set<string>();
  for (const node of graph.nodes) {
    if (node.type !== 'file') continue;
    const path = pathOf(node);
    // A file node with no resolvable path belongs to no component; counting it
    // under '.' would silently merge unrelated files into a phantom component.
    if (path === undefined) continue;
    const component = componentOf(path);
    componentByFileId.set(node.id, component);
    components.add(component);
  }
  return { componentByFileId, components: [...components].sort() };
}

/**
 * Robert C. Martin's package metrics, computed per component.
 *
 * The pair (A, I) says where a component sits between "everyone depends on me,
 * so I must not change" and "I depend on everyone, so I am free to change".
 * Healthy components sit near the *main sequence* `A + I = 1`: stable things are
 * abstract, volatile things are concrete.
 *
 * **The Zone of Pain** is the corner where a component is concrete *and*
 * heavily depended upon (low A, low I, high Ca) — every change to it breaks
 * callers, and because it has no abstract surface there is no way to change it
 * without touching them, so it quietly freezes and the codebase grows around it.
 *
 * The opposite corner, the Zone of Uselessness (very abstract, nothing depends
 * on it), is usually dead abstraction: interfaces written for a future that did
 * not arrive.
 *
 * `distance` is reported **un-normalised** as `D = |A + I − 1|`, which ranges
 * 0…1 for the (A, I) unit square. Martin also defines a normalised `D′`; the
 * un-normalised form is used here because it is already 0…1 for valid inputs
 * and reads directly as "how far off the main sequence", with no extra factor
 * to explain in a report.
 *
 * Components consisting of a single file are included: with Ca = Ce = 0 they
 * come out as I = 0, A = 0, D = 1 — correctly flagged as far off the main
 * sequence but never as `pain`, since nothing depends on them.
 */
export function computeMartinMetrics(
  graph: Pick<KnowledgeGraph, 'nodes' | 'edges'>,
  opts?: MartinOptions,
): MartinMetrics[] {
  const componentOf = opts?.componentOf ?? defaultComponentOf;
  const { componentByFileId, components } = indexComponents(graph, componentOf);
  if (components.length === 0) return [];

  const afferent = new Map<string, Set<string>>();
  const efferent = new Map<string, Set<string>>();
  for (const component of components) {
    afferent.set(component, new Set<string>());
    efferent.set(component, new Set<string>());
  }

  for (const edge of graph.edges) {
    if (edge.type !== IMPORT_EDGE) continue;
    if (edge.source === edge.target) continue;
    const from = componentByFileId.get(edge.source);
    const to = componentByFileId.get(edge.target);
    // Dangling or non-file endpoints contribute nothing.
    if (from === undefined || to === undefined) continue;
    if (from === to) continue;
    efferent.get(from)?.add(edge.target);
    afferent.get(to)?.add(edge.source);
  }

  const totalTypes = new Map<string, number>();
  const abstractTypes = new Map<string, number>();
  for (const node of graph.nodes) {
    if (node.type !== 'class') continue;
    const path = pathOf(node);
    if (path === undefined) continue;
    const component = componentOf(path);
    if (!afferent.has(component)) continue; // class in a component with no file node
    totalTypes.set(component, (totalTypes.get(component) ?? 0) + 1);
    if (isAbstractType(node)) {
      abstractTypes.set(component, (abstractTypes.get(component) ?? 0) + 1);
    }
  }

  const draft = components.map((component) => {
    const ca = afferent.get(component)?.size ?? 0;
    const ce = efferent.get(component)?.size ?? 0;
    // A component nobody uses and that uses nobody has no meaningful
    // instability; 0/0 is defined as maximally stable rather than NaN.
    const instability = ca + ce === 0 ? 0 : ce / (ca + ce);
    const total = totalTypes.get(component) ?? 0;
    const abstractness = total === 0 ? 0 : (abstractTypes.get(component) ?? 0) / total;
    const distance = Math.abs(abstractness + instability - 1);
    return { component, ca, ce, instability, abstractness, distance };
  });

  const medianCa = median(draft.map((d) => d.ca));

  return draft.map((d) => {
    let zone: MartinZone = 'ok';
    if (d.abstractness > 0.8 && d.instability > 0.8) zone = 'uselessness';
    if (d.abstractness < 0.2 && d.instability < 0.2 && d.ca > medianCa) zone = 'pain';
    return { ...d, zone };
  });
}

export interface SdpViolation {
  /** The depending component. */
  from: string;
  /** The depended-upon component, which is *less* stable than `from`. */
  to: string;
  fromInstability: number;
  toInstability: number;
  /** `I(to) − I(from)`: how badly the dependency points uphill. */
  delta: number;
  /** Distinct file→file import edges realising this component dependency. */
  edgeCount: number;
}

/**
 * Stable Dependencies Principle violations: component X depends on component Y
 * where Y is *less* stable than X (`I(X) < I(Y)`).
 *
 * The point of the SDP is that dependencies should point in the direction of
 * stability. If a stable component (many dependents, hard to change) depends on
 * a volatile one, every churn in the volatile component propagates into
 * something that was supposed to be a fixed point — you get the maintenance
 * cost of a leaf and the blast radius of a foundation. These are the edges to
 * invert (dependency inversion) first.
 *
 * `delta` quantifies the severity, and results are sorted by it descending, so
 * the head of the list is the worst offender. `opts` must match whatever was
 * passed to `computeMartinMetrics`, otherwise the component keys will not line
 * up and the result will be empty.
 */
export function findSdpViolations(
  metrics: readonly MartinMetrics[],
  graph: Pick<KnowledgeGraph, 'nodes' | 'edges'>,
  opts?: MartinOptions,
): SdpViolation[] {
  if (metrics.length === 0) return [];
  const componentOf = opts?.componentOf ?? defaultComponentOf;
  const { componentByFileId } = indexComponents(graph, componentOf);

  const instabilityOf = new Map<string, number>();
  for (const metric of metrics) instabilityOf.set(metric.component, metric.instability);

  const counts = new Map<string, number>();
  for (const edge of graph.edges) {
    if (edge.type !== IMPORT_EDGE) continue;
    if (edge.source === edge.target) continue;
    const from = componentByFileId.get(edge.source);
    const to = componentByFileId.get(edge.target);
    if (from === undefined || to === undefined || from === to) continue;
    if (!instabilityOf.has(from) || !instabilityOf.has(to)) continue;
    const key = `${from}\u0000${to}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const violations: SdpViolation[] = [];
  for (const [key, edgeCount] of counts) {
    const [from, to] = key.split('\u0000');
    if (from === undefined || to === undefined) continue;
    const fromInstability = instabilityOf.get(from) ?? 0;
    const toInstability = instabilityOf.get(to) ?? 0;
    if (fromInstability >= toInstability) continue;
    violations.push({
      from,
      to,
      fromInstability,
      toInstability,
      delta: toInstability - fromInstability,
      edgeCount,
    });
  }

  violations.sort((a, b) => {
    if (b.delta !== a.delta) return b.delta - a.delta;
    if (a.from !== b.from) return a.from.localeCompare(b.from);
    return a.to.localeCompare(b.to);
  });
  return violations;
}

// ─── 3. LCOM4 ────────────────────────────────────────────────────────

/**
 * Disjoint-set (union-find) over arbitrary string keys, with path compression
 * and union by rank.
 *
 * Exported because it is the whole substance of LCOM4 — "how many disconnected
 * clumps of members does this class have" is exactly a connected-components
 * query — and because `computeLcom4` is inert on today's graphs (see below), so
 * this is the only way the algorithm can be covered by tests.
 */
export class UnionFind {
  private readonly parent = new Map<string, string>();
  private readonly rank = new Map<string, number>();

  /** Register a key as its own singleton set. Idempotent. */
  add(key: string): void {
    if (!this.parent.has(key)) {
      this.parent.set(key, key);
      this.rank.set(key, 0);
    }
  }

  /** Representative of `key`'s set, adding the key if it is unknown. */
  find(key: string): string {
    this.add(key);
    let root = key;
    for (;;) {
      const next = this.parent.get(root);
      if (next === undefined || next === root) break;
      root = next;
    }
    // Path compression: second pass, so `find` stays near-constant amortised.
    let cursor = key;
    for (;;) {
      const next = this.parent.get(cursor);
      if (next === undefined || next === root) break;
      this.parent.set(cursor, root);
      cursor = next;
    }
    return root;
  }

  /** Merge the sets containing `a` and `b`. Returns true if they differed. */
  union(a: string, b: string): boolean {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA === rootB) return false;
    const rankA = this.rank.get(rootA) ?? 0;
    const rankB = this.rank.get(rootB) ?? 0;
    if (rankA < rankB) {
      this.parent.set(rootA, rootB);
    } else if (rankA > rankB) {
      this.parent.set(rootB, rootA);
    } else {
      this.parent.set(rootB, rootA);
      this.rank.set(rootA, rankA + 1);
    }
    return true;
  }

  /** All sets, each sorted, ordered by their sorted first element. */
  groups(): string[][] {
    const byRoot = new Map<string, string[]>();
    for (const key of this.parent.keys()) {
      const root = this.find(key);
      const bucket = byRoot.get(root);
      if (bucket) bucket.push(key);
      else byRoot.set(root, [key]);
    }
    const out = [...byRoot.values()].map((group) => group.sort());
    out.sort((a, b) => (a[0] ?? '').localeCompare(b[0] ?? ''));
    return out;
  }

  /** Number of disjoint sets currently held. */
  groupCount(): number {
    const roots = new Set<string>();
    for (const key of this.parent.keys()) roots.add(this.find(key));
    return roots.size;
  }
}

export interface Lcom4Result {
  /** Node id of the class. */
  classId: string;
  className: string;
  /**
   * Number of disconnected method clusters. 1 = cohesive; N > 1 means the class
   * is really N classes sharing a name, and the clusters are the seam.
   */
  lcom4: number;
  /** The clusters themselves, each a list of method names. */
  clusters: string[][];
  /** Every method considered, sorted. */
  methods: string[];
}

/** Reads the two optional metadata fields LCOM4 needs off a method node. */
function methodLinks(node: SprangNode): { fields?: string[]; calls?: string[] } | null {
  const metadata = node.metadata;
  if (!metadata) return null;
  const fields = asStringArray(metadata['fieldsAccessed']);
  const calls = asStringArray(metadata['callsWithinClass']);
  if (fields === undefined && calls === undefined) return null;
  const result: { fields?: string[]; calls?: string[] } = {};
  if (fields !== undefined) result.fields = fields;
  if (calls !== undefined) result.calls = calls;
  return result;
}

/**
 * LCOM4 (Hitz & Montazeri) per class: the number of connected components in the
 * graph whose vertices are the class's methods and fields, with an edge for
 * every "method touches field" and "method calls sibling method".
 *
 * LCOM4 = 1 is a cohesive class. LCOM4 = 3 means the methods form three clumps
 * that never touch the same state — the class is three classes that happen to
 * share a file, and the clumps are the suggested split. It is the most directly
 * actionable cohesion metric there is: the output *is* the refactoring.
 *
 * **This function is intentionally inert today.** Computing it needs to know
 * which fields each method reads and which sibling methods it calls, which
 * Sprang's extractors do not yet emit: nothing populates
 * `metadata.fieldsAccessed` or `metadata.callsWithinClass` on function nodes.
 * Rather than approximate a cohesion number from `contains` edges alone — which
 * would produce a plausible-looking value with no relationship to cohesion, the
 * worst kind of metric — classes lacking that metadata are skipped, so on the
 * current graph shape this returns `[]`. When the extractor starts emitting the
 * fields, this function starts producing values with no further change; see
 * `UnionFind` for the algorithm and its direct tests.
 */
export function computeLcom4(graph: Pick<KnowledgeGraph, 'nodes' | 'edges'>): Lcom4Result[] {
  const byId = new Map<string, SprangNode>();
  for (const node of graph.nodes) byId.set(node.id, node);

  const methodsByClass = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (edge.type !== 'contains') continue;
    if (edge.source === edge.target) continue;
    const owner = byId.get(edge.source);
    const member = byId.get(edge.target);
    // Dangling edges and non class→function pairs are ignored.
    if (!owner || !member) continue;
    if (owner.type !== 'class' || member.type !== 'function') continue;
    const bucket = methodsByClass.get(owner.id);
    if (bucket) bucket.push(member.id);
    else methodsByClass.set(owner.id, [member.id]);
  }

  const results: Lcom4Result[] = [];

  for (const [classId, memberIds] of methodsByClass) {
    const classNode = byId.get(classId);
    if (!classNode) continue;

    const methodIds = [...new Set(memberIds)].sort();
    if (methodIds.length === 0) continue;

    const nameById = new Map<string, string>();
    const links = new Map<string, { fields?: string[]; calls?: string[] }>();
    let anyMetadata = false;
    for (const methodId of methodIds) {
      const methodNode = byId.get(methodId);
      if (!methodNode) continue;
      nameById.set(methodId, nameOf(methodNode));
      const link = methodLinks(methodNode);
      if (link) {
        links.set(methodId, link);
        anyMetadata = true;
      }
    }
    // No inputs → no honest answer. Skip rather than invent one.
    if (!anyMetadata) continue;

    const idByName = new Map<string, string>();
    for (const [id, name] of nameById) if (!idByName.has(name)) idByName.set(name, id);

    const uf = new UnionFind();
    for (const methodId of methodIds) uf.add(`method:${methodId}`);

    for (const methodId of methodIds) {
      const link = links.get(methodId);
      if (!link) continue;
      for (const field of link.fields ?? []) {
        uf.union(`method:${methodId}`, `field:${field}`);
      }
      for (const callee of link.calls ?? []) {
        const calleeId = idByName.get(callee) ?? (nameById.has(callee) ? callee : undefined);
        if (calleeId === undefined || calleeId === methodId) continue;
        uf.union(`method:${methodId}`, `method:${calleeId}`);
      }
    }

    // Only method-bearing components count: a field nothing else touches rides
    // along with its single method, and LCOM4 counts method clusters.
    const clusters: string[][] = [];
    for (const group of uf.groups()) {
      const names: string[] = [];
      for (const key of group) {
        if (!key.startsWith('method:')) continue;
        const id = key.slice('method:'.length);
        names.push(nameById.get(id) ?? id);
      }
      if (names.length > 0) clusters.push(names.sort());
    }
    clusters.sort((a, b) => (a[0] ?? '').localeCompare(b[0] ?? ''));

    results.push({
      classId,
      className: nameOf(classNode),
      lcom4: clusters.length,
      clusters,
      methods: methodIds.map((id) => nameById.get(id) ?? id).sort(),
    });
  }

  results.sort((a, b) => a.classId.localeCompare(b.classId));
  return results;
}
