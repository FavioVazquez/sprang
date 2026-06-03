import type { KnowledgeGraph, SprangNode, SprangEdge } from '../schema/types.js';

export function findNodeById(
  graph: KnowledgeGraph,
  id: string
): SprangNode | undefined {
  return graph.nodes.find((n) => n.id === id);
}

export function getEdgesForNode(
  graph: KnowledgeGraph,
  nodeId: string
): SprangEdge[] {
  return graph.edges.filter(
    (e) => e.source === nodeId || e.target === nodeId
  );
}

export function getNeighbors(
  graph: KnowledgeGraph,
  nodeId: string,
  direction: 'incoming' | 'outgoing' | 'both'
): SprangNode[] {
  const neighborIds = new Set<string>();

  for (const edge of graph.edges) {
    if (direction === 'outgoing' || direction === 'both') {
      if (edge.source === nodeId) {
        neighborIds.add(edge.target);
      }
    }
    if (direction === 'incoming' || direction === 'both') {
      if (edge.target === nodeId) {
        neighborIds.add(edge.source);
      }
    }
  }

  return graph.nodes.filter((n) => neighborIds.has(n.id));
}

export function bfsReachable(
  graph: KnowledgeGraph,
  startNodeId: string,
  direction: 'incoming' | 'outgoing'
): Set<string> {
  const visited = new Set<string>();
  const queue: string[] = [startNodeId];

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    if (visited.has(current)) continue;
    visited.add(current);

    for (const edge of graph.edges) {
      if (direction === 'outgoing' && edge.source === current) {
        if (!visited.has(edge.target)) {
          queue.push(edge.target);
        }
      } else if (direction === 'incoming' && edge.target === current) {
        if (!visited.has(edge.source)) {
          queue.push(edge.source);
        }
      }
    }
  }

  // Remove the start node itself from the result
  visited.delete(startNodeId);
  return visited;
}

export function searchNodes(
  graph: KnowledgeGraph,
  query: string,
  limit = 20
): SprangNode[] {
  const lowerQuery = query.toLowerCase();
  const results: SprangNode[] = [];

  for (const node of graph.nodes) {
    if (results.length >= limit) break;

    const labelMatch = node.label.toLowerCase().includes(lowerQuery);
    const summaryMatch = node.summary?.toLowerCase().includes(lowerQuery) ?? false;

    if (labelMatch || summaryMatch) {
      results.push(node);
    }
  }

  return results;
}
