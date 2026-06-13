import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ProjectScannerAgent } from '../../src/agents/project-scanner.js';
import { FileAnalyzerAgent } from '../../src/agents/file-analyzer.js';
import { createEmptyGraph } from '../../src/graph/store.js';
import { NullLLMClient } from '../../src/llm/client.js';
import type { AgentContext, SprangOptions } from '../../src/agents/base.js';

const FIXTURE_ROOT = new URL('../fixtures/simple-python', import.meta.url).pathname;

describe('Phase 1 pipeline – Python project', () => {
  let tmpDir: string;
  let baseCtx: AgentContext;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'sprang-python-test-'));
    const sprangDir = join(tmpDir, '.sprang');
    const intermediateDir = join(sprangDir, 'intermediate');
    const cacheDir = join(sprangDir, 'cache');

    const graph = createEmptyGraph(FIXTURE_ROOT, 'simple-python-fixture');
    const options: SprangOptions = { skipLLM: true };
    const llm = new NullLLMClient();

    baseCtx = { projectRoot: FIXTURE_ROOT, sprangDir, intermediateDir, cacheDir, graph, llm, options };
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('scanner creates file nodes for all .py files', async () => {
    const scanner = new ProjectScannerAgent();
    const result = await scanner.run(baseCtx);

    expect(result.success).toBe(true);
    const nodeIds = result.mutatedGraph.nodes.map((n) => n.id);
    expect(nodeIds).toContain('file:main.py');
    expect(nodeIds).toContain('file:utils.py');
    expect(nodeIds).toContain('file:models/user.py');
    expect(nodeIds).toContain('file:models/__init__.py');
  });

  it('scanner detects python language', async () => {
    const scanner = new ProjectScannerAgent();
    const result = await scanner.run(baseCtx);

    expect(result.success).toBe(true);
    expect(result.mutatedGraph.languages).toContain('python');
  });

  it('scanner records imports for main.py', async () => {
    const scanner = new ProjectScannerAgent();
    const result = await scanner.run(baseCtx);

    expect(result.success).toBe(true);
    // Verify importMap written to intermediate
    // At least main.py and models/user.py should have been imported
    const fileNode = result.mutatedGraph.nodes.find((n) => n.id === 'file:main.py');
    expect(fileNode).toBeDefined();
  });

  it('file nodes have fileCategory=source', async () => {
    const scanner = new ProjectScannerAgent();
    const result = await scanner.run(baseCtx);

    const pyNode = result.mutatedGraph.nodes.find((n) => n.id === 'file:main.py');
    expect(pyNode?.metadata?.fileCategory).toBe('source');
  });

  it('file-analyzer creates function nodes from Python files', async () => {
    const scanner = new ProjectScannerAgent();
    const scanResult = await scanner.run(baseCtx);
    expect(scanResult.success).toBe(true);

    const analyzerCtx: AgentContext = { ...baseCtx, graph: scanResult.mutatedGraph };
    const analyzer = new FileAnalyzerAgent();
    const result = await analyzer.run(analyzerCtx);

    expect(result.success).toBe(true);
    const nodeIds = result.mutatedGraph.nodes.map((n) => n.id);
    expect(nodeIds).toContain('function:utils.py:greet');
    expect(nodeIds).toContain('function:utils.py:format_name');
  });

  it('file-analyzer creates class nodes from models/user.py', async () => {
    const scanner = new ProjectScannerAgent();
    const scanResult = await scanner.run(baseCtx);

    const analyzerCtx: AgentContext = { ...baseCtx, graph: scanResult.mutatedGraph };
    const analyzer = new FileAnalyzerAgent();
    const result = await analyzer.run(analyzerCtx);

    expect(result.success).toBe(true);
    const classIds = result.mutatedGraph.nodes
      .filter((n) => n.type === 'class')
      .map((n) => n.id);
    expect(classIds).toContain('class:models/user.py:User');
    expect(classIds).toContain('class:models/user.py:AdminUser');
  });

  it('file-analyzer creates contains edges for Python nodes', async () => {
    const scanner = new ProjectScannerAgent();
    const scanResult = await scanner.run(baseCtx);

    const analyzerCtx: AgentContext = { ...baseCtx, graph: scanResult.mutatedGraph };
    const analyzer = new FileAnalyzerAgent();
    const result = await analyzer.run(analyzerCtx);

    const greetEdge = result.mutatedGraph.edges.find(
      (e) => e.source === 'file:utils.py' && e.target === 'function:utils.py:greet' && e.type === 'contains'
    );
    expect(greetEdge).toBeDefined();

    const classEdge = result.mutatedGraph.edges.find(
      (e) => e.source === 'file:models/user.py' && e.target === 'class:models/user.py:User' && e.type === 'contains'
    );
    expect(classEdge).toBeDefined();
  });

  it('full pipeline produces import edges between Python files', async () => {
    const scanner = new ProjectScannerAgent();
    const scanResult = await scanner.run(baseCtx);

    const analyzerCtx: AgentContext = { ...baseCtx, graph: scanResult.mutatedGraph };
    const analyzer = new FileAnalyzerAgent();
    const result = await analyzer.run(analyzerCtx);

    // main.py imports from utils and models.user
    const importEdges = result.mutatedGraph.edges.filter((e) => e.type === 'imports');
    const fromMain = importEdges.filter((e) => e.source === 'file:main.py');
    const targets = fromMain.map((e) => e.target);

    expect(targets).toContain('file:utils.py');
    expect(targets).toContain('file:models/user.py');
  });
});
