import { describe, it, expect } from 'vitest';
import type { KnowledgeGraph } from './types';

// ─── Inline BFS (mirrors PathFinderModal implementation) ─────────────────────

interface PathResult {
  path: string[];
  edgeTypes: string[];
}

function findShortestPath(
  graph: KnowledgeGraph,
  sourceId: string,
  targetId: string,
  maxDepth = 10,
): PathResult | null {
  if (sourceId === targetId) return { path: [sourceId], edgeTypes: [] };

  const adj = new Map<string, Array<{ id: string; type: string }>>();
  for (const node of graph.nodes) adj.set(node.id, []);
  for (const edge of graph.edges) {
    adj.get(edge.source)?.push({ id: edge.target, type: edge.type });
    adj.get(edge.target)?.push({ id: edge.source, type: edge.type });
  }

  const visited = new Set<string>([sourceId]);
  const queue: Array<{ id: string; path: string[]; edges: string[] }> = [
    { id: sourceId, path: [sourceId], edges: [] },
  ];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.path.length > maxDepth) continue;
    for (const neighbor of adj.get(current.id) ?? []) {
      if (visited.has(neighbor.id)) continue;
      visited.add(neighbor.id);
      const newPath = [...current.path, neighbor.id];
      const newEdges = [...current.edges, neighbor.type];
      if (neighbor.id === targetId) return { path: newPath, edgeTypes: newEdges };
      queue.push({ id: neighbor.id, path: newPath, edges: newEdges });
    }
  }
  return null;
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeGraph(
  nodeIds: string[],
  edges: Array<{ source: string; target: string; type: string }>,
): KnowledgeGraph {
  const now = new Date().toISOString();
  return {
    version: '1.0.0',
    generated_at: now,
    project_root: '/tmp',
    project_name: 'bfs-test',
    phase: 'skeleton',
    nodes: nodeIds.map((id) => ({ id, type: 'file' as const, label: id })),
    edges: edges.map((e) => ({ ...e, type: e.type as 'imports' })),
    layers: [],
    tours: [],
    domains: [],
    stats: {
      node_count: nodeIds.length,
      edge_count: edges.length,
      risk_summary: { high: 0, medium: 0, low: 0 },
      smell_summary: {},
      generated_at: now,
    },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('PathFinder BFS', () => {
  it('returns single-node path when source === target', () => {
    const graph = makeGraph(['a', 'b'], [{ source: 'a', target: 'b', type: 'imports' }]);
    const result = findShortestPath(graph, 'a', 'a');
    expect(result).not.toBeNull();
    expect(result!.path).toEqual(['a']);
    expect(result!.edgeTypes).toEqual([]);
  });

  it('finds direct 1-hop path', () => {
    const graph = makeGraph(['a', 'b'], [{ source: 'a', target: 'b', type: 'imports' }]);
    const result = findShortestPath(graph, 'a', 'b');
    expect(result).not.toBeNull();
    expect(result!.path).toEqual(['a', 'b']);
    expect(result!.edgeTypes).toEqual(['imports']);
  });

  it('finds 2-hop path through intermediate node', () => {
    const graph = makeGraph(
      ['a', 'mid', 'b'],
      [
        { source: 'a', target: 'mid', type: 'imports' },
        { source: 'mid', target: 'b', type: 'calls' },
      ],
    );
    const result = findShortestPath(graph, 'a', 'b');
    expect(result).not.toBeNull();
    expect(result!.path).toEqual(['a', 'mid', 'b']);
    expect(result!.edgeTypes).toHaveLength(2);
  });

  it('returns shortest path (not a longer detour)', () => {
    // a -> b (direct) vs a -> c -> d -> b (3 hops)
    const graph = makeGraph(
      ['a', 'b', 'c', 'd'],
      [
        { source: 'a', target: 'b', type: 'imports' },
        { source: 'a', target: 'c', type: 'imports' },
        { source: 'c', target: 'd', type: 'imports' },
        { source: 'd', target: 'b', type: 'imports' },
      ],
    );
    const result = findShortestPath(graph, 'a', 'b');
    expect(result!.path.length).toBe(2); // direct path wins
  });

  it('returns null when no path exists (disconnected graph)', () => {
    const graph = makeGraph(
      ['a', 'b', 'c'],
      [{ source: 'a', target: 'b', type: 'imports' }],
      // 'c' is disconnected
    );
    expect(findShortestPath(graph, 'a', 'c')).toBeNull();
  });

  it('traverses edges bidirectionally', () => {
    // Edge is source->target but BFS should find target->source too
    const graph = makeGraph(
      ['a', 'b'],
      [{ source: 'b', target: 'a', type: 'imports' }],
    );
    const result = findShortestPath(graph, 'a', 'b');
    expect(result).not.toBeNull();
    expect(result!.path).toHaveLength(2);
  });

  it('respects maxDepth limit', () => {
    // Chain a->b->c->d->e, maxDepth=2 from a to e
    const graph = makeGraph(
      ['a', 'b', 'c', 'd', 'e'],
      [
        { source: 'a', target: 'b', type: 'imports' },
        { source: 'b', target: 'c', type: 'imports' },
        { source: 'c', target: 'd', type: 'imports' },
        { source: 'd', target: 'e', type: 'imports' },
      ],
    );
    expect(findShortestPath(graph, 'a', 'e', 2)).toBeNull();
    expect(findShortestPath(graph, 'a', 'e', 5)).not.toBeNull();
  });
});
