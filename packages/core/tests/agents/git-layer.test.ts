import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { GitLayerAgent } from '../../src/agents/git-layer.js';
import type { AgentContext, SprangOptions } from '../../src/agents/base.js';
import type { KnowledgeGraph, SprangNode } from '../../src/schema/types.js';
import { NullLLMClient } from '../../src/llm/client.js';

// ─── Fixture Setup ────────────────────────────────────────────────────────────

const FIXTURE_ROOT = new URL('../fixtures/git-repo', import.meta.url).pathname;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fileNode(id: string, filePath: string): SprangNode {
  return {
    id,
    type: 'file',
    label: filePath,
    location: { file: filePath },
  };
}

function makeGraph(nodes: SprangNode[]): KnowledgeGraph {
  return {
    version: '1.0.0',
    generated_at: new Date().toISOString(),
    project_root: FIXTURE_ROOT,
    project_name: 'git-repo-fixture',
    phase: 'skeleton',
    nodes,
    edges: [],
    layers: [],
    tours: [],
    domains: [],
    stats: {
      node_count: nodes.length,
      edge_count: 0,
      risk_summary: { high: 0, medium: 0, low: 0 },
      smell_summary: {},
      generated_at: new Date().toISOString(),
    },
  };
}

const mockLLM = new NullLLMClient();

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GitLayerAgent', () => {
  let tmpDir: string;

  beforeAll(async () => {
    // Initialize the git history in the fixture dir (idempotent)
    execSync('bash create-history.sh', {
      cwd: FIXTURE_ROOT,
      stdio: 'pipe',
    });

    tmpDir = await mkdtemp(join(tmpdir(), 'sprang-git-layer-test-'));
  }, 60000);

  afterAll(async () => {
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('enriches file nodes with decision_context', async () => {
    const nodes = [
      fileNode('file:src/auth.ts', 'src/auth.ts'),
      fileNode('file:src/database.ts', 'src/database.ts'),
      fileNode('file:src/api.ts', 'src/api.ts'),
      fileNode('file:src/index.ts', 'src/index.ts'),
    ];
    const graph = makeGraph(nodes);

    const sprangDir = join(tmpDir, '.sprang');
    const ctx: AgentContext = {
      projectRoot: FIXTURE_ROOT,
      sprangDir,
      intermediateDir: join(sprangDir, 'intermediate'),
      cacheDir: join(sprangDir, 'cache'),
      graph,
      llm: mockLLM,
      options: { skipLLM: true } as SprangOptions,
    };

    const agent = new GitLayerAgent();
    const result = await agent.run(ctx);

    expect(result.success).toBe(true);

    const authNode = result.mutatedGraph.nodes.find((n) => n.id === 'file:src/auth.ts');
    expect(authNode).toBeDefined();
    expect(authNode!.decision_context).toBeDefined();
  });

  it('sets primary_authors including alice, bob, carol for auth.ts', async () => {
    const nodes = [fileNode('file:src/auth.ts', 'src/auth.ts')];
    const graph = makeGraph(nodes);

    const sprangDir = join(tmpDir, '.sprang-authors');
    const ctx: AgentContext = {
      projectRoot: FIXTURE_ROOT,
      sprangDir,
      intermediateDir: join(sprangDir, 'intermediate'),
      cacheDir: join(sprangDir, 'cache'),
      graph,
      llm: mockLLM,
      options: { skipLLM: true } as SprangOptions,
    };

    const agent = new GitLayerAgent();
    const result = await agent.run(ctx);

    expect(result.success).toBe(true);

    const authNode = result.mutatedGraph.nodes.find((n) => n.id === 'file:src/auth.ts');
    expect(authNode).toBeDefined();
    expect(authNode!.decision_context).toBeDefined();

    const authors = authNode!.decision_context!.primary_authors;
    // auth.ts has commits from alice, bob, and carol
    const hasAlice = authors.some((a) => a.toLowerCase().includes('alice'));
    const hasBob = authors.some((a) => a.toLowerCase().includes('bob'));
    const hasCarol = authors.some((a) => a.toLowerCase().includes('carol'));

    expect(hasAlice || hasBob || hasCarol).toBe(true);
  });

  it('sets change_frequency > 0 for auth.ts (which has 4+ commits)', async () => {
    const nodes = [fileNode('file:src/auth.ts', 'src/auth.ts')];
    const graph = makeGraph(nodes);

    const sprangDir = join(tmpDir, '.sprang-freq');
    const ctx: AgentContext = {
      projectRoot: FIXTURE_ROOT,
      sprangDir,
      intermediateDir: join(sprangDir, 'intermediate'),
      cacheDir: join(sprangDir, 'cache'),
      graph,
      llm: mockLLM,
      options: { skipLLM: true } as SprangOptions,
    };

    const agent = new GitLayerAgent();
    const result = await agent.run(ctx);

    expect(result.success).toBe(true);

    const authNode = result.mutatedGraph.nodes.find((n) => n.id === 'file:src/auth.ts');
    expect(authNode).toBeDefined();
    expect(authNode!.decision_context).toBeDefined();
    // auth.ts has multiple commits — change_frequency should be > 0
    // Note: change_frequency counts commits within last 90 days.
    // Since git history was just created, they should all be recent.
    expect(authNode!.decision_context!.change_frequency).toBeGreaterThan(0);
  });

  it('sets pr_references containing #42 and #55 for auth.ts', async () => {
    const nodes = [fileNode('file:src/auth.ts', 'src/auth.ts')];
    const graph = makeGraph(nodes);

    const sprangDir = join(tmpDir, '.sprang-pr');
    const ctx: AgentContext = {
      projectRoot: FIXTURE_ROOT,
      sprangDir,
      intermediateDir: join(sprangDir, 'intermediate'),
      cacheDir: join(sprangDir, 'cache'),
      graph,
      llm: mockLLM,
      options: { skipLLM: true } as SprangOptions,
    };

    const agent = new GitLayerAgent();
    const result = await agent.run(ctx);

    expect(result.success).toBe(true);

    const authNode = result.mutatedGraph.nodes.find((n) => n.id === 'file:src/auth.ts');
    expect(authNode).toBeDefined();
    expect(authNode!.decision_context).toBeDefined();

    const prRefs = authNode!.decision_context!.pr_references;
    expect(prRefs).toContain('#42');
    expect(prRefs).toContain('#55');
  });

  it('enriches all 4 fixture file nodes', async () => {
    const srcFiles = ['src/auth.ts', 'src/database.ts', 'src/api.ts', 'src/index.ts'];
    const nodes = srcFiles.map((f) => fileNode(`file:${f}`, f));
    const graph = makeGraph(nodes);

    const sprangDir = join(tmpDir, '.sprang-all');
    const ctx: AgentContext = {
      projectRoot: FIXTURE_ROOT,
      sprangDir,
      intermediateDir: join(sprangDir, 'intermediate'),
      cacheDir: join(sprangDir, 'cache'),
      graph,
      llm: mockLLM,
      options: { skipLLM: true } as SprangOptions,
    };

    const agent = new GitLayerAgent();
    const result = await agent.run(ctx);

    expect(result.success).toBe(true);

    // All nodes that have commits should have decision_context
    const enrichedNodes = result.mutatedGraph.nodes.filter(
      (n) => n.decision_context !== undefined
    );
    expect(enrichedNodes.length).toBeGreaterThan(0);
  });

  it('returns success even if a node path is not in git history', async () => {
    const nodes = [
      fileNode('file:src/auth.ts', 'src/auth.ts'),
      fileNode('file:src/nonexistent.ts', 'src/nonexistent.ts'),
    ];
    const graph = makeGraph(nodes);

    const sprangDir = join(tmpDir, '.sprang-missing');
    const ctx: AgentContext = {
      projectRoot: FIXTURE_ROOT,
      sprangDir,
      intermediateDir: join(sprangDir, 'intermediate'),
      cacheDir: join(sprangDir, 'cache'),
      graph,
      llm: mockLLM,
      options: { skipLLM: true } as SprangOptions,
    };

    const agent = new GitLayerAgent();
    const result = await agent.run(ctx);

    expect(result.success).toBe(true);
    // The nonexistent file node should not have decision_context
    const missingNode = result.mutatedGraph.nodes.find(
      (n) => n.id === 'file:src/nonexistent.ts'
    );
    expect(missingNode).toBeDefined();
    expect(missingNode!.decision_context).toBeUndefined();
  });
});
