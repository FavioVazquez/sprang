import type { GraphLoader } from '../graph-loader.js';
import type { SprangNode } from '@sprang/core';

export interface SprangNodeInput {
  node_id: string;
}

export interface NeighborInfo {
  node_id: string;
  label: string;
  type: string;
  direction: 'incoming' | 'outgoing';
  edge_type: string;
}

export interface SprangNodeResult {
  node: SprangNode;
  neighbors: NeighborInfo[];
}

export interface SprangNodeError {
  error: string;
  code: string;
}

export async function sprangNode(
  loader: GraphLoader,
  input: SprangNodeInput
): Promise<SprangNodeResult | SprangNodeError> {
  const graph = await loader.getGraph();
  if (!graph) {
    return { error: 'Knowledge graph not found', code: 'GRAPH_NOT_FOUND' };
  }

  const node = graph.nodes.find((n) => n.id === input.node_id);
  if (!node) {
    return { error: 'Node not found', code: 'NODE_NOT_FOUND' };
  }

  const nodeMap = new Map<string, SprangNode>(graph.nodes.map((n) => [n.id, n]));

  const neighbors: NeighborInfo[] = [];

  for (const edge of graph.edges) {
    if (edge.source === input.node_id) {
      const target = nodeMap.get(edge.target);
      if (target) {
        neighbors.push({
          node_id: target.id,
          label: target.label,
          type: target.type,
          direction: 'outgoing',
          edge_type: edge.type,
        });
      }
    } else if (edge.target === input.node_id) {
      const source = nodeMap.get(edge.source);
      if (source) {
        neighbors.push({
          node_id: source.id,
          label: source.label,
          type: source.type,
          direction: 'incoming',
          edge_type: edge.type,
        });
      }
    }
  }

  return { node, neighbors };
}
