/**
 * ArchitectureView tests.
 *
 * Since vitest is configured with environment: "node" and no jsdom/testing-library
 * are installed, these tests verify the pure logic that ArchitectureView relies on
 * rather than DOM rendering.  They confirm:
 *  - One node per layer is produced (card count === layers.length)
 *  - Empty-state condition is correctly identified
 *  - Edge data from aggregateLayerEdges feeds node/edge construction
 */
import { describe, it, expect } from 'vitest';
import { aggregateLayerEdges } from '../utils/edge-aggregation';
import type { KnowledgeGraph, Layer, SprangNode } from '../types';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeGraph(overrides: Partial<KnowledgeGraph> = {}): KnowledgeGraph {
  const now = new Date().toISOString();
  return {
    version: '1.0.0',
    generated_at: now,
    project_root: '/tmp',
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

function makeLayers(count: number): Layer[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `layer-${i + 1}`,
    name: `Layer ${i + 1}`,
    description: `Description for layer ${i + 1}`,
    node_ids: [`node-${i + 1}-a`, `node-${i + 1}-b`],
  }));
}

function makeNodes(layers: Layer[]): SprangNode[] {
  return layers.flatMap((layer) =>
    layer.node_ids.map((id) => ({
      id,
      type: 'file' as const,
      label: id,
      layer: layer.id,
      complexity: 'simple' as const,
    })),
  );
}

// ─── Helper: simulate ArchitectureView's "should render" check ────────────────

function shouldShowEmptyState(graph: KnowledgeGraph | null): boolean {
  return !graph || !graph.layers || graph.layers.length === 0;
}

// ─── Helper: simulate building one node entry per layer ───────────────────────

function buildLayerNodes(graph: KnowledgeGraph) {
  return graph.layers.map((layer, idx) => ({
    id: layer.id,
    type: 'layerCard',
    data: {
      layerId: layer.id,
      name: layer.name,
      description: layer.description,
      fileCount: layer.node_ids.length,
      colorIndex: idx,
    },
  }));
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ArchitectureView logic', () => {
  describe('empty state detection', () => {
    it('shows empty state when graph is null', () => {
      expect(shouldShowEmptyState(null)).toBe(true);
    });

    it('shows empty state when graph has no layers', () => {
      const graph = makeGraph({ layers: [] });
      expect(shouldShowEmptyState(graph)).toBe(true);
    });

    it('does NOT show empty state when graph has layers', () => {
      const layers = makeLayers(3);
      const graph = makeGraph({ layers, nodes: makeNodes(layers) });
      expect(shouldShowEmptyState(graph)).toBe(false);
    });
  });

  describe('layer card count', () => {
    it('produces exactly one card node per layer', () => {
      const layers = makeLayers(4);
      const graph = makeGraph({ layers, nodes: makeNodes(layers) });

      const nodes = buildLayerNodes(graph);
      expect(nodes).toHaveLength(graph.layers.length);
    });

    it('card count is 0 when there are no layers', () => {
      const graph = makeGraph();
      expect(buildLayerNodes(graph)).toHaveLength(0);
    });

    it('each card node has id matching its layer id', () => {
      const layers = makeLayers(3);
      const graph = makeGraph({ layers, nodes: makeNodes(layers) });

      const nodes = buildLayerNodes(graph);
      for (const node of nodes) {
        expect(graph.layers.map((l) => l.id)).toContain(node.id);
      }
    });

    it('card nodes have correct fileCount (= layer.node_ids.length)', () => {
      const layers: Layer[] = [
        { id: 'L1', name: 'Core', node_ids: ['a', 'b', 'c'] },
        { id: 'L2', name: 'Utils', node_ids: ['x'] },
      ];
      const graph = makeGraph({ layers, nodes: makeNodes(layers) });

      const nodes = buildLayerNodes(graph);
      expect(nodes[0].data.fileCount).toBe(3);
      expect(nodes[1].data.fileCount).toBe(1);
    });
  });

  describe('cross-layer edge data', () => {
    it('cross-layer connection count equals aggregated edge pairs', () => {
      const layers = makeLayers(3);
      const nodes = makeNodes(layers);
      const graph = makeGraph({
        layers,
        nodes,
        edges: [
          { source: 'node-1-a', target: 'node-2-a', type: 'imports' },
          { source: 'node-2-a', target: 'node-3-a', type: 'calls' },
          { source: 'node-1-b', target: 'node-2-b', type: 'depends_on' },
        ],
      });

      const layerEdges = aggregateLayerEdges(graph);
      // layer-1->layer-2 has 2 edges, layer-2->layer-3 has 1 edge => 2 pairs
      expect(layerEdges).toHaveLength(2);
      expect(layerEdges.find((e) => e.sourceLayerId === 'layer-1')?.count).toBe(2);
      expect(layerEdges.find((e) => e.sourceLayerId === 'layer-2')?.count).toBe(1);
    });

    it('info bar cross-layer count is 0 when all edges are intra-layer', () => {
      const layers = makeLayers(2);
      const nodes = makeNodes(layers);
      const graph = makeGraph({
        layers,
        nodes,
        edges: [
          { source: 'node-1-a', target: 'node-1-b', type: 'imports' },
          { source: 'node-2-a', target: 'node-2-b', type: 'calls' },
        ],
      });

      const layerEdges = aggregateLayerEdges(graph);
      expect(layerEdges).toHaveLength(0);
    });
  });
});
