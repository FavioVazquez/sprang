import { describe, it, expect } from 'vitest';
import { mergePhase1IntoEnriched } from '../../src/graph/store.js';
import type { KnowledgeGraph } from '../../src/schema/types.js';

/**
 * Regression for v0.2.3: a `--phase1-only` refresh (post-commit hook, watcher,
 * --if-stale) used to overwrite the enriched graph with a bare skeleton,
 * discarding layers / domains / tours / risk / security. mergePhase1IntoEnriched
 * keeps the Phase 2 work while taking the fresh structural skeleton.
 */
function skeleton(): KnowledgeGraph {
  const now = new Date().toISOString();
  return {
    version: '1.0.0',
    generated_at: now,
    project_root: '/p',
    project_name: 'p',
    phase: 'skeleton',
    nodes: [
      { id: 'file:a.ts', type: 'file', label: 'a.ts' },
      { id: 'file:c.ts', type: 'file', label: 'c.ts' }, // a brand-new file
    ],
    edges: [],
    layers: [],
    tours: [],
    domains: [],
    stats: {
      node_count: 2,
      edge_count: 0,
      risk_summary: { high: 0, medium: 0, low: 0 },
      smell_summary: {},
      generated_at: now,
    },
  } as KnowledgeGraph;
}

function enriched(): KnowledgeGraph {
  const now = new Date().toISOString();
  return {
    version: '1.0.0',
    generated_at: now,
    project_root: '/p',
    project_name: 'p',
    phase: 'complete',
    nodes: [
      {
        id: 'file:a.ts', type: 'file', label: 'a.ts',
        layer: 'domain', summary: 'Does A things', risk_score: 0.42,
        security_warnings: [{ category: 'unsafe_eval', severity: 'high', description: 'eval', pattern: 'eval(' }],
      },
      { id: 'file:b.ts', type: 'file', label: 'b.ts', layer: 'data', risk_score: 0.1 }, // file deleted in skeleton
    ],
    edges: [],
    layers: [{ id: 'domain', name: 'Domain', node_ids: ['file:a.ts'] }],
    tours: [{ id: 'default-tour', title: 'Overview', description: 'x', steps: [{ node_id: 'file:a.ts', step_title: 'S1', explanation: 'e' }] }],
    domains: [{ id: 'core', label: 'Core', summary: 'core', flows: [], entities: [] }],
    stats: {
      node_count: 2,
      edge_count: 0,
      risk_summary: { high: 0, medium: 1, low: 1 },
      smell_summary: { orphan_node: 1 },
      security_summary: { total: 1, by_severity: { high: 1, medium: 0, low: 0 }, by_category: { unsafe_eval: 1 } },
      phase2_completed_at: now,
      generated_at: now,
    },
  } as KnowledgeGraph;
}

describe('mergePhase1IntoEnriched', () => {
  it('keeps Phase 2 top-level structures (layers, tours, domains, security stats)', () => {
    const merged = mergePhase1IntoEnriched(skeleton(), enriched());
    expect(merged.phase).toBe('complete');
    expect(merged.layers).toHaveLength(1);
    expect(merged.tours).toHaveLength(1);
    expect(merged.domains[0]?.label).toBe('Core');
    expect(merged.stats.security_summary?.total).toBe(1);
    expect(merged.stats.phase2_completed_at).toBeDefined();
  });

  it('carries per-node enrichment onto surviving nodes', () => {
    const merged = mergePhase1IntoEnriched(skeleton(), enriched());
    const a = merged.nodes.find((n) => n.id === 'file:a.ts');
    expect(a?.layer).toBe('domain');
    expect(a?.risk_score).toBe(0.42);
    expect(a?.summary).toBe('Does A things');
    expect(a?.security_warnings).toHaveLength(1);
  });

  it('uses the fresh skeleton node set (adds new files, drops removed ones)', () => {
    const merged = mergePhase1IntoEnriched(skeleton(), enriched());
    const ids = merged.nodes.map((n) => n.id).sort();
    expect(ids).toEqual(['file:a.ts', 'file:c.ts']); // b.ts removed, c.ts added
    // The brand-new file has no carried enrichment.
    expect(merged.nodes.find((n) => n.id === 'file:c.ts')?.risk_score).toBeUndefined();
  });
});
