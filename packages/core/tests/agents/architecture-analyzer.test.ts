import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ProjectScannerAgent } from '../../src/agents/project-scanner.js';
import { FileAnalyzerAgent } from '../../src/agents/file-analyzer.js';
import { ArchitectureAnalyzerAgent } from '../../src/agents/architecture-analyzer.js';
import { createEmptyGraph } from '../../src/graph/store.js';
import { NullLLMClient } from '../../src/llm/client.js';
import type { AgentContext, SprangOptions } from '../../src/agents/base.js';
import type { KnowledgeGraph, SprangNode, SprangEdge } from '../../src/schema/types.js';
import type { LLMClient as LLMClientType } from '../../src/llm/client.js';

// ─── Fixture Setup ────────────────────────────────────────────────────────────

const FIXTURE_ROOT = new URL('../fixtures/simple-ts', import.meta.url).pathname;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeGraph(
  nodes: SprangNode[],
  edges: SprangEdge[] = []
): KnowledgeGraph {
  return {
    version: '1.0.0',
    generated_at: new Date().toISOString(),
    project_root: FIXTURE_ROOT,
    project_name: 'simple-ts-fixture',
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

const mockLLM = {
  complete: async () => '',
  completeBatch: async (prompts: string[]) => prompts.map(() => ''),
  getTokenUsage: () => 0,
} as unknown as LLMClientType;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ArchitectureAnalyzerAgent', () => {
  let tmpDir: string;
  let baseCtx: AgentContext;
  let graphAfterAnalysis: KnowledgeGraph;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'sprang-arch-test-'));
    const sprangDir = join(tmpDir, '.sprang');
    const intermediateDir = join(sprangDir, 'intermediate');
    const cacheDir = join(sprangDir, 'cache');

    const graph = createEmptyGraph(FIXTURE_ROOT, 'simple-ts-fixture');
    const options: SprangOptions = { skipLLM: true };
    const llm = new NullLLMClient();

    baseCtx = {
      projectRoot: FIXTURE_ROOT,
      sprangDir,
      intermediateDir,
      cacheDir,
      graph,
      llm,
      options,
    };

    // Run scanner then file-analyzer to get a properly populated graph
    const scanner = new ProjectScannerAgent();
    const scanResult = await scanner.run(baseCtx);
    expect(scanResult.success).toBe(true);

    const analyzerCtx: AgentContext = { ...baseCtx, graph: scanResult.mutatedGraph };
    const analyzer = new FileAnalyzerAgent();
    const analyzeResult = await analyzer.run(analyzerCtx);
    expect(analyzeResult.success).toBe(true);

    graphAfterAnalysis = analyzeResult.mutatedGraph;
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('runs successfully on the simple-ts fixture', async () => {
    const archCtx: AgentContext = { ...baseCtx, graph: graphAfterAnalysis };
    const agent = new ArchitectureAnalyzerAgent();
    const result = await agent.run(archCtx);

    expect(result.success).toBe(true);
  });

  it('assigns layer to file nodes', async () => {
    const archCtx: AgentContext = { ...baseCtx, graph: graphAfterAnalysis };
    const agent = new ArchitectureAnalyzerAgent();
    const result = await agent.run(archCtx);

    expect(result.success).toBe(true);

    const fileNodes = result.mutatedGraph.nodes.filter((n) => n.type === 'file');
    expect(fileNodes.length).toBeGreaterThan(0);

    // At least some file nodes should have a layer assigned
    const layeredNodes = fileNodes.filter((n) => n.layer !== undefined);
    expect(layeredNodes.length).toBeGreaterThan(0);
  });

  it('populates graph.layers with non-empty layer objects', async () => {
    const archCtx: AgentContext = { ...baseCtx, graph: graphAfterAnalysis };
    const agent = new ArchitectureAnalyzerAgent();
    const result = await agent.run(archCtx);

    expect(result.success).toBe(true);
    expect(result.mutatedGraph.layers).toBeDefined();
    expect(result.mutatedGraph.layers.length).toBeGreaterThan(0);
  });

  it('each layer has id, name, and node_ids fields', async () => {
    const archCtx: AgentContext = { ...baseCtx, graph: graphAfterAnalysis };
    const agent = new ArchitectureAnalyzerAgent();
    const result = await agent.run(archCtx);

    expect(result.success).toBe(true);

    for (const layer of result.mutatedGraph.layers) {
      expect(layer.id).toBeDefined();
      expect(typeof layer.id).toBe('string');
      expect(layer.name).toBeDefined();
      expect(typeof layer.name).toBe('string');
      expect(Array.isArray(layer.node_ids)).toBe(true);
      expect(layer.node_ids.length).toBeGreaterThan(0);
    }
  });

  it('services/user.ts is classified into a meaningful layer', async () => {
    const archCtx: AgentContext = { ...baseCtx, graph: graphAfterAnalysis };
    const agent = new ArchitectureAnalyzerAgent();
    const result = await agent.run(archCtx);

    expect(result.success).toBe(true);

    // services/user.ts should match the 'domain' heuristic (service pattern)
    const userServiceNode = result.mutatedGraph.nodes.find(
      (n) => n.id === 'file:src/services/user.ts'
    );
    expect(userServiceNode).toBeDefined();
    // It should be assigned to some layer (domain or general)
    expect(userServiceNode!.layer).toBeDefined();
  });

  it('node layer values match a layer id in graph.layers', async () => {
    const archCtx: AgentContext = { ...baseCtx, graph: graphAfterAnalysis };
    const agent = new ArchitectureAnalyzerAgent();
    const result = await agent.run(archCtx);

    expect(result.success).toBe(true);

    const layerIds = new Set(result.mutatedGraph.layers.map((l) => l.id));
    const fileNodes = result.mutatedGraph.nodes.filter(
      (n) => n.type === 'file' && n.layer !== undefined
    );

    for (const node of fileNodes) {
      expect(layerIds.has(node.layer!)).toBe(true);
    }
  });

  it('handles an empty graph gracefully', async () => {
    const emptyGraph = makeGraph([]);
    const archCtx: AgentContext = { ...baseCtx, graph: emptyGraph };
    const agent = new ArchitectureAnalyzerAgent();
    const result = await agent.run(archCtx);

    expect(result.success).toBe(true);
    expect(result.mutatedGraph.layers).toBeDefined();
  });

  it('works without prior scanner/analyzer pass (manual graph)', async () => {
    const fileNodes: SprangNode[] = [
      { id: 'file:src/api/routes.ts', type: 'file', label: 'routes.ts', location: { file: 'src/api/routes.ts' } },
      { id: 'file:src/domain/service.ts', type: 'file', label: 'service.ts', location: { file: 'src/domain/service.ts' } },
      { id: 'file:src/utils/helper.ts', type: 'file', label: 'helper.ts', location: { file: 'src/utils/helper.ts' } },
    ];
    const manualGraph = makeGraph(fileNodes);
    const archCtx: AgentContext = { ...baseCtx, graph: manualGraph };
    const agent = new ArchitectureAnalyzerAgent();
    const result = await agent.run(archCtx);

    expect(result.success).toBe(true);

    const apiNode = result.mutatedGraph.nodes.find((n) => n.id === 'file:src/api/routes.ts');
    const domainNode = result.mutatedGraph.nodes.find((n) => n.id === 'file:src/domain/service.ts');
    const utilNode = result.mutatedGraph.nodes.find((n) => n.id === 'file:src/utils/helper.ts');

    expect(apiNode!.layer).toBe('api');
    expect(domainNode!.layer).toBe('domain');
    expect(utilNode!.layer).toBe('util');
  });
});
