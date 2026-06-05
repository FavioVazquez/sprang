import { describe, it, expect } from 'vitest';
import { normalizeGraph } from '../../src/graph/normalize.js';
import type { KnowledgeGraph, SprangNode, SprangEdge } from '../../src/schema/types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeGraph(
  nodes: SprangNode[],
  edges: SprangEdge[] = []
): KnowledgeGraph {
  return {
    version: '1.0.0',
    generated_at: new Date().toISOString(),
    project_root: '/tmp/test',
    project_name: 'test',
    phase: 'skeleton',
    nodes,
    edges,
    layers: [],
    tours: [],
    domains: [],
    stats: {
      node_count: nodes.length,
      edge_count: edges.length,
      risk_summary: { high: 0, medium: 0, low: 0 },
      smell_summary: {},
      generated_at: new Date().toISOString(),
    },
  };
}

function fileNode(id: string, label: string, filePath?: string): SprangNode {
  return { id, type: 'file', label, filePath, location: { file: label } };
}

function edge(source: string, target: string, type: SprangEdge['type']): SprangEdge {
  return { source, target, type };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('normalizeGraph', () => {
  describe('Step 1: double-prefix stripping', () => {
    it('strips doubled "file:" prefix from node ID', () => {
      const node = fileNode('file:file:src/index.ts', 'src/index.ts');
      const graph = makeGraph([node]);

      const { graph: result, report } = normalizeGraph(graph);

      expect(report.doublePrefix).toBe(1);
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].id).toBe('file:src/index.ts');
    });

    it('strips doubled "function:" prefix from node ID', () => {
      const node: SprangNode = {
        id: 'function:function:src/foo.ts::myFunc',
        type: 'function',
        label: 'myFunc',
      };
      const graph = makeGraph([node]);

      const { graph: result, report } = normalizeGraph(graph);

      expect(report.doublePrefix).toBe(1);
      expect(result.nodes[0].id).toBe('function:src/foo.ts::myFunc');
    });

    it('updates edge source and target references when node IDs are renamed', () => {
      const nodeA = fileNode('file:file:src/a.ts', 'src/a.ts');
      const nodeB = fileNode('file:src/b.ts', 'src/b.ts');
      const e = edge('file:file:src/a.ts', 'file:src/b.ts', 'imports');
      const graph = makeGraph([nodeA, nodeB], [e]);

      const { graph: result } = normalizeGraph(graph);

      expect(result.edges[0].source).toBe('file:src/a.ts');
      expect(result.edges[0].target).toBe('file:src/b.ts');
    });

    it('does not touch node IDs without double prefix', () => {
      const node = fileNode('file:src/index.ts', 'src/index.ts');
      const graph = makeGraph([node]);

      const { graph: result, report } = normalizeGraph(graph);

      expect(report.doublePrefix).toBe(0);
      expect(result.nodes[0].id).toBe('file:src/index.ts');
    });
  });

  describe('Step 2: node deduplication', () => {
    it('removes duplicate node IDs (last-write-wins)', () => {
      const node1 = { ...fileNode('file:src/index.ts', 'src/index.ts'), summary: 'first' };
      const node2 = { ...fileNode('file:src/index.ts', 'src/index.ts'), summary: 'second' };
      const graph = makeGraph([node1, node2]);

      const { graph: result, report } = normalizeGraph(graph);

      expect(report.dedupedNodes).toBe(1);
      expect(result.nodes).toHaveLength(1);
      // last-write-wins: second node's data is kept
      expect(result.nodes[0].summary).toBe('second');
    });

    it('keeps unique nodes unchanged', () => {
      const nodes = [
        fileNode('file:src/a.ts', 'src/a.ts'),
        fileNode('file:src/b.ts', 'src/b.ts'),
        fileNode('file:src/c.ts', 'src/c.ts'),
      ];
      const graph = makeGraph(nodes);

      const { graph: result, report } = normalizeGraph(graph);

      expect(report.dedupedNodes).toBe(0);
      expect(result.nodes).toHaveLength(3);
    });
  });

  describe('Step 3: edge deduplication', () => {
    it('removes duplicate edges (same source, target, type)', () => {
      const nodeA = fileNode('file:src/a.ts', 'src/a.ts');
      const nodeB = fileNode('file:src/b.ts', 'src/b.ts');
      const e1 = edge('file:src/a.ts', 'file:src/b.ts', 'imports');
      const e2 = edge('file:src/a.ts', 'file:src/b.ts', 'imports');
      const e3 = edge('file:src/a.ts', 'file:src/b.ts', 'imports');
      const graph = makeGraph([nodeA, nodeB], [e1, e2, e3]);

      const { graph: result, report } = normalizeGraph(graph);

      expect(report.dedupedEdges).toBe(2);
      expect(result.edges).toHaveLength(1);
    });

    it('keeps edges with different types as separate', () => {
      const nodeA = fileNode('file:src/a.ts', 'src/a.ts');
      const nodeB = fileNode('file:src/b.ts', 'src/b.ts');
      const e1 = edge('file:src/a.ts', 'file:src/b.ts', 'imports');
      const e2 = edge('file:src/a.ts', 'file:src/b.ts', 'depends_on');
      const graph = makeGraph([nodeA, nodeB], [e1, e2]);

      const { graph: result, report } = normalizeGraph(graph);

      expect(report.dedupedEdges).toBe(0);
      expect(result.edges).toHaveLength(2);
    });
  });

  describe('Step 4: dangling edge removal', () => {
    it('removes edges where source node does not exist', () => {
      const nodeB = fileNode('file:src/b.ts', 'src/b.ts');
      const e = edge('file:src/ghost.ts', 'file:src/b.ts', 'imports');
      const graph = makeGraph([nodeB], [e]);

      const { graph: result, report } = normalizeGraph(graph);

      expect(report.danglingEdges).toBe(1);
      expect(result.edges).toHaveLength(0);
    });

    it('removes edges where target node does not exist', () => {
      const nodeA = fileNode('file:src/a.ts', 'src/a.ts');
      const e = edge('file:src/a.ts', 'file:src/missing.ts', 'imports');
      const graph = makeGraph([nodeA], [e]);

      const { graph: result, report } = normalizeGraph(graph);

      expect(report.danglingEdges).toBe(1);
      expect(result.edges).toHaveLength(0);
    });

    it('keeps edges where both source and target exist', () => {
      const nodeA = fileNode('file:src/a.ts', 'src/a.ts');
      const nodeB = fileNode('file:src/b.ts', 'src/b.ts');
      const e = edge('file:src/a.ts', 'file:src/b.ts', 'imports');
      const graph = makeGraph([nodeA, nodeB], [e]);

      const { graph: result, report } = normalizeGraph(graph);

      expect(report.danglingEdges).toBe(0);
      expect(result.edges).toHaveLength(1);
    });
  });

  describe('Clean graph — no changes', () => {
    it('returns all report counts as 0 for a clean graph', () => {
      const nodeA = fileNode('file:src/a.ts', 'src/a.ts');
      const nodeB = fileNode('file:src/b.ts', 'src/b.ts');
      const e = edge('file:src/a.ts', 'file:src/b.ts', 'imports');
      const graph = makeGraph([nodeA, nodeB], [e]);

      const { report } = normalizeGraph(graph);

      expect(report.doublePrefix).toBe(0);
      expect(report.dedupedNodes).toBe(0);
      expect(report.dedupedEdges).toBe(0);
      expect(report.danglingEdges).toBe(0);
      expect(report.testedByFixed).toBe(0);
    });
  });

  describe('Step 6: stats updated', () => {
    it('updates node_count and edge_count after normalization', () => {
      const nodeA = fileNode('file:src/a.ts', 'src/a.ts');
      const nodeB = fileNode('file:src/b.ts', 'src/b.ts');
      // duplicate node
      const nodeADup = fileNode('file:src/a.ts', 'src/a.ts');
      // dangling edge
      const eGood = edge('file:src/a.ts', 'file:src/b.ts', 'imports');
      const eBad = edge('file:src/ghost.ts', 'file:src/b.ts', 'imports');
      const graph = makeGraph([nodeA, nodeB, nodeADup], [eGood, eBad]);

      const { graph: result } = normalizeGraph(graph);

      expect(result.stats.node_count).toBe(result.nodes.length);
      expect(result.stats.edge_count).toBe(result.edges.length);
      // 2 unique nodes, 1 valid edge
      expect(result.stats.node_count).toBe(2);
      expect(result.stats.edge_count).toBe(1);
    });
  });

  describe('Step 5: tested_by canonicalization', () => {
    it('flips a reversed tested_by edge where target is a test file', () => {
      // Reversed: source→target means source file "tested_by" test file
      // The edge goes FROM source TO test file — that's backwards.
      // Correct direction: test file → source file (test tests source).
      const sourceNode = fileNode('file:src/math.ts', 'src/math.ts', 'src/math.ts');
      const testNode = fileNode(
        'file:src/math.test.ts',
        'src/math.test.ts',
        'src/math.test.ts'
      );
      // Reversed edge: source is math.ts, target is math.test.ts
      const reversedEdge = edge('file:src/math.ts', 'file:src/math.test.ts', 'tested_by');
      const graph = makeGraph([sourceNode, testNode], [reversedEdge]);

      const { graph: result, report } = normalizeGraph(graph);

      expect(report.testedByFixed).toBe(1);
      expect(result.edges).toHaveLength(1);
      // After flip: source becomes test file, target becomes source file
      expect(result.edges[0].source).toBe('file:src/math.test.ts');
      expect(result.edges[0].target).toBe('file:src/math.ts');
    });

    it('does not flip a correct tested_by edge (test→source)', () => {
      // Correct: test file → source file
      const sourceNode = fileNode('file:src/utils.ts', 'src/utils.ts', 'src/utils.ts');
      const testNode = fileNode(
        'file:src/utils.spec.ts',
        'src/utils.spec.ts',
        'src/utils.spec.ts'
      );
      // Correct edge: source is test file, target is source file
      const correctEdge = edge('file:src/utils.spec.ts', 'file:src/utils.ts', 'tested_by');
      const graph = makeGraph([sourceNode, testNode], [correctEdge]);

      const { graph: result, report } = normalizeGraph(graph);

      expect(report.testedByFixed).toBe(0);
      expect(result.edges[0].source).toBe('file:src/utils.spec.ts');
      expect(result.edges[0].target).toBe('file:src/utils.ts');
    });

    it('handles __tests__ directory pattern', () => {
      const sourceNode = fileNode('file:src/auth.ts', 'src/auth.ts', 'src/auth.ts');
      const testNode = fileNode(
        'file:src/__tests__/auth.ts',
        'src/__tests__/auth.ts',
        'src/__tests__/auth.ts'
      );
      const reversedEdge = edge('file:src/auth.ts', 'file:src/__tests__/auth.ts', 'tested_by');
      const graph = makeGraph([sourceNode, testNode], [reversedEdge]);

      const { graph: result, report } = normalizeGraph(graph);

      expect(report.testedByFixed).toBe(1);
      expect(result.edges[0].source).toBe('file:src/__tests__/auth.ts');
      expect(result.edges[0].target).toBe('file:src/auth.ts');
    });
  });

  describe('multiple issues combined', () => {
    it('handles double prefix + dangling edge + dedup all in one graph', () => {
      const node1 = fileNode('file:file:src/a.ts', 'src/a.ts');  // double prefix
      const node2 = fileNode('file:src/b.ts', 'src/b.ts');
      const node2Dup = fileNode('file:src/b.ts', 'src/b.ts');   // duplicate
      const eGood = edge('file:file:src/a.ts', 'file:src/b.ts', 'imports'); // uses old ID (pre-rename)
      const eBad = edge('file:src/missing.ts', 'file:src/b.ts', 'imports'); // dangling
      const graph = makeGraph([node1, node2, node2Dup], [eGood, eBad]);

      const { graph: result, report } = normalizeGraph(graph);

      expect(report.doublePrefix).toBe(1);
      expect(report.dedupedNodes).toBe(1);
      expect(report.danglingEdges).toBe(1);
      // Good edge should remain, but now with fixed source ID
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0].source).toBe('file:src/a.ts');
      expect(result.nodes).toHaveLength(2);
    });
  });
});
