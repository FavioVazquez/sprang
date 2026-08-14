/**
 * Regression tests for the health-grade inflation bug.
 *
 * Phase 1 computed per-node `structural_warnings` / `security_warnings` but only
 * persisted summaries. After `/sprang-analyze` rebuilt the graph from agent
 * chunks the findings were gone, so `sprang_health` reported a much better grade
 * for code that had not changed (measured on a real project: F/49 → B/82,
 * security findings 7 → 0). `node-warnings.json` is the carry-over channel.
 */

import { describe, it, expect } from 'vitest';
import { buildNodeWarningsIndex, applyNodeWarnings } from '../../src/graph/node-warnings.js';
import type { KnowledgeGraph } from '../../src/schema/types.js';

const secWarning = {
  category: 'hardcoded_secret' as const,
  severity: 'high' as const,
  description: 'Hardcoded API key',
  pattern: 'api_key',
};
const smellWarning = {
  category: 'god_node' as const,
  severity: 'medium' as const,
  description: 'Too many dependents',
  related_node_ids: [],
  heuristic: 'in_degree',
};

function graphWith(nodes: unknown[]): KnowledgeGraph {
  return { nodes } as unknown as KnowledgeGraph;
}

describe('buildNodeWarningsIndex', () => {
  it('captures every per-node finding Phase 1 produced', () => {
    const index = buildNodeWarningsIndex(graphWith([
      {
        id: 'file:bad.js',
        security_warnings: [secWarning],
        structural_warnings: [smellWarning],
        risk_score: 0.82,
        risk_factors: ['no_test_coverage'],
      },
    ]));
    expect(index['file:bad.js']).toEqual({
      security_warnings: [secWarning],
      structural_warnings: [smellWarning],
      risk_score: 0.82,
      risk_factors: ['no_test_coverage'],
    });
  });

  it('omits nodes with nothing to carry over', () => {
    const index = buildNodeWarningsIndex(graphWith([
      { id: 'file:clean.js' },
      { id: 'file:zero.js', risk_score: 0, structural_warnings: [] },
    ]));
    expect(Object.keys(index)).toEqual([]);
  });
});

describe('applyNodeWarnings', () => {
  it('restores findings onto agent-assembled nodes that lost them', () => {
    const nodes: Array<Record<string, unknown>> = [
      { id: 'file:bad.js', summary: 'Enriched summary from the agent.' },
    ];
    const applied = applyNodeWarnings(nodes, {
      'file:bad.js': { security_warnings: [secWarning], risk_score: 0.82 },
    });
    expect(applied).toBe(1);
    expect(nodes[0]!['security_warnings']).toEqual([secWarning]);
    expect(nodes[0]!['risk_score']).toBe(0.82);
    // Enrichment must survive the restore.
    expect(nodes[0]!['summary']).toBe('Enriched summary from the agent.');
  });

  it('never clobbers a value the agent produced', () => {
    // An agent-written warning is deliberate enrichment and is newer than the
    // static scan, so the Phase 1 baseline must lose.
    const nodes: Array<Record<string, unknown>> = [
      { id: 'file:bad.js', structural_warnings: [smellWarning], risk_score: 0.4 },
    ];
    applyNodeWarnings(nodes, {
      'file:bad.js': { structural_warnings: [], risk_score: 0.99 },
    });
    expect(nodes[0]!['structural_warnings']).toEqual([smellWarning]);
    expect(nodes[0]!['risk_score']).toBe(0.4);
  });

  it('treats an empty array as absent and fills it', () => {
    const nodes: Array<Record<string, unknown>> = [{ id: 'file:bad.js', security_warnings: [] }];
    applyNodeWarnings(nodes, { 'file:bad.js': { security_warnings: [secWarning] } });
    expect(nodes[0]!['security_warnings']).toEqual([secWarning]);
  });

  it('ignores nodes not present in the index and counts only real changes', () => {
    const nodes: Array<Record<string, unknown>> = [
      { id: 'file:a.js' },
      { id: 'file:b.js' },
      { notAnId: true },
    ];
    expect(applyNodeWarnings(nodes, { 'file:a.js': { risk_score: 0.5 } })).toBe(1);
    expect(nodes[1]!['risk_score']).toBeUndefined();
  });

  it('round-trips: index then apply restores the original findings', () => {
    const original = [{
      id: 'file:bad.js',
      security_warnings: [secWarning],
      structural_warnings: [smellWarning],
      risk_score: 0.82,
      risk_factors: ['no_test_coverage'],
    }];
    const index = buildNodeWarningsIndex(graphWith(original));
    const stripped: Array<Record<string, unknown>> = [{ id: 'file:bad.js' }];
    applyNodeWarnings(stripped, index);
    expect(stripped[0]).toEqual(original[0]);
  });
});
