import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ProjectScannerAgent } from '../../src/agents/project-scanner.js';
import { FileAnalyzerAgent } from '../../src/agents/file-analyzer.js';
import { createEmptyGraph } from '../../src/graph/store.js';
import { NullLLMClient } from '../../src/llm/client.js';
import type { AgentContext, SprangOptions } from '../../src/agents/base.js';
import type { KnowledgeGraph } from '../../src/schema/types.js';

const FIXTURE_ROOT = new URL('../fixtures/call-graph', import.meta.url).pathname;

describe('FileAnalyzerAgent — call graph + patterns', () => {
  let tmpDir: string;
  let result: KnowledgeGraph;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'sprang-callgraph-test-'));
    const sprangDir = join(tmpDir, '.sprang');
    const ctx: AgentContext = {
      projectRoot: FIXTURE_ROOT,
      sprangDir,
      intermediateDir: join(sprangDir, 'intermediate'),
      cacheDir: join(sprangDir, 'cache'),
      graph: createEmptyGraph(FIXTURE_ROOT, 'call-graph-fixture'),
      llm: new NullLLMClient(),
      options: { skipLLM: true } as SprangOptions,
    };
    const scan = await new ProjectScannerAgent().run(ctx);
    expect(scan.success).toBe(true);
    const analyze = await new FileAnalyzerAgent().run({ ...ctx, graph: scan.mutatedGraph });
    expect(analyze.success).toBe(true);
    result = analyze.mutatedGraph;
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // ─── Call graph ────────────────────────────────────────────────────

  it('creates an internal `calls` edge (sumList → add, same file)', () => {
    const edge = result.edges.find(
      (e) =>
        e.type === 'calls' &&
        e.source === 'function:src/math.ts:sumList' &&
        e.target === 'function:src/math.ts:add',
    );
    expect(edge).toBeDefined();
  });

  it('creates an external `calls` edge (compute → add, across imported file)', () => {
    const edge = result.edges.find(
      (e) =>
        e.type === 'calls' &&
        e.source === 'function:src/app.ts:compute' &&
        e.target === 'function:src/math.ts:add',
    );
    expect(edge).toBeDefined();
  });

  it('records internalCalls / externalCalls counts on caller nodes', () => {
    const sumList = result.nodes.find((n) => n.id === 'function:src/math.ts:sumList');
    expect(sumList?.metadata?.['internalCalls']).toBeGreaterThanOrEqual(1);

    const compute = result.nodes.find((n) => n.id === 'function:src/app.ts:compute');
    expect(compute?.metadata?.['externalCalls']).toBeGreaterThanOrEqual(1);
  });

  it('records callerCount on a called function', () => {
    const add = result.nodes.find((n) => n.id === 'function:src/math.ts:add');
    // add is called by sumList (internal) and compute (external) → 2 callers
    expect(add?.metadata?.['callerCount']).toBeGreaterThanOrEqual(2);
  });

  it('does not create a calls edge for a function calling itself', () => {
    const selfEdge = result.edges.find(
      (e) => e.type === 'calls' && e.source === e.target,
    );
    expect(selfEdge).toBeUndefined();
  });

  // ─── Pattern detection ─────────────────────────────────────────────

  it('detects the context_provider pattern', () => {
    const ctxNode = result.nodes.find((n) => n.id === 'file:src/context.tsx');
    expect(ctxNode?.detected_patterns).toContain('context_provider');
  });

  it('detects the event_emitter pattern', () => {
    const busNode = result.nodes.find((n) => n.id === 'file:src/bus.ts');
    expect(busNode?.detected_patterns).toContain('event_emitter');
  });

  it('detects the decorator pattern', () => {
    const svcNode = result.nodes.find((n) => n.id === 'file:src/service.ts');
    expect(svcNode?.detected_patterns).toContain('decorator');
  });
});
