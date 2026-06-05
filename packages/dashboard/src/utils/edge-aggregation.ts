import type { KnowledgeGraph } from '../types';

export interface LayerEdge {
  sourceLayerId: string;
  targetLayerId: string;
  count: number;
}

/**
 * Build a map from node id -> layer id.
 * First checks node.layer, then scans graph.layers for membership.
 */
function buildNodeLayerMap(graph: KnowledgeGraph): Map<string, string> {
  const map = new Map<string, string>();

  // First pass: use node.layer field if available
  for (const node of graph.nodes) {
    if (node.layer) {
      map.set(node.id, node.layer);
    }
  }

  // Second pass: scan layers for any node_ids not yet resolved
  for (const layer of graph.layers) {
    for (const nodeId of layer.node_ids) {
      if (!map.has(nodeId)) {
        map.set(nodeId, layer.id);
      }
    }
  }

  return map;
}

/**
 * Aggregates all cross-layer edges in the graph.
 * Returns one entry per (sourceLayerId, targetLayerId) pair with
 * count = total number of edges between those two layers.
 * Edges within the same layer are excluded.
 */
export function aggregateLayerEdges(graph: KnowledgeGraph): LayerEdge[] {
  const nodeLayerMap = buildNodeLayerMap(graph);

  // Map key: "sourceLayerId::targetLayerId" -> count
  const counts = new Map<string, number>();

  for (const edge of graph.edges) {
    const sourceLayer = nodeLayerMap.get(edge.source);
    const targetLayer = nodeLayerMap.get(edge.target);

    // Skip if either node has no layer, or if they're in the same layer
    if (!sourceLayer || !targetLayer || sourceLayer === targetLayer) {
      continue;
    }

    const key = `${sourceLayer}::${targetLayer}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const result: LayerEdge[] = [];
  for (const [key, count] of counts) {
    const [sourceLayerId, targetLayerId] = key.split('::');
    result.push({ sourceLayerId, targetLayerId, count });
  }

  return result;
}
