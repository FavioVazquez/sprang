import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ProjectScannerAgent } from '../../src/agents/project-scanner.js';
import { createEmptyGraph } from '../../src/graph/store.js';
import { NullLLMClient } from '../../src/llm/client.js';
import type { AgentContext, SprangOptions } from '../../src/agents/base.js';
import type { ScanResult } from '../../src/schema/types.js';
import { readJsonFileOrNull } from '../../src/utils/fs.js';

const FIXTURE_ROOT = new URL('../fixtures/simple-ts', import.meta.url).pathname;

describe('ProjectScannerAgent', () => {
  let tmpDir: string;
  let ctx: AgentContext;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'sprang-scanner-test-'));
    const sprangDir = join(tmpDir, '.sprang');
    const intermediateDir = join(sprangDir, 'intermediate');
    const cacheDir = join(sprangDir, 'cache');

    const graph = createEmptyGraph(FIXTURE_ROOT, 'simple-ts-fixture');
    const options: SprangOptions = { skipLLM: true };
    // LLMClient with no key — won't be called in phase 1
    const llm = new NullLLMClient();

    ctx = {
      projectRoot: FIXTURE_ROOT,
      sprangDir,
      intermediateDir,
      cacheDir,
      graph,
      llm,
      options,
    };
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('creates file nodes for index.ts, utils.ts, and services/user.ts', async () => {
    const agent = new ProjectScannerAgent();
    const result = await agent.run(ctx);

    expect(result.success).toBe(true);

    const nodeIds = result.mutatedGraph.nodes.map((n) => n.id);
    expect(nodeIds).toContain('file:src/index.ts');
    expect(nodeIds).toContain('file:src/utils.ts');
    expect(nodeIds).toContain('file:src/services/user.ts');
  });

  it('detects TypeScript language for .ts files', async () => {
    const agent = new ProjectScannerAgent();
    const result = await agent.run(ctx);

    expect(result.success).toBe(true);
    const languages = result.mutatedGraph.languages ?? [];
    expect(languages).toContain('typescript');
  });

  it('writes scan-result.json with importMap entries', async () => {
    const agent = new ProjectScannerAgent();
    const result = await agent.run(ctx);

    expect(result.success).toBe(true);

    // Read the intermediate file
    const scanResult = await readJsonFileOrNull<ScanResult>(
      join(ctx.intermediateDir, 'scan-result.json')
    );

    expect(scanResult).not.toBeNull();
    expect(scanResult!.importMap).toBeDefined();

    // At least one file should have imports
    const hasImports = Object.keys(scanResult!.importMap).length > 0;
    expect(hasImports).toBe(true);
  });

  it('writes scan-result.json with correct file records', async () => {
    const agent = new ProjectScannerAgent();
    const result = await agent.run(ctx);

    expect(result.success).toBe(true);

    const scanResult = await readJsonFileOrNull<ScanResult>(
      join(ctx.intermediateDir, 'scan-result.json')
    );

    expect(scanResult).not.toBeNull();
    const filePaths = scanResult!.files.map((f) => f.path);
    expect(filePaths).toContain('src/index.ts');
    expect(filePaths).toContain('src/utils.ts');
    expect(filePaths).toContain('src/services/user.ts');
  });

  it('detects project name from package.json', async () => {
    const agent = new ProjectScannerAgent();
    const result = await agent.run(ctx);

    expect(result.success).toBe(true);
    expect(result.mutatedGraph.project_name).toBe('simple-ts-fixture');
  });

  it('all file nodes have type=file', async () => {
    const agent = new ProjectScannerAgent();
    const result = await agent.run(ctx);

    expect(result.success).toBe(true);
    const fileNodes = result.mutatedGraph.nodes.filter((n) => n.id.startsWith('file:'));
    for (const node of fileNodes) {
      expect(node.type).toBe('file');
    }
  });
});
