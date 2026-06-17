import { describe, it, expect } from 'vitest';
import { mkdirSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { TourBuilderAgent } from '../../src/agents/tour-builder.js';
import type { AgentContext } from '../../src/agents/base.js';
import type { KnowledgeGraph, SprangNode, SprangEdge } from '../../src/schema/types.js';
import type { LLMClient } from '../../src/llm/client.js';

function fileNode(id: string, label: string): SprangNode {
  return { id, type: 'file', label, location: { file: label } };
}

function makeGraph(nodes: SprangNode[], edges: SprangEdge[] = []): KnowledgeGraph {
  const now = new Date().toISOString();
  return {
    version: '1.0.0', generated_at: now, project_root: '/tmp/test', project_name: 'test',
    phase: 'skeleton', nodes, edges, layers: [], tours: [], domains: [],
    stats: { node_count: nodes.length, edge_count: edges.length, risk_summary: { high: 0, medium: 0, low: 0 }, smell_summary: {}, generated_at: now },
  };
}

function makeCtx(graph: KnowledgeGraph): AgentContext {
  const tmp = join(os.tmpdir(), `sprang-tour-${Math.random().toString(36).slice(2)}`);
  const intermediateDir = join(tmp, '.sprang', 'intermediate');
  mkdirSync(intermediateDir, { recursive: true });
  return {
    projectRoot: tmp,
    sprangDir: join(tmp, '.sprang'),
    intermediateDir,
    cacheDir: join(tmp, '.sprang', 'cache'),
    graph,
    llm: { complete: async () => '', completeBatch: async () => [], getTokenUsage: () => 0 } as unknown as LLMClient,
    options: { skipLLM: true },
  };
}

describe('TourBuilderAgent (v0.2.3 robustness)', () => {
  it('still builds a tour when the first entry point is an orphan (regression)', async () => {
    // config.ts is an orphan (in/out degree 0) and may sort first as an entry
    // point; index.ts has the real dependency chain. The old builder gave up on
    // the orphan and produced zero tours.
    const nodes = [
      fileNode('file:src/data/config.ts', 'config.ts'),
      fileNode('file:src/index.ts', 'index.ts'),
      fileNode('file:src/a.ts', 'a.ts'),
      fileNode('file:src/b.ts', 'b.ts'),
    ];
    const edges: SprangEdge[] = [
      { source: 'file:src/index.ts', target: 'file:src/a.ts', type: 'imports' },
      { source: 'file:src/a.ts', target: 'file:src/b.ts', type: 'imports' },
    ];
    const result = await new TourBuilderAgent().run(makeCtx(makeGraph(nodes, edges)));
    expect(result.success).toBe(true);
    const tours = result.mutatedGraph?.tours ?? [];
    expect(tours.length).toBeGreaterThanOrEqual(1);
    const defaultTour = tours.find((t) => t.id === 'default-tour')!;
    expect(defaultTour.steps.length).toBeGreaterThanOrEqual(2);
    expect(defaultTour.entry_point).toBe('file:src/index.ts');
  });

  it('falls back to a flat tour for fully disconnected files', async () => {
    const nodes = [fileNode('file:x.ts', 'x.ts'), fileNode('file:y.ts', 'y.ts')];
    const result = await new TourBuilderAgent().run(makeCtx(makeGraph(nodes, [])));
    const tours = result.mutatedGraph?.tours ?? [];
    expect(tours.length).toBeGreaterThanOrEqual(1);
    expect(tours[0]?.steps.length).toBe(2);
  });

  it('produces no tour for a single-file graph', async () => {
    const result = await new TourBuilderAgent().run(makeCtx(makeGraph([fileNode('file:only.ts', 'only.ts')], [])));
    expect(result.mutatedGraph?.tours ?? []).toHaveLength(0);
  });
});
