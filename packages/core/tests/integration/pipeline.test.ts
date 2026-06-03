import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runPhase1 } from '../../src/orchestrator/phase1.js';
import { NullLLMClient } from '../../src/llm/client.js';
import type { SprangOptions } from '../../src/agents/base.js';
import { REPORT_FILE, INTERMEDIATE_DIR, CACHE_DIR } from '../../src/schema/constants.js';
import { readJsonFileOrNull } from '../../src/utils/fs.js';
import type { KnowledgeGraph } from '../../src/schema/types.js';

// ─── Fixture Setup ────────────────────────────────────────────────────────────

const FIXTURE_ROOT = new URL('../fixtures/simple-ts', import.meta.url).pathname;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Phase 1 Pipeline (integration)', () => {
  let tmpDir: string;
  let sprangDir: string;
  let result: KnowledgeGraph;

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'sprang-pipeline-test-'));
    sprangDir = join(tmpDir, '.sprang');

    const options: SprangOptions = { skipLLM: true };
    // Use a dummy key — LLM won't be called when skipLLM is true
    const llm = new NullLLMClient();
    const log = (_msg: string) => { /* suppress output in tests */ };

    result = await runPhase1(FIXTURE_ROOT, sprangDir, options, llm, log);
  }, 60000);

  afterAll(async () => {
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('returns a valid KnowledgeGraph object', () => {
    expect(result).toBeDefined();
    expect(typeof result).toBe('object');
    expect(result.version).toBeDefined();
    expect(result.nodes).toBeDefined();
    expect(result.edges).toBeDefined();
  });

  it('has node_count > 0', () => {
    expect(result.stats.node_count).toBeGreaterThan(0);
    expect(result.nodes.length).toBeGreaterThan(0);
  });

  it('has edge_count >= 0', () => {
    expect(result.stats.edge_count).toBeGreaterThanOrEqual(0);
    expect(result.edges.length).toBeGreaterThanOrEqual(0);
  });

  it('has phase === "skeleton"', () => {
    expect(result.phase).toBe('skeleton');
  });

  it('output JSON is valid and parseable from disk', async () => {
    const graphPath = join(sprangDir, 'knowledge-graph.json');
    const graphData = await readJsonFileOrNull<KnowledgeGraph>(graphPath);

    expect(graphData).not.toBeNull();
    expect(graphData!.nodes).toBeDefined();
    expect(graphData!.edges).toBeDefined();
    expect(graphData!.phase).toBe('skeleton');
  });

  it('SPRANG_REPORT.md exists in sprang output dir', async () => {
    const reportPath = join(sprangDir, REPORT_FILE);
    await expect(access(reportPath)).resolves.toBeUndefined();
  });

  it('SPRANG_REPORT.md contains project name', async () => {
    const { readFile } = await import('node:fs/promises');
    const reportPath = join(sprangDir, REPORT_FILE);
    const content = await readFile(reportPath, 'utf-8');

    expect(content).toContain('Sprang Report');
    expect(content.length).toBeGreaterThan(0);
  });

  it('graph contains file nodes for fixture src files', () => {
    const nodeIds = result.nodes.map((n) => n.id);
    expect(nodeIds).toContain('file:src/index.ts');
    expect(nodeIds).toContain('file:src/utils.ts');
    expect(nodeIds).toContain('file:src/services/user.ts');
  });

  it('stats.node_count matches actual nodes array length', () => {
    expect(result.stats.node_count).toBe(result.nodes.length);
  });

  it('stats.edge_count matches actual edges array length', () => {
    expect(result.stats.edge_count).toBe(result.edges.length);
  });

  it('intermediate directory was created and contains scan-result.json', async () => {
    const intermediateDir = join(sprangDir, INTERMEDIATE_DIR);
    const scanResultPath = join(intermediateDir, 'scan-result.json');
    await expect(access(scanResultPath)).resolves.toBeUndefined();
  });

  it('all file nodes have required fields', () => {
    const fileNodes = result.nodes.filter((n) => n.type === 'file');
    for (const node of fileNodes) {
      expect(node.id).toBeDefined();
      expect(node.type).toBe('file');
      expect(node.label).toBeDefined();
    }
  });

  it('project_root matches the fixture root', () => {
    expect(result.project_root).toBe(FIXTURE_ROOT);
  });
});
