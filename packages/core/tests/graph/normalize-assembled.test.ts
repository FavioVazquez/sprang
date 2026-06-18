import { describe, it, expect } from 'vitest';
import { normalizeAssembledGraph, knowledgeGraphSchema } from '../../src/index.js';

/** Wrap normalised pieces into a full graph envelope so we can validate end-to-end. */
function envelope(norm: ReturnType<typeof normalizeAssembledGraph>) {
  const now = new Date().toISOString();
  return {
    version: '0.2.0', kind: 'codebase', generated_at: now, project_root: '/x', project_name: 'p',
    phase: 'complete', nodes: norm.nodes, edges: [], layers: norm.layers, tours: norm.tours, domains: norm.domains,
    stats: {
      node_count: norm.nodes.length, edge_count: 0, risk_summary: norm.risk_summary,
      smell_summary: norm.smell_summary, generated_at: now,
      ...(norm.security_summary ? { security_summary: norm.security_summary } : {}),
    },
  };
}

describe('normalizeAssembledGraph (v0.2.4)', () => {
  it('coerces drifted agent output into a schema-valid graph', () => {
    const norm = normalizeAssembledGraph({
      nodes: [
        { id: 'file:a.ts', type: 'file', label: 'a.ts',
          decision_context: { primary_authors: ['x'], last_changed: '2026-01-01', change_frequency: '8' },
          structural_warnings: ['bare string', { category: 'god_node', severity: 'high', description: 'd', related_node_ids: [], heuristic: '' }],
          risk_factors: ['critical_path', 'made_up'], risk_score: 0.9 },
      ],
      layers: ['Core', { id: 'l2', name: 'Utils', node_ids: ['file:a.ts'] }],
      tours: [{ id: 't', title: 'T', description: 'd', steps: [{ title: 'Entry', description: 'start', node_ids: ['file:a.ts'] }] }],
      domains: [{ id: 'd', name: 'Payments', node_ids: ['file:a.ts'] }],
    });
    expect(knowledgeGraphSchema.safeParse(envelope(norm)).success).toBe(true);
  });

  it('maps domain name→label, wraps flat domains, and fixes tour/decision_context fields', () => {
    const norm = normalizeAssembledGraph({
      nodes: [{ id: 'file:a.ts', type: 'file', label: 'a.ts',
        decision_context: { change_frequency: '12' } }],
      layers: [],
      tours: [{ steps: [{ title: 'S', description: 'e' }] }],
      domains: [{ name: 'Inference Engine', node_ids: ['file:a.ts'] }],
    });
    expect(norm.domains[0].label).toBe('Inference Engine');
    expect(norm.domains[0].id).toBe('inference-engine');
    expect(norm.domains[0].flows[0].steps[0].weight).toBe(1.0);
    expect((norm.nodes[0].decision_context as { change_frequency: number }).change_frequency).toBe(12);
  });

  it('drops invalid risk_factors / structural_warnings and recomputes smell_summary', () => {
    const norm = normalizeAssembledGraph({
      nodes: [{ id: 'file:a.ts', type: 'file', label: 'a.ts',
        risk_factors: ['high_coupling', 'nope'],
        structural_warnings: [{ category: 'invalid_cat', severity: 'high', description: '', related_node_ids: [], heuristic: '' },
                              { category: 'over_connected', severity: 'low', description: '', related_node_ids: [], heuristic: '' }] }],
      layers: [], tours: [], domains: [],
    });
    expect(norm.nodes[0].risk_factors).toEqual(['high_coupling']);
    expect(norm.nodes[0].structural_warnings).toHaveLength(1);
    expect(norm.smell_summary).toEqual({ over_connected: 1 });
  });

  it('wraps a flat tour step array and clamps to 15 steps', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ step_title: `S${i}`, explanation: 'e', node_ids: ['file:a.ts'] }));
    const norm = normalizeAssembledGraph({ nodes: [], layers: [], tours: many, domains: [] });
    expect(norm.tours).toHaveLength(1);
    expect(norm.tours[0].steps).toHaveLength(15);
  });
});
