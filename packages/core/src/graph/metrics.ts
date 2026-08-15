import type { KnowledgeGraph, SprangEdge, SprangNode } from '../schema/types.js';

/** Edge types that represent one file depending on another. */
const COUPLING_EDGE_TYPES = new Set(['imports', 'depends_on']);

/**
 * Mean coupling degree across file nodes — the average number of dependency
 * relationships a file participates in, counting both directions.
 *
 * This feeds the health grade's coupling penalty, which is scored as
 * `min(15, max(0, avgCoupling - 3) * 2)`: up to three dependency
 * relationships per file is treated as normal, and the penalty saturates at
 * an average of 10.5.
 *
 * Until 0.4.0 nothing computed this. `calcHealthGrade` accepted it as an
 * optional argument defaulting to 0, and neither caller passed it, so a
 * fifteen-point term of the published formula was silently inert on every
 * grade Sprang ever produced.
 */
export function computeAvgCoupling(graph: Pick<KnowledgeGraph, 'nodes' | 'edges'>): number {
  const fileIds = new Set(
    graph.nodes.filter((n: SprangNode) => n.type === 'file').map((n: SprangNode) => n.id),
  );
  if (fileIds.size === 0) return 0;

  const degree = new Map<string, number>();
  const bump = (id: string) => {
    if (fileIds.has(id)) degree.set(id, (degree.get(id) ?? 0) + 1);
  };
  for (const edge of graph.edges as SprangEdge[]) {
    if (!COUPLING_EDGE_TYPES.has(edge.type)) continue;
    // Self-imports are not coupling; they are almost always a resolution bug.
    if (edge.source === edge.target) continue;
    bump(edge.source);
    bump(edge.target);
  }

  let total = 0;
  for (const id of fileIds) total += degree.get(id) ?? 0;
  return total / fileIds.size;
}
