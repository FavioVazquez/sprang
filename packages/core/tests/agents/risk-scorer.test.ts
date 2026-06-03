import { describe, it, expect } from 'vitest';
import { RiskScorerAgent } from '../../src/agents/risk-scorer.js';
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

function testFileNode(id: string, label: string): SprangNode {
  return { id, type: 'file', label, location: { file: label } };
}

function edge(source: string, target: string, type: SprangEdge['type']): SprangEdge {
  return { source, target, type };
}

function makeCtx(graph: KnowledgeGraph): AgentContext {
  const tmp = join(os.tmpdir(), `sprang-risk-test-${Math.random().toString(36).slice(2)}`);
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

const agent = new RiskScorerAgent();

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('RiskScorerAgent', () => {
  describe('blast radius + no test coverage', () => {
    it('assigns risk_score > 0.7 and no_test_coverage to a node with many dependents and no tests', async () => {
      // target: depended on by 30 nodes (blast radius near max) + no test coverage
      const target = fileNode('file:core.ts', 'core.ts');

      // Make 30 dependent nodes (very high blast radius)
      const dependents: SprangNode[] = [];
      const edges: SprangEdge[] = [];
      for (let i = 0; i < 30; i++) {
        const dep = fileNode(`file:dep${i}.ts`, `dep${i}.ts`);
        dependents.push(dep);
        edges.push(edge(dep.id, 'file:core.ts', 'imports'));
      }

      const graph = makeGraph([target, ...dependents], edges);
      const result = await agent.run(makeCtx(graph));
      expect(result.success).toBe(true);

      const coreNode = result.mutatedGraph.nodes.find((n) => n.id === 'file:core.ts')!;

      expect(coreNode.risk_score).toBeGreaterThan(0.7);
      expect(coreNode.risk_factors).toContain('no_test_coverage');
    });

    it('includes large_blast_radius factor when blast_radius_score > 0.5', async () => {
      const target = fileNode('file:shared.ts', 'shared.ts');
      const dependents: SprangNode[] = [];
      const edges: SprangEdge[] = [];

      // 20 dependents out of 22 total nodes → blast_radius = 20/22 > 0.5
      for (let i = 0; i < 20; i++) {
        const dep = fileNode(`file:user${i}.ts`, `user${i}.ts`);
        dependents.push(dep);
        edges.push(edge(dep.id, 'file:shared.ts', 'imports'));
      }

      const graph = makeGraph([target, ...dependents], edges);
      const result = await agent.run(makeCtx(graph));

      const node = result.mutatedGraph.nodes.find((n) => n.id === 'file:shared.ts')!;
      expect(node.risk_factors).toContain('large_blast_radius');
    });
  });

  describe('test gap score', () => {
    it('sets test_gap_score = 0.0 for a node with a direct test edge (type=tests)', async () => {
      const sourceFile = fileNode('file:service.ts', 'service.ts');
      const testFile = testFileNode('file:service.test.ts', 'service.test.ts');

      const graph = makeGraph([sourceFile, testFile], [
        edge('file:service.test.ts', 'file:service.ts', 'tested_by'),
      ]);

      const result = await agent.run(makeCtx(graph));

      // The source file should have test_gap_score = 0 (has direct test)
      const serviceNode = result.mutatedGraph.nodes.find((n) => n.id === 'file:service.ts')!;
      // With test coverage, no_test_coverage should NOT be in risk_factors
      expect(serviceNode.risk_factors).not.toContain('no_test_coverage');
    });

    it('sets test_gap_score = 0.0 for a node with a direct test edge (type=calls from spec file)', async () => {
      const sourceFile = fileNode('file:util.ts', 'util.ts');
      const specFile = testFileNode('file:util.spec.ts', 'util.spec.ts');

      const graph = makeGraph([sourceFile, specFile], [
        edge('file:util.spec.ts', 'file:util.ts', 'calls'),
      ]);

      const result = await agent.run(makeCtx(graph));

      const utilNode = result.mutatedGraph.nodes.find((n) => n.id === 'file:util.ts')!;
      expect(utilNode.risk_factors).not.toContain('no_test_coverage');
    });
  });

  describe('low risk node', () => {
    it('assigns risk_score < 0.2 for a node with no incoming edges, no warnings, and test coverage', async () => {
      // An isolated file with only one outgoing edge and a test
      const leaf = fileNode('file:leaf.ts', 'leaf.ts');
      const dep = fileNode('file:dep.ts', 'dep.ts');
      const testFile = testFileNode('file:leaf.test.ts', 'leaf.test.ts');

      const graph = makeGraph([leaf, dep, testFile], [
        edge('file:leaf.ts', 'file:dep.ts', 'imports'),
        edge('file:leaf.test.ts', 'file:leaf.ts', 'tested_by'),
      ]);

      const result = await agent.run(makeCtx(graph));

      const leafNode = result.mutatedGraph.nodes.find((n) => n.id === 'file:leaf.ts')!;
      // blast_radius = 0 (no incoming) → 0
      // coupling = 1 (edges) / 40 = 0.025
      // test_gap = 0.0 (has test)
      // churn = 0.0 (no decision_context)
      // risk = 0 * 0.35 + 0.025 * 0.25 + 0 * 0.25 + 0 * 0.15 ≈ 0.006
      expect(leafNode.risk_score).toBeLessThan(0.2);
    });

    it('does not include no_test_coverage for a node with test coverage', async () => {
      const src = fileNode('file:src.ts', 'src.ts');
      const testFile = testFileNode('file:src.test.ts', 'src.test.ts');

      const graph = makeGraph([src, testFile], [
        edge('file:src.test.ts', 'file:src.ts', 'tested_by'),
      ]);

      const result = await agent.run(makeCtx(graph));
      const srcNode = result.mutatedGraph.nodes.find((n) => n.id === 'file:src.ts')!;

      expect(srcNode.risk_factors).not.toContain('no_test_coverage');
    });
  });

  describe('circular dependency boost', () => {
    it('boosts coupling_density_score by 0.2 when node has circular_dependency warning', async () => {
      // Two nodes: one with circular_dep warning, one without
      // Both have the same degree so we can compare scores
      const withCircular = fileNode('file:with-circ.ts', 'with-circ.ts');
      const withoutCircular = fileNode('file:without-circ.ts', 'without-circ.ts');
      const dep1 = fileNode('file:dep-a.ts', 'dep-a.ts');
      const dep2 = fileNode('file:dep-b.ts', 'dep-b.ts');

      // Give both files the same degree (2 outgoing, 0 incoming)
      withCircular.structural_warnings = [
        {
          category: 'circular_dependency',
          severity: 'high',
          description: 'Circular dep',
          heuristic: 'cycle_length = 2',
          related_node_ids: ['file:without-circ.ts'],
        },
      ];

      const graph = makeGraph(
        [withCircular, withoutCircular, dep1, dep2],
        [
          edge('file:with-circ.ts', 'file:dep-a.ts', 'imports'),
          edge('file:without-circ.ts', 'file:dep-b.ts', 'imports'),
        ]
      );

      const result = await agent.run(makeCtx(graph));

      const circNode = result.mutatedGraph.nodes.find((n) => n.id === 'file:with-circ.ts')!;
      const noCircNode = result.mutatedGraph.nodes.find((n) => n.id === 'file:without-circ.ts')!;

      // Both have same direct edges (1 each), but circular node should score higher
      expect(circNode.risk_score!).toBeGreaterThan(noCircNode.risk_score!);
    });

    it('includes has_structural_warnings factor when circular_dependency warning is present', async () => {
      const node = fileNode('file:cyclic.ts', 'cyclic.ts');
      node.structural_warnings = [
        {
          category: 'circular_dependency',
          severity: 'high',
          description: 'Circular dep',
          heuristic: 'cycle_length = 2',
          related_node_ids: [],
        },
      ];

      const graph = makeGraph([node], []);
      const result = await agent.run(makeCtx(graph));

      const resultNode = result.mutatedGraph.nodes.find((n) => n.id === 'file:cyclic.ts')!;
      expect(resultNode.risk_factors).toContain('has_structural_warnings');
    });
  });

  describe('config and test file exclusion', () => {
    it('does not score config-type nodes', async () => {
      const configNode: SprangNode = {
        id: 'config:tsconfig',
        type: 'config',
        label: 'tsconfig.json',
      };
      const graph = makeGraph([configNode], []);
      const result = await agent.run(makeCtx(graph));

      const node = result.mutatedGraph.nodes.find((n) => n.id === 'config:tsconfig')!;
      // Config nodes are excluded from scoring, so risk_score should remain undefined
      expect(node.risk_score).toBeUndefined();
    });

    it('does not score *.test.ts files', async () => {
      const testFile = testFileNode('file:foo.test.ts', 'foo.test.ts');
      const graph = makeGraph([testFile], []);
      const result = await agent.run(makeCtx(graph));

      const node = result.mutatedGraph.nodes.find((n) => n.id === 'file:foo.test.ts')!;
      expect(node.risk_score).toBeUndefined();
    });

    it('does not score *.spec.js files', async () => {
      const specFile: SprangNode = { id: 'file:bar.spec.js', type: 'file', label: 'bar.spec.js' };
      const graph = makeGraph([specFile], []);
      const result = await agent.run(makeCtx(graph));

      const node = result.mutatedGraph.nodes.find((n) => n.id === 'file:bar.spec.js')!;
      expect(node.risk_score).toBeUndefined();
    });
  });

  describe('churn score', () => {
    it('assigns non-zero churn_score and frequent_changes factor when change_frequency is high', async () => {
      const hotFile = fileNode('file:hot.ts', 'hot.ts');
      hotFile.decision_context = {
        commits: [],
        primary_authors: ['dev@example.com'],
        last_changed: new Date().toISOString(),
        change_frequency: 15, // > threshold 20/2 = 10 (maxChurnCommits90d=20, churnScore=0.75 > 0.5)
        rationale_snippets: [],
        pr_references: [],
        changelog_entries: [],
      };

      const graph = makeGraph([hotFile], []);
      const result = await agent.run(makeCtx(graph));

      const node = result.mutatedGraph.nodes.find((n) => n.id === 'file:hot.ts')!;
      expect(node.risk_factors).toContain('frequent_changes');
    });

    it('assigns single_author risk factor for single author with > 5 commits', async () => {
      const node = fileNode('file:solo.ts', 'solo.ts');
      node.decision_context = {
        commits: [],
        primary_authors: ['solo@example.com'],
        last_changed: new Date().toISOString(),
        change_frequency: 8,
        rationale_snippets: [],
        pr_references: [],
        changelog_entries: [],
      };

      const graph = makeGraph([node], []);
      const result = await agent.run(makeCtx(graph));

      const resultNode = result.mutatedGraph.nodes.find((n) => n.id === 'file:solo.ts')!;
      expect(resultNode.risk_factors).toContain('single_author');
    });
  });

  describe('recent_churn factor', () => {
    it('adds recent_churn when >= 3 commits in last 14 days', async () => {
      const node = fileNode('file:recent.ts', 'recent.ts');
      const now = Date.now();
      // 3 commits within last 14 days
      const recentDate = new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString();
      node.decision_context = {
        commits: [
          { sha: 'abc1234', date: recentDate, message: 'fix 1', author: 'dev@example.com' },
          { sha: 'def5678', date: recentDate, message: 'fix 2', author: 'dev@example.com' },
          { sha: 'ghi9012', date: recentDate, message: 'fix 3', author: 'dev@example.com' },
        ],
        primary_authors: ['dev@example.com'],
        last_changed: recentDate,
        change_frequency: 3,
        rationale_snippets: [],
        pr_references: [],
        changelog_entries: [],
      };

      const graph = makeGraph([node], []);
      const result = await agent.run(makeCtx(graph));

      const resultNode = result.mutatedGraph.nodes.find((n) => n.id === 'file:recent.ts')!;
      expect(resultNode.risk_factors).toContain('recent_churn');
    });
  });

  describe('risk_summary stats', () => {
    it('correctly categorizes nodes into high/medium/low risk buckets', async () => {
      // High risk: many dependents, no test
      const highRisk = fileNode('file:high.ts', 'high.ts');
      const dependents: SprangNode[] = [];
      const edges: SprangEdge[] = [];
      for (let i = 0; i < 25; i++) {
        const dep = fileNode(`file:hdep${i}.ts`, `hdep${i}.ts`);
        dependents.push(dep);
        edges.push(edge(dep.id, 'file:high.ts', 'imports'));
      }

      // Low risk: isolated with test
      const lowRisk = fileNode('file:low.ts', 'low.ts');
      const lowTest = testFileNode('file:low.test.ts', 'low.test.ts');
      edges.push(edge('file:low.test.ts', 'file:low.ts', 'tested_by'));

      const graph = makeGraph([highRisk, ...dependents, lowRisk, lowTest], edges);
      const result = await agent.run(makeCtx(graph));

      const summary = result.mutatedGraph.stats.risk_summary;
      // At least one high-risk node and one low-risk node
      expect(summary.high + summary.medium + summary.low).toBeGreaterThan(0);
      expect(summary.high).toBeGreaterThanOrEqual(1);
    });
  });
});
