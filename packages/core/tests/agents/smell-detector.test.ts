import { describe, it, expect } from 'vitest';
import { SmellDetectorAgent } from '../../src/agents/smell-detector.js';
import type { AgentContext } from '../../src/agents/base.js';
import type { KnowledgeGraph, SprangNode, SprangEdge } from '../../src/schema/types.js';
import type { LLMClient } from '../../src/llm/client.js';
import os from 'node:os';
import { join } from 'node:path';

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

function fileNode(id: string, label: string): SprangNode {
  return { id, type: 'file', label, location: { file: label } };
}

function funcNode(id: string, label: string, file: string, start = 1, end = 10): SprangNode {
  return {
    id,
    type: 'function',
    label,
    location: { file, start_line: start, end_line: end },
  };
}

function edge(source: string, target: string, type: SprangEdge['type']): SprangEdge {
  return { source, target, type };
}

function makeCtx(graph: KnowledgeGraph): AgentContext {
  const tmp = join(os.tmpdir(), `sprang-test-${Math.random().toString(36).slice(2)}`);
  return {
    projectRoot: '/tmp/test',
    sprangDir: join(tmp, '.sprang'),
    intermediateDir: join(tmp, '.sprang', 'intermediate'),
    cacheDir: join(tmp, '.sprang', 'cache'),
    graph,
    llm: { complete: async () => '', completeBatch: async () => [], getTokenUsage: () => 0 } as unknown as LLMClient,
    options: { skipLLM: true },
  };
}

const agent = new SmellDetectorAgent();

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('SmellDetectorAgent', () => {
  describe('circular_dependency fixture', () => {
    it('flags all 3 files involved in a circular dependency cycle', async () => {
      // a.ts → b.ts → c.ts → a.ts  (3-cycle)
      const a = fileNode('file:a.ts', 'a.ts');
      const b = fileNode('file:b.ts', 'b.ts');
      const c = fileNode('file:c.ts', 'c.ts');

      const graph = makeGraph([a, b, c], [
        edge('file:a.ts', 'file:b.ts', 'imports'),
        edge('file:b.ts', 'file:c.ts', 'imports'),
        edge('file:c.ts', 'file:a.ts', 'imports'),
      ]);

      const result = await agent.run(makeCtx(graph));
      expect(result.success).toBe(true);

      const updatedNodes = result.mutatedGraph.nodes;
      const aNode = updatedNodes.find((n) => n.id === 'file:a.ts')!;
      const bNode = updatedNodes.find((n) => n.id === 'file:b.ts')!;
      const cNode = updatedNodes.find((n) => n.id === 'file:c.ts')!;

      expect(aNode.structural_warnings?.some((w) => w.category === 'circular_dependency')).toBe(true);
      expect(bNode.structural_warnings?.some((w) => w.category === 'circular_dependency')).toBe(true);
      expect(cNode.structural_warnings?.some((w) => w.category === 'circular_dependency')).toBe(true);
    });

    it('assigns high severity for 2-3 node cycles', async () => {
      // 2-cycle: a ↔ b
      const a = fileNode('file:a2.ts', 'a2.ts');
      const b = fileNode('file:b2.ts', 'b2.ts');

      const graph = makeGraph([a, b], [
        edge('file:a2.ts', 'file:b2.ts', 'imports'),
        edge('file:b2.ts', 'file:a2.ts', 'imports'),
      ]);

      const result = await agent.run(makeCtx(graph));
      const aWarning = result.mutatedGraph.nodes
        .find((n) => n.id === 'file:a2.ts')!
        .structural_warnings?.find((w) => w.category === 'circular_dependency');

      expect(aWarning?.severity).toBe('high');
    });

    it('assigns medium severity for 4-6 node cycles', async () => {
      // 4-cycle: a → b → c → d → a
      const nodes = ['a', 'b', 'c', 'd'].map((x) => fileNode(`file:${x}.ts`, `${x}.ts`));
      const edges: SprangEdge[] = [
        edge('file:a.ts', 'file:b.ts', 'imports'),
        edge('file:b.ts', 'file:c.ts', 'imports'),
        edge('file:c.ts', 'file:d.ts', 'imports'),
        edge('file:d.ts', 'file:a.ts', 'imports'),
      ];

      const graph = makeGraph(nodes, edges);
      const result = await agent.run(makeCtx(graph));

      const aWarning = result.mutatedGraph.nodes
        .find((n) => n.id === 'file:a.ts')!
        .structural_warnings?.find((w) => w.category === 'circular_dependency');

      expect(aWarning?.severity).toBe('medium');
    });
  });

  describe('god_node fixture', () => {
    it('flags a file with excessive outgoing edges as god_node', async () => {
      // Create a "god" file with 21 outgoing edges (> threshold of 20)
      const godFile = fileNode('file:god.ts', 'god.ts');
      const dependencyNodes: SprangNode[] = [];
      const edges: SprangEdge[] = [];

      for (let i = 0; i < 21; i++) {
        const dep = fileNode(`file:dep${i}.ts`, `dep${i}.ts`);
        dependencyNodes.push(dep);
        edges.push(edge('file:god.ts', dep.id, 'imports'));
      }

      const graph = makeGraph([godFile, ...dependencyNodes], edges);
      const result = await agent.run(makeCtx(graph));

      const godNode = result.mutatedGraph.nodes.find((n) => n.id === 'file:god.ts')!;
      expect(godNode.structural_warnings?.some((w) => w.category === 'god_node')).toBe(true);
      expect(godNode.structural_warnings?.find((w) => w.category === 'god_node')?.severity).toBe('high');
    });

    it('flags a file with excessive contained function count as god_node', async () => {
      // 26 functions contained (> threshold of 25)
      const godFile = fileNode('file:bigfile.ts', 'bigfile.ts');
      const functions: SprangNode[] = [];
      const edges: SprangEdge[] = [];

      for (let i = 0; i < 26; i++) {
        const fn = funcNode(`fn:${i}`, `fn${i}`, 'bigfile.ts');
        functions.push(fn);
        edges.push(edge('file:bigfile.ts', fn.id, 'contains'));
      }

      const graph = makeGraph([godFile, ...functions], edges);
      const result = await agent.run(makeCtx(graph));

      const node = result.mutatedGraph.nodes.find((n) => n.id === 'file:bigfile.ts')!;
      expect(node.structural_warnings?.some((w) => w.category === 'god_node')).toBe(true);
    });

    it('does not flag a file with fewer than threshold functions', async () => {
      const normalFile = fileNode('file:normal.ts', 'normal.ts');
      const functions: SprangNode[] = [];
      const edges: SprangEdge[] = [];

      for (let i = 0; i < 10; i++) {
        const fn = funcNode(`fn:small:${i}`, `fn${i}`, 'normal.ts');
        functions.push(fn);
        edges.push(edge('file:normal.ts', fn.id, 'contains'));
      }

      const graph = makeGraph([normalFile, ...functions], edges);
      const result = await agent.run(makeCtx(graph));

      const node = result.mutatedGraph.nodes.find((n) => n.id === 'file:normal.ts')!;
      expect(node.structural_warnings?.some((w) => w.category === 'god_node')).toBeFalsy();
    });
  });

  describe('simple-ts fixture — zero warnings', () => {
    it('produces no structural warnings for a simple clean graph', async () => {
      // Two files with a simple one-way import, no cycles, no god nodes
      const utils = fileNode('file:utils.ts', 'utils.ts');
      const main = fileNode('file:main.ts', 'main.ts');

      const graph = makeGraph([utils, main], [
        edge('file:main.ts', 'file:utils.ts', 'imports'),
      ]);

      const result = await agent.run(makeCtx(graph));
      expect(result.success).toBe(true);

      for (const node of result.mutatedGraph.nodes) {
        expect(node.structural_warnings ?? []).toHaveLength(0);
      }
    });

    it('produces no circular_dependency warnings for a DAG', async () => {
      // a → b → c (no cycle)
      const nodes = ['a', 'b', 'c'].map((x) => fileNode(`file:dag-${x}.ts`, `dag-${x}.ts`));
      const edges: SprangEdge[] = [
        edge('file:dag-a.ts', 'file:dag-b.ts', 'imports'),
        edge('file:dag-b.ts', 'file:dag-c.ts', 'imports'),
      ];

      const graph = makeGraph(nodes, edges);
      const result = await agent.run(makeCtx(graph));

      for (const node of result.mutatedGraph.nodes) {
        expect(node.structural_warnings?.some((w) => w.category === 'circular_dependency')).toBeFalsy();
      }
    });
  });

  describe('orphan detection', () => {
    it('flags a file node with degree=0 as orphan_node', async () => {
      const orphan = fileNode('file:orphan.ts', 'orphan.ts');
      // Another file with edges (should NOT be flagged)
      const connected = fileNode('file:connected.ts', 'connected.ts');
      const dep = fileNode('file:dep.ts', 'dep.ts');

      const graph = makeGraph([orphan, connected, dep], [
        edge('file:connected.ts', 'file:dep.ts', 'imports'),
      ]);

      const result = await agent.run(makeCtx(graph));

      const orphanNode = result.mutatedGraph.nodes.find((n) => n.id === 'file:orphan.ts')!;
      const connectedNode = result.mutatedGraph.nodes.find((n) => n.id === 'file:connected.ts')!;

      expect(orphanNode.structural_warnings?.some((w) => w.category === 'orphan_node')).toBe(true);
      expect(orphanNode.structural_warnings?.find((w) => w.category === 'orphan_node')?.severity).toBe('low');
      expect(connectedNode.structural_warnings?.some((w) => w.category === 'orphan_node')).toBeFalsy();
    });

    it('does not flag index.ts as an orphan even with degree=0', async () => {
      const indexFile = fileNode('file:src/index.ts', 'src/index.ts');
      const graph = makeGraph([indexFile], []);

      const result = await agent.run(makeCtx(graph));
      const node = result.mutatedGraph.nodes.find((n) => n.id === 'file:src/index.ts')!;

      expect(node.structural_warnings?.some((w) => w.category === 'orphan_node')).toBeFalsy();
    });

    it('does not flag main.ts, app.ts, server.ts, or cli.ts as orphans', async () => {
      const entryPoints = ['main.ts', 'app.ts', 'server.ts', 'cli.ts'].map((name) =>
        fileNode(`file:${name}`, name)
      );
      const graph = makeGraph(entryPoints, []);

      const result = await agent.run(makeCtx(graph));
      for (const node of result.mutatedGraph.nodes) {
        expect(node.structural_warnings?.some((w) => w.category === 'orphan_node')).toBeFalsy();
      }
    });
  });

  describe('over_connected detection', () => {
    it('flags a node with total degree > 30', async () => {
      const hub = fileNode('file:hub.ts', 'hub.ts');
      const others: SprangNode[] = [];
      const edges: SprangEdge[] = [];

      // 16 outgoing + 16 incoming = 32 total degree (> 30 threshold)
      for (let i = 0; i < 16; i++) {
        const out = fileNode(`file:out${i}.ts`, `out${i}.ts`);
        others.push(out);
        edges.push(edge('file:hub.ts', out.id, 'imports'));
      }
      for (let i = 0; i < 16; i++) {
        const inc = fileNode(`file:inc${i}.ts`, `inc${i}.ts`);
        others.push(inc);
        edges.push(edge(inc.id, 'file:hub.ts', 'imports'));
      }

      const graph = makeGraph([hub, ...others], edges);
      const result = await agent.run(makeCtx(graph));

      const hubNode = result.mutatedGraph.nodes.find((n) => n.id === 'file:hub.ts')!;
      expect(hubNode.structural_warnings?.some((w) => w.category === 'over_connected')).toBe(true);
    });
  });

  describe('smell summary', () => {
    it('writes accurate counts to graph.stats.smell_summary', async () => {
      // Create circular dependency (2 nodes)
      const a = fileNode('file:sum-a.ts', 'sum-a.ts');
      const b = fileNode('file:sum-b.ts', 'sum-b.ts');

      const graph = makeGraph([a, b], [
        edge('file:sum-a.ts', 'file:sum-b.ts', 'imports'),
        edge('file:sum-b.ts', 'file:sum-a.ts', 'imports'),
      ]);

      const result = await agent.run(makeCtx(graph));
      const smellSummary = result.mutatedGraph.stats.smell_summary;

      expect(smellSummary.circular_dependency).toBeGreaterThanOrEqual(2);
    });
  });

  describe('unstable_interface detection', () => {
    it('flags a node with high change_frequency and high in_degree', async () => {
      const hotFile = fileNode('file:hot.ts', 'hot.ts');
      // Add decision_context with change_frequency > 10
      hotFile.decision_context = {
        commits: [],
        primary_authors: ['dev@example.com'],
        last_changed: new Date().toISOString(),
        change_frequency: 15,
        rationale_snippets: [],
        pr_references: [],
        changelog_entries: [],
      };

      // 6 files importing hotFile (in_degree = 6 > threshold 5)
      const importers: SprangNode[] = [];
      const edges: SprangEdge[] = [];
      for (let i = 0; i < 6; i++) {
        const imp = fileNode(`file:user${i}.ts`, `user${i}.ts`);
        importers.push(imp);
        edges.push(edge(imp.id, 'file:hot.ts', 'imports'));
      }

      const graph = makeGraph([hotFile, ...importers], edges);
      const result = await agent.run(makeCtx(graph));

      const node = result.mutatedGraph.nodes.find((n) => n.id === 'file:hot.ts')!;
      expect(node.structural_warnings?.some((w) => w.category === 'unstable_interface')).toBe(true);
    });
  });
});
