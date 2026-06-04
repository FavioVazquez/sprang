import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { mergeSubgraphs } from '../../src/graph/merge-subgraphs.js';
import type { KnowledgeGraph, SprangNode } from '../../src/schema/types.js';

// ─── Fixture path ─────────────────────────────────────────────────────────────

const FIXTURES_DIR = join(import.meta.dirname ?? __dirname, '../fixtures');
const MONOREPO_FIXTURE = join(FIXTURES_DIR, 'monorepo-root');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRootGraph(nodes: SprangNode[] = [], edges: KnowledgeGraph['edges'] = []): KnowledgeGraph {
  return {
    version: '1.0.0',
    generated_at: new Date().toISOString(),
    project_root: '/root',
    project_name: 'root',
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
  return { id, type: 'file', label };
}

/**
 * Create a temporary monorepo directory structure with the given workspace
 * config and optional subgraph files. Returns the temp directory path.
 */
async function makeTempMonorepo(opts: {
  workspaceYaml?: string;
  packageJson?: string;
  subgraphs?: Record<string, KnowledgeGraph>;
}): Promise<string> {
  const tmpDir = join(os.tmpdir(), `sprang-merge-test-${Math.random().toString(36).slice(2)}`);
  await mkdir(tmpDir, { recursive: true });

  if (opts.workspaceYaml) {
    await writeFile(join(tmpDir, 'pnpm-workspace.yaml'), opts.workspaceYaml, 'utf-8');
  }
  if (opts.packageJson) {
    await writeFile(join(tmpDir, 'package.json'), opts.packageJson, 'utf-8');
  }

  if (opts.subgraphs) {
    for (const [pkgPath, graph] of Object.entries(opts.subgraphs)) {
      const sprangDir = join(tmpDir, pkgPath, '.sprang');
      await mkdir(sprangDir, { recursive: true });
      await writeFile(
        join(sprangDir, 'knowledge-graph.json'),
        JSON.stringify(graph),
        'utf-8'
      );
    }
  }

  return tmpDir;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('mergeSubgraphs', () => {
  describe('No workspace config', () => {
    it('returns graph unchanged with empty result when no workspace file exists', async () => {
      const tmpDir = join(os.tmpdir(), `sprang-noconfig-${Math.random().toString(36).slice(2)}`);
      await mkdir(tmpDir, { recursive: true });

      const rootGraph = makeRootGraph([fileNode('file:src/main.ts', 'src/main.ts')]);
      const { graph: result, result: mergeResult } = await mergeSubgraphs(
        rootGraph,
        join(tmpDir, '.sprang'),
        tmpDir
      );

      expect(mergeResult.mergedPackages).toHaveLength(0);
      expect(mergeResult.addedNodes).toBe(0);
      expect(mergeResult.addedEdges).toBe(0);
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].id).toBe('file:src/main.ts');
    });
  });

  describe('Workspace with no subgraph files', () => {
    it('returns graph unchanged when packages exist but have no .sprang/knowledge-graph.json', async () => {
      const tmpDir = await makeTempMonorepo({
        workspaceYaml: "packages:\n  - 'packages/alpha'\n  - 'packages/beta'\n",
        // No subgraphs — directories don't even exist
      });

      const rootGraph = makeRootGraph([fileNode('file:src/root.ts', 'src/root.ts')]);
      const { graph: result, result: mergeResult } = await mergeSubgraphs(
        rootGraph,
        join(tmpDir, '.sprang'),
        tmpDir
      );

      expect(mergeResult.mergedPackages).toHaveLength(0);
      expect(mergeResult.addedNodes).toBe(0);
      expect(mergeResult.addedEdges).toBe(0);
      expect(result.nodes).toHaveLength(1);
    });
  });

  describe('Workspace with one subgraph', () => {
    it('merges subgraph nodes with package path prefix', async () => {
      const subgraph: KnowledgeGraph = {
        version: '1.0.0',
        generated_at: new Date().toISOString(),
        project_root: '/sub',
        project_name: 'sub',
        phase: 'skeleton',
        nodes: [
          { id: 'file:src/widget.ts', type: 'file', label: 'src/widget.ts' },
          { id: 'file:src/helpers.ts', type: 'file', label: 'src/helpers.ts' },
        ],
        edges: [
          { source: 'file:src/widget.ts', target: 'file:src/helpers.ts', type: 'imports' },
        ],
        layers: [],
        tours: [],
        domains: [],
        stats: {
          node_count: 2,
          edge_count: 1,
          risk_summary: { high: 0, medium: 0, low: 0 },
          smell_summary: {},
          generated_at: new Date().toISOString(),
        },
      };

      const tmpDir = await makeTempMonorepo({
        workspaceYaml: "packages:\n  - 'packages/sub'\n",
        subgraphs: { 'packages/sub': subgraph },
      });

      const rootGraph = makeRootGraph();
      const { graph: result, result: mergeResult } = await mergeSubgraphs(
        rootGraph,
        join(tmpDir, '.sprang'),
        tmpDir
      );

      expect(mergeResult.mergedPackages).toContain('packages/sub');
      expect(mergeResult.addedNodes).toBe(2);
      expect(mergeResult.addedEdges).toBe(1);
      expect(result.nodes).toHaveLength(2);

      const nodeIds = result.nodes.map((n) => n.id);
      expect(nodeIds).toContain('packages/sub:file:src/widget.ts');
      expect(nodeIds).toContain('packages/sub:file:src/helpers.ts');

      expect(result.edges[0].source).toBe('packages/sub:file:src/widget.ts');
      expect(result.edges[0].target).toBe('packages/sub:file:src/helpers.ts');
    });

    it('updates stats after merging', async () => {
      const subgraph: KnowledgeGraph = {
        version: '1.0.0',
        generated_at: new Date().toISOString(),
        project_root: '/pkg',
        project_name: 'pkg',
        phase: 'skeleton',
        nodes: [{ id: 'file:src/x.ts', type: 'file', label: 'src/x.ts' }],
        edges: [],
        layers: [],
        tours: [],
        domains: [],
        stats: {
          node_count: 1,
          edge_count: 0,
          risk_summary: { high: 0, medium: 0, low: 0 },
          smell_summary: {},
          generated_at: new Date().toISOString(),
        },
      };

      const tmpDir = await makeTempMonorepo({
        workspaceYaml: "packages:\n  - 'packages/pkg'\n",
        subgraphs: { 'packages/pkg': subgraph },
      });

      const rootGraph = makeRootGraph([fileNode('file:root.ts', 'root.ts')]);
      const { graph: result } = await mergeSubgraphs(
        rootGraph,
        join(tmpDir, '.sprang'),
        tmpDir
      );

      expect(result.stats.node_count).toBe(result.nodes.length);
      expect(result.stats.edge_count).toBe(result.edges.length);
      expect(result.nodes).toHaveLength(2);
    });
  });

  describe('Prefix collision avoidance', () => {
    it('gives different IDs to same file path in two different packages', async () => {
      // Both packages have "file:src/index.ts" — they should get different IDs
      const makeSubgraph = (name: string): KnowledgeGraph => ({
        version: '1.0.0',
        generated_at: new Date().toISOString(),
        project_root: `/pkg/${name}`,
        project_name: name,
        phase: 'skeleton',
        nodes: [{ id: 'file:src/index.ts', type: 'file', label: 'src/index.ts' }],
        edges: [],
        layers: [],
        tours: [],
        domains: [],
        stats: {
          node_count: 1,
          edge_count: 0,
          risk_summary: { high: 0, medium: 0, low: 0 },
          smell_summary: {},
          generated_at: new Date().toISOString(),
        },
      });

      const tmpDir = await makeTempMonorepo({
        workspaceYaml: "packages:\n  - 'packages/alpha'\n  - 'packages/beta'\n",
        subgraphs: {
          'packages/alpha': makeSubgraph('alpha'),
          'packages/beta': makeSubgraph('beta'),
        },
      });

      const rootGraph = makeRootGraph();
      const { graph: result, result: mergeResult } = await mergeSubgraphs(
        rootGraph,
        join(tmpDir, '.sprang'),
        tmpDir
      );

      expect(mergeResult.mergedPackages).toHaveLength(2);
      expect(mergeResult.addedNodes).toBe(2); // both distinct IDs

      const nodeIds = result.nodes.map((n) => n.id);
      expect(nodeIds).toContain('packages/alpha:file:src/index.ts');
      expect(nodeIds).toContain('packages/beta:file:src/index.ts');
      // They must be distinct
      const uniqueIds = new Set(nodeIds);
      expect(uniqueIds.size).toBe(nodeIds.length);
    });
  });

  describe('Uses fixture files', () => {
    it('merges the monorepo fixture with two packages', async () => {
      const rootGraph = makeRootGraph();
      const { graph: result, result: mergeResult } = await mergeSubgraphs(
        rootGraph,
        join(MONOREPO_FIXTURE, '.sprang'),
        MONOREPO_FIXTURE
      );

      expect(mergeResult.mergedPackages).toContain('packages/core');
      expect(mergeResult.mergedPackages).toContain('packages/utils');
      expect(mergeResult.addedNodes).toBe(3); // 2 from core, 1 from utils

      const nodeIds = result.nodes.map((n) => n.id);
      expect(nodeIds).toContain('packages/core:file:src/index.ts');
      expect(nodeIds).toContain('packages/core:file:src/utils.ts');
      expect(nodeIds).toContain('packages/utils:file:src/index.ts');
    });

    it('does not add duplicate nodes that are already in the root graph', async () => {
      // Pre-populate root with a node that would conflict after prefixing
      const existingNode = fileNode('packages/core:file:src/index.ts', 'pre-existing');
      const rootGraph = makeRootGraph([existingNode]);

      const { graph: result, result: mergeResult } = await mergeSubgraphs(
        rootGraph,
        join(MONOREPO_FIXTURE, '.sprang'),
        MONOREPO_FIXTURE
      );

      // Should not add the conflicting node again
      const matching = result.nodes.filter(
        (n) => n.id === 'packages/core:file:src/index.ts'
      );
      expect(matching).toHaveLength(1);
      // The pre-existing node takes priority (not overwritten)
      expect(matching[0].label).toBe('pre-existing');
      // addedNodes should be 2 (utils:index + core:utils) not 3
      expect(mergeResult.addedNodes).toBe(2);
    });
  });

  describe('package.json workspaces support', () => {
    it('reads workspace packages from package.json#workspaces array', async () => {
      const subgraph: KnowledgeGraph = {
        version: '1.0.0',
        generated_at: new Date().toISOString(),
        project_root: '/pkg',
        project_name: 'lib',
        phase: 'skeleton',
        nodes: [{ id: 'file:src/lib.ts', type: 'file', label: 'src/lib.ts' }],
        edges: [],
        layers: [],
        tours: [],
        domains: [],
        stats: {
          node_count: 1,
          edge_count: 0,
          risk_summary: { high: 0, medium: 0, low: 0 },
          smell_summary: {},
          generated_at: new Date().toISOString(),
        },
      };

      const tmpDir = await makeTempMonorepo({
        packageJson: JSON.stringify({ workspaces: ['packages/lib'] }),
        subgraphs: { 'packages/lib': subgraph },
      });

      const rootGraph = makeRootGraph();
      const { graph: result, result: mergeResult } = await mergeSubgraphs(
        rootGraph,
        join(tmpDir, '.sprang'),
        tmpDir
      );

      expect(mergeResult.mergedPackages).toContain('packages/lib');
      expect(result.nodes[0].id).toBe('packages/lib:file:src/lib.ts');
    });
  });
});
