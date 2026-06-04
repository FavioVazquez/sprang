import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ProjectScannerAgent } from '../../src/agents/project-scanner.js';
import { createEmptyGraph } from '../../src/graph/store.js';
import { NullLLMClient } from '../../src/llm/client.js';
import type { AgentContext, SprangOptions } from '../../src/agents/base.js';
import type { ScanResult } from '../../src/schema/types.js';
import { readJsonFileOrNull } from '../../src/utils/fs.js';
import { loadFingerprintStore } from '../../src/utils/fingerprint.js';

const FIXTURE_ROOT = new URL('../fixtures/simple-ts', import.meta.url).pathname;

function makeCtx(projectRoot: string, sprangDir: string): AgentContext {
  const intermediateDir = join(sprangDir, 'intermediate');
  const cacheDir = join(sprangDir, 'cache');
  const graph = createEmptyGraph(projectRoot, 'test-fixture');
  const options: SprangOptions = { skipLLM: true };
  const llm = new NullLLMClient();
  return { projectRoot, sprangDir, intermediateDir, cacheDir, graph, llm, options };
}

describe('ProjectScannerAgent — fingerprinting integration', () => {
  let tmpDir: string;
  let sprangDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'sprang-fp-integration-'));
    sprangDir = join(tmpDir, '.sprang');
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('produces fingerprintStats on a full scan of simple-ts fixture', async () => {
    const agent = new ProjectScannerAgent();
    const ctx = makeCtx(FIXTURE_ROOT, sprangDir);
    const result = await agent.run(ctx);

    expect(result.success).toBe(true);

    const scanResult = await readJsonFileOrNull<ScanResult>(
      join(ctx.intermediateDir, 'scan-result.json')
    );

    expect(scanResult).not.toBeNull();
    expect(scanResult!.fingerprintStats).toBeDefined();

    const stats = scanResult!.fingerprintStats!;
    expect(stats.total).toBeGreaterThan(0);
    expect(stats.skip + stats.cosmetic + stats.structural).toBe(stats.total);
  });

  it('first scan marks all files as STRUCTURAL (no previous store)', async () => {
    const agent = new ProjectScannerAgent();
    const ctx = makeCtx(FIXTURE_ROOT, sprangDir);
    const result = await agent.run(ctx);

    expect(result.success).toBe(true);

    const scanResult = await readJsonFileOrNull<ScanResult>(
      join(ctx.intermediateDir, 'scan-result.json')
    );

    expect(scanResult).not.toBeNull();
    const stats = scanResult!.fingerprintStats!;
    expect(stats.structural).toBe(stats.total);
    expect(stats.skip).toBe(0);
    expect(stats.cosmetic).toBe(0);
  });

  it('second scan of unchanged files → all SKIP', async () => {
    const agent = new ProjectScannerAgent();
    const ctx = makeCtx(FIXTURE_ROOT, sprangDir);

    // First scan
    const result1 = await agent.run(ctx);
    expect(result1.success).toBe(true);

    // Second scan — reuse same sprangDir so fingerprint store is present
    const ctx2 = makeCtx(FIXTURE_ROOT, sprangDir);
    const result2 = await agent.run(ctx2);
    expect(result2.success).toBe(true);

    const scanResult = await readJsonFileOrNull<ScanResult>(
      join(ctx2.intermediateDir, 'scan-result.json')
    );

    expect(scanResult).not.toBeNull();
    const stats = scanResult!.fingerprintStats!;
    expect(stats.skip).toBe(stats.total);
    expect(stats.structural).toBe(0);
    expect(stats.cosmetic).toBe(0);
  });

  it('modifying a fixture file makes it STRUCTURAL on next scan', async () => {
    // Set up a temporary copy of the fixture to allow safe mutation
    const fixtureRoot = join(tmpDir, 'project');
    await mkdir(join(fixtureRoot, 'src', 'services'), { recursive: true });

    // Copy the files we need
    const { readFile } = await import('node:fs/promises');
    await writeFile(
      join(fixtureRoot, 'package.json'),
      JSON.stringify({ name: 'mutation-test-fixture', type: 'module' })
    );
    await writeFile(
      join(fixtureRoot, 'src', 'utils.ts'),
      await readFile(join(FIXTURE_ROOT, 'src', 'utils.ts'), 'utf-8')
    );
    await writeFile(
      join(fixtureRoot, 'src', 'index.ts'),
      await readFile(join(FIXTURE_ROOT, 'src', 'index.ts'), 'utf-8')
    );
    await writeFile(
      join(fixtureRoot, 'src', 'services', 'user.ts'),
      await readFile(join(FIXTURE_ROOT, 'src', 'services', 'user.ts'), 'utf-8')
    );

    const projectSprangDir = join(tmpDir, 'project-sprang');

    // First scan
    const agent = new ProjectScannerAgent();
    const ctx1 = makeCtx(fixtureRoot, projectSprangDir);
    const result1 = await agent.run(ctx1);
    expect(result1.success).toBe(true);

    // Modify one file — add a new function (structural change)
    const utilsPath = join(fixtureRoot, 'src', 'utils.ts');
    const originalContent = await readFile(utilsPath, 'utf-8');
    await writeFile(utilsPath, originalContent + '\nexport function newHelper(): void {}\n');

    // Second scan
    const ctx2 = makeCtx(fixtureRoot, projectSprangDir);
    const result2 = await agent.run(ctx2);
    expect(result2.success).toBe(true);

    const scanResult = await readJsonFileOrNull<ScanResult>(
      join(ctx2.intermediateDir, 'scan-result.json')
    );

    expect(scanResult).not.toBeNull();
    const stats = scanResult!.fingerprintStats!;

    // The modified file should be STRUCTURAL
    expect(stats.structural).toBeGreaterThanOrEqual(1);
    // The other files should be SKIP
    expect(stats.skip).toBeGreaterThanOrEqual(stats.total - 1);

    // Verify the specific file record has STRUCTURAL changeType
    const modifiedRecord = scanResult!.files.find((f) => f.path === 'src/utils.ts');
    expect(modifiedRecord).toBeDefined();
    expect(modifiedRecord!.changeType).toBe('STRUCTURAL');

    // Verify other files are SKIP
    const unchangedRecord = scanResult!.files.find((f) => f.path === 'src/index.ts');
    expect(unchangedRecord).toBeDefined();
    expect(unchangedRecord!.changeType).toBe('SKIP');
  });

  it('saves fingerprint store to cache directory after scan', async () => {
    const agent = new ProjectScannerAgent();
    const ctx = makeCtx(FIXTURE_ROOT, sprangDir);
    await agent.run(ctx);

    const store = await loadFingerprintStore(sprangDir);
    expect(store).not.toBeNull();
    expect(store!.version).toBe('1.0');
    expect(Object.keys(store!.files).length).toBeGreaterThan(0);
  });

  it('file nodes in the graph still appear regardless of changeType', async () => {
    const agent = new ProjectScannerAgent();
    const ctx = makeCtx(FIXTURE_ROOT, sprangDir);

    // First scan — all STRUCTURAL
    const result1 = await agent.run(ctx);
    const nodeIds1 = result1.mutatedGraph.nodes.map((n) => n.id);
    expect(nodeIds1).toContain('file:src/index.ts');
    expect(nodeIds1).toContain('file:src/utils.ts');
    expect(nodeIds1).toContain('file:src/services/user.ts');

    // Second scan — all SKIP but nodes still present
    const ctx2 = makeCtx(FIXTURE_ROOT, sprangDir);
    const result2 = await agent.run(ctx2);
    const nodeIds2 = result2.mutatedGraph.nodes.map((n) => n.id);
    expect(nodeIds2).toContain('file:src/index.ts');
    expect(nodeIds2).toContain('file:src/utils.ts');
    expect(nodeIds2).toContain('file:src/services/user.ts');
  });
});
