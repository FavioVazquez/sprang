import { describe, it, expect } from 'vitest';
import { mkdirSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { DomainAnalyzerAgent } from '../../src/agents/domain-analyzer.js';
import type { AgentContext } from '../../src/agents/base.js';
import type { KnowledgeGraph, SprangNode } from '../../src/schema/types.js';
import type { LLMClient } from '../../src/llm/client.js';

function fileNode(id: string, label: string, file: string): SprangNode {
  return { id, type: 'file', label, location: { file } };
}

function makeGraph(nodes: SprangNode[]): KnowledgeGraph {
  const now = new Date().toISOString();
  return {
    version: '1.0.0', generated_at: now, project_root: '/tmp/test', project_name: 'test',
    phase: 'skeleton', nodes, edges: [], layers: [], tours: [], domains: [],
    stats: { node_count: nodes.length, edge_count: 0, risk_summary: { high: 0, medium: 0, low: 0 }, smell_summary: {}, generated_at: now },
  };
}

/** ctx whose LLM returns `llmReply` (default '' to mimic the NullLLMClient). */
function makeCtx(graph: KnowledgeGraph, opts: { skipLLM: boolean; llmReply?: string }): AgentContext {
  const tmp = join(os.tmpdir(), `sprang-domain-${Math.random().toString(36).slice(2)}`);
  const intermediateDir = join(tmp, '.sprang', 'intermediate');
  mkdirSync(intermediateDir, { recursive: true });
  return {
    projectRoot: tmp,
    sprangDir: join(tmp, '.sprang'),
    intermediateDir,
    cacheDir: join(tmp, '.sprang', 'cache'),
    graph,
    llm: { complete: async () => opts.llmReply ?? '', completeBatch: async () => [], getTokenUsage: () => 0 } as unknown as LLMClient,
    options: { skipLLM: opts.skipLLM },
  };
}

// The analyzer needs ≥3 file nodes overall; the `data` directory has two
// (forming a cluster) plus one file elsewhere that won't cluster on its own.
const cluster = [
  fileNode('file:src/data/db.ts', 'db.ts', 'src/data/db.ts'),
  fileNode('file:src/data/config.ts', 'config.ts', 'src/data/config.ts'),
  fileNode('file:src/index.ts', 'index.ts', 'src/index.ts'),
];

describe('DomainAnalyzerAgent (v0.2.3 empty-name fix)', () => {
  it('names domains heuristically when the LLM returns empty (regression)', async () => {
    // skipLLM:false but the NullLLMClient returns '' — the agent must fall back
    // to the directory heuristic instead of producing an empty id/label.
    const result = await new DomainAnalyzerAgent().run(makeCtx(makeGraph(cluster), { skipLLM: false, llmReply: '' }));
    expect(result.success).toBe(true);
    const domains = result.mutatedGraph?.domains ?? [];
    expect(domains.length).toBeGreaterThanOrEqual(1);
    expect(domains[0]?.label).not.toBe('');
    expect(domains[0]?.id).not.toBe('');
    expect(domains[0]?.label).toBe('data');
  });

  it('uses the directory name in explicit heuristic mode (skipLLM)', async () => {
    const result = await new DomainAnalyzerAgent().run(makeCtx(makeGraph(cluster), { skipLLM: true }));
    const domains = result.mutatedGraph?.domains ?? [];
    expect(domains[0]?.label).toBe('data');
  });

  it('uses a non-empty LLM name when one is provided', async () => {
    const result = await new DomainAnalyzerAgent().run(makeCtx(makeGraph(cluster), { skipLLM: false, llmReply: 'Data Access' }));
    const domains = result.mutatedGraph?.domains ?? [];
    expect(domains[0]?.label).toBe('Data Access');
    expect(domains[0]?.id).toBe('data-access');
  });
});
