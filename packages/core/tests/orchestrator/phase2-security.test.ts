import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runPhase1 } from '../../src/orchestrator/phase1.js';
import { runPhase2 } from '../../src/orchestrator/phase2.js';
import { NullLLMClient } from '../../src/llm/client.js';
import type { SprangOptions } from '../../src/agents/base.js';
import type { KnowledgeGraph } from '../../src/schema/types.js';

/**
 * Regression test for the Phase 2 security-scanner wiring.
 *
 * `loadSecurityScanner()` existed in phase2.ts but was never invoked, so the
 * SecurityScannerAgent never ran during a full scan — `stats.security_summary`
 * stayed empty and the health-grade security penalty was always 0. This test
 * runs the real Phase 1 → Phase 2 pipeline against a deliberately vulnerable
 * file and asserts the scanner actually executed.
 */
describe('runPhase2 — security scanner wiring', () => {
  let tmpDir: string;
  let sprangDir: string;
  let graph: KnowledgeGraph;

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'sprang-phase2-security-'));
    sprangDir = join(tmpDir, '.sprang');

    // A file with two high-severity findings: eval() and a hardcoded API key.
    await writeFile(
      join(tmpDir, 'app.ts'),
      [
        'export function run(userInput: string) {',
        '  const api_key = "AKIA1234567890ABCDEF";',
        '  return eval(userInput);',
        '}',
      ].join('\n'),
      'utf-8',
    );

    const options: SprangOptions = { skipLLM: true };
    const llm = new NullLLMClient();
    const log = (_msg: string) => { /* suppress output in tests */ };

    await runPhase1(tmpDir, sprangDir, options, llm, log);
    graph = await runPhase2(tmpDir, sprangDir, options, log);
  }, 60000);

  afterAll(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  it('populates stats.security_summary (scanner ran)', () => {
    expect(graph.stats.security_summary).toBeDefined();
    expect(graph.stats.security_summary!.total).toBeGreaterThan(0);
    expect(graph.stats.security_summary!.by_severity.high).toBeGreaterThan(0);
  });

  it('attaches security_warnings to the vulnerable file node', () => {
    const fileNode = graph.nodes.find(
      (n) => n.type === 'file' && (n.location?.file ?? '').endsWith('app.ts'),
    );
    expect(fileNode).toBeDefined();
    expect((fileNode!.security_warnings ?? []).length).toBeGreaterThan(0);
    const categories = (fileNode!.security_warnings ?? []).map((w) => w.category);
    expect(categories).toContain('unsafe_eval');
  });
});
