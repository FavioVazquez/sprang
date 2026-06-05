import { describe, it, expect } from 'vitest';
import { aggregateLayerEdges } from './edge-aggregation';
import type { KnowledgeGraph } from '../types';

function makeGraph(overrides: Partial<KnowledgeGraph> = {}): KnowledgeGraph {
  const now = new Date().toISOString();
  return {
    version: '1.0.0',
    generated_at: now,
    project_root: '/tmp/test',
    project_name: 'test',
    phase: 'complete',
    nodes: [],
    edges: [],
    layers: [],
    tours: [],
    domains: [],
    stats: {
      node_count: 0,
      edge_count: 0,
      risk_summary: { high: 0, medium: 0, low: 0 },
      smell_summary: {},
      generated_at: now,
    },
    ...overrides,
  };
}

describe('aggregateLayerEdges', () => {
  it('returns empty array when there are no edges', () => {
    const graph = makeGraph({
      nodes: [
        { id: 'a', type: 'file', label: 'a', layer: 'layer-1' },
        { id: 'b', type: 'file', label: 'b', layer: 'layer-2' },
      ],
      layers: [
        { id: 'layer-1', name: 'L1', node_ids: ['a'] },
        { id: 'layer-2', name: 'L2', node_ids: ['b'] },
      ],
      edges: [],
    });

    expect(aggregateLayerEdges(graph)).toEqual([]);
  });

  it('returns empty array when all edges are within the same layer', () => {
    const graph = makeGraph({
      nodes: [
        { id: 'a', type: 'file', label: 'a', layer: 'layer-1' },
        { id: 'b', type: 'file', label: 'b', layer: 'layer-1' },
        { id: 'c', type: 'file', label: 'c', layer: 'layer-1' },
      ],
      layers: [
        { id: 'layer-1', name: 'L1', node_ids: ['a', 'b', 'c'] },
      ],
      edges: [
        { source: 'a', target: 'b', type: 'imports' },
        { source: 'b', target: 'c', type: 'calls' },
        { source: 'a', target: 'c', type: 'contains' },
      ],
    });

    expect(aggregateLayerEdges(graph)).toEqual([]);
  });

  it('aggregates 3 edges between the same layer pair to count=3', () => {
    const graph = makeGraph({
      nodes: [
        { id: 'a', type: 'file', label: 'a', layer: 'layer-1' },
        { id: 'b', type: 'file', label: 'b', layer: 'layer-1' },
        { id: 'x', type: 'file', label: 'x', layer: 'layer-2' },
        { id: 'y', type: 'file', label: 'y', layer: 'layer-2' },
      ],
      layers: [
        { id: 'layer-1', name: 'L1', node_ids: ['a', 'b'] },
        { id: 'layer-2', name: 'L2', node_ids: ['x', 'y'] },
      ],
      edges: [
        { source: 'a', target: 'x', type: 'imports' },
        { source: 'a', target: 'y', type: 'calls' },
        { source: 'b', target: 'x', type: 'depends_on' },
      ],
    });

    const result = aggregateLayerEdges(graph);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      sourceLayerId: 'layer-1',
      targetLayerId: 'layer-2',
      count: 3,
    });
  });

  it('treats edges in both directions as separate pairs', () => {
    const graph = makeGraph({
      nodes: [
        { id: 'a', type: 'file', label: 'a', layer: 'layer-1' },
        { id: 'x', type: 'file', label: 'x', layer: 'layer-2' },
      ],
      layers: [
        { id: 'layer-1', name: 'L1', node_ids: ['a'] },
        { id: 'layer-2', name: 'L2', node_ids: ['x'] },
      ],
      edges: [
        { source: 'a', target: 'x', type: 'imports' },
        { source: 'x', target: 'a', type: 'calls' },
      ],
    });

    const result = aggregateLayerEdges(graph);
    expect(result).toHaveLength(2);

    const l1ToL2 = result.find(
      (e) => e.sourceLayerId === 'layer-1' && e.targetLayerId === 'layer-2',
    );
    const l2ToL1 = result.find(
      (e) => e.sourceLayerId === 'layer-2' && e.targetLayerId === 'layer-1',
    );
    expect(l1ToL2?.count).toBe(1);
    expect(l2ToL1?.count).toBe(1);
  });

  it('handles multiple layer pairs with correct per-pair counts', () => {
    const graph = makeGraph({
      nodes: [
        { id: 'a', type: 'file', label: 'a', layer: 'L1' },
        { id: 'b', type: 'file', label: 'b', layer: 'L2' },
        { id: 'c', type: 'file', label: 'c', layer: 'L3' },
      ],
      layers: [
        { id: 'L1', name: 'Layer 1', node_ids: ['a'] },
        { id: 'L2', name: 'Layer 2', node_ids: ['b'] },
        { id: 'L3', name: 'Layer 3', node_ids: ['c'] },
      ],
      edges: [
        { source: 'a', target: 'b', type: 'imports' },
        { source: 'a', target: 'b', type: 'calls' },
        { source: 'b', target: 'c', type: 'depends_on' },
      ],
    });

    const result = aggregateLayerEdges(graph);
    expect(result).toHaveLength(2);

    const l1l2 = result.find((e) => e.sourceLayerId === 'L1' && e.targetLayerId === 'L2');
    const l2l3 = result.find((e) => e.sourceLayerId === 'L2' && e.targetLayerId === 'L3');
    expect(l1l2?.count).toBe(2);
    expect(l2l3?.count).toBe(1);
  });

  it('resolves layer membership from graph.layers when node.layer is not set', () => {
    // Nodes without .layer field — layer membership comes from layers[].node_ids
    const graph = makeGraph({
      nodes: [
        { id: 'a', type: 'file', label: 'a' },
        { id: 'b', type: 'file', label: 'b' },
      ],
      layers: [
        { id: 'layer-1', name: 'L1', node_ids: ['a'] },
        { id: 'layer-2', name: 'L2', node_ids: ['b'] },
      ],
      edges: [
        { source: 'a', target: 'b', type: 'imports' },
      ],
    });

    const result = aggregateLayerEdges(graph);
    expect(result).toHaveLength(1);
    expect(result[0].count).toBe(1);
  });

  it('skips edges where either node has no layer', () => {
    const graph = makeGraph({
      nodes: [
        { id: 'a', type: 'file', label: 'a', layer: 'layer-1' },
        { id: 'orphan', type: 'file', label: 'orphan' }, // no layer
      ],
      layers: [
        { id: 'layer-1', name: 'L1', node_ids: ['a'] },
      ],
      edges: [
        { source: 'a', target: 'orphan', type: 'imports' },
      ],
    });

    expect(aggregateLayerEdges(graph)).toEqual([]);
  });
});
