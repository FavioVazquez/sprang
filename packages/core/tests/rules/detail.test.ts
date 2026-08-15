import { describe, it, expect } from 'vitest';
import {
  projectNode,
  projectNodes,
  estimateSavings,
  DEFAULT_DETAIL,
  DETAIL_LEVELS,
  type DetailLevel,
} from '../../src/rules/detail.js';
import type { SprangNode } from '../../src/schema/types.js';

// ─── Fixtures ─────────────────────────────────────────────────────────

/** A node carrying one of everything, so each level has something to drop. */
function richNode(): SprangNode {
  return {
    id: 'src/auth/session.ts',
    type: 'file',
    name: 'session.ts',
    label: 'session.ts',
    filePath: 'src/auth/session.ts',
    location: { file: 'src/auth/session.ts', start_line: 1, end_line: 240 },
    summary: 'Creates, validates and revokes user sessions backed by Redis.',
    complexity: 'complex',
    tags: ['auth', 'security'],
    layer: 'domain',
    risk_score: 0.82,
    risk_factors: ['high_coupling', 'previously_reverted'],
    structural_warnings: [
      {
        category: 'god_node',
        severity: 'high',
        description: 'This module has 31 outgoing edges and mixes four responsibilities.',
        related_node_ids: ['src/auth/login.ts', 'src/auth/tokens.ts'],
        heuristic: 'out_degree > 20',
      },
      {
        category: 'unclear_coupling',
        severity: 'medium',
        description: 'Depends on the storage layer without an interface.',
        related_node_ids: ['src/db/redis.ts'],
        heuristic: 'cross_layer_edge',
      },
    ],
    security_warnings: [
      {
        category: 'hardcoded_secret',
        severity: 'medium',
        description: 'Possible secret literal.',
        pattern: 'SECRET\\s*=',
        confidence: 'unverified',
      },
    ],
    detected_patterns: ['singleton'],
    annotations: ['Do not shorten the TTL without talking to platform.'],
    decision_context: {
      commits: [
        { sha: 'abc1234', date: '2024-02-01T00:00:00.000Z', message: 'fix session leak', author: 'ada' },
      ],
      primary_authors: ['ada'],
      last_changed: '2024-02-01T00:00:00.000Z',
      change_frequency: 12,
      rationale_snippets: ['sessions leaked across tenants'],
      pr_references: ['#412'],
      changelog_entries: [],
    },
    metadata: {
      behavioral: {
        revisions: 41,
        bug_fixes: 9,
        bus_factor: 1,
        hotspot_score: 0.77,
        // extra behavioural fields that skeleton must drop
        authors: ['ada', 'grace'],
        churn_by_month: [3, 7, 2, 9],
      },
      symbols: ['createSession', 'validateSession'],
      functions: [{ name: 'revokeSession' }, { name: 'createSession' }],
      unrelated: 'should not survive projection',
    },
  };
}

/** The other extreme: the minimum a node can legally be. */
function bareNode(): SprangNode {
  return { id: 'concept:auth', type: 'concept', label: 'Authentication' };
}

// ─── ids ──────────────────────────────────────────────────────────────

describe("projectNode — 'ids'", () => {
  it('returns exactly { id }', () => {
    expect(projectNode(richNode(), 'ids')).toEqual({ id: 'src/auth/session.ts' });
  });

  it('has exactly one key', () => {
    expect(Object.keys(projectNode(richNode(), 'ids') as object)).toEqual(['id']);
  });

  it('works on a bare node', () => {
    expect(projectNode(bareNode(), 'ids')).toEqual({ id: 'concept:auth' });
  });
});

// ─── summary ──────────────────────────────────────────────────────────

describe("projectNode — 'summary'", () => {
  it('returns the exact documented shape', () => {
    expect(projectNode(richNode(), 'summary')).toEqual({
      id: 'src/auth/session.ts',
      type: 'file',
      label: 'session.ts',
      path: 'src/auth/session.ts',
      summary: 'Creates, validates and revokes user sessions backed by Redis.',
      risk_score: 0.82,
      risk_factors: ['high_coupling', 'previously_reverted'],
    });
  });

  it('drops heavy fields: warnings, decision context, annotations, metadata', () => {
    const out = projectNode(richNode(), 'summary') as Record<string, unknown>;
    for (const key of ['structural_warnings', 'security_warnings', 'decision_context', 'annotations', 'metadata', 'tags']) {
      expect(out).not.toHaveProperty(key);
    }
  });

  it('omits absent fields rather than emitting null', () => {
    const out = projectNode(bareNode(), 'summary') as Record<string, unknown>;
    expect(out).toEqual({ id: 'concept:auth', type: 'concept', label: 'Authentication' });
    expect(Object.values(out).every((v) => v !== null)).toBe(true);
    expect('path' in out).toBe(false);
    expect('summary' in out).toBe(false);
    expect('risk_score' in out).toBe(false);
    expect('risk_factors' in out).toBe(false);
  });

  it('keeps a risk_score of 0 (falsy but present)', () => {
    const n: SprangNode = { ...bareNode(), risk_score: 0 };
    expect(projectNode(n, 'summary')).toHaveProperty('risk_score', 0);
  });

  it('falls back to location.file when filePath is absent', () => {
    const n: SprangNode = { id: 'f', type: 'function', label: 'f', location: { file: 'src/a.ts' } };
    expect(projectNode(n, 'summary')).toHaveProperty('path', 'src/a.ts');
  });

  it('has no path for a node with no location at all', () => {
    expect(projectNode(bareNode(), 'summary')).not.toHaveProperty('path');
  });

  it('copies risk_factors rather than aliasing the node array', () => {
    const n = richNode();
    const out = projectNode(n, 'summary') as { risk_factors: string[] };
    out.risk_factors.push('mutated');
    expect(n.risk_factors).toHaveLength(2);
  });
});

// ─── skeleton ─────────────────────────────────────────────────────────

describe("projectNode — 'skeleton'", () => {
  it('returns the exact documented shape', () => {
    expect(projectNode(richNode(), 'skeleton')).toEqual({
      id: 'src/auth/session.ts',
      type: 'file',
      label: 'session.ts',
      path: 'src/auth/session.ts',
      summary: 'Creates, validates and revokes user sessions backed by Redis.',
      risk_score: 0.82,
      risk_factors: ['high_coupling', 'previously_reverted'],
      structural_warnings: [
        { category: 'god_node', severity: 'high' },
        { category: 'unclear_coupling', severity: 'medium' },
      ],
      behavioral: { revisions: 41, bug_fixes: 9, bus_factor: 1, hotspot_score: 0.77 },
      symbols: ['createSession', 'validateSession', 'revokeSession'],
    });
  });

  it('keeps warning category and severity but not the prose', () => {
    const out = projectNode(richNode(), 'skeleton') as {
      structural_warnings: Array<Record<string, unknown>>;
    };
    for (const warning of out.structural_warnings) {
      expect(Object.keys(warning).sort()).toEqual(['category', 'severity']);
    }
  });

  it('reduces metadata.behavioral to the four decision-changing counters', () => {
    const out = projectNode(richNode(), 'skeleton') as { behavioral: Record<string, unknown> };
    expect(Object.keys(out.behavioral).sort()).toEqual(['bug_fixes', 'bus_factor', 'hotspot_score', 'revisions']);
  });

  it('drops everything else in metadata', () => {
    const out = projectNode(richNode(), 'skeleton') as Record<string, unknown>;
    expect(out).not.toHaveProperty('metadata');
    expect(JSON.stringify(out)).not.toContain('should not survive');
  });

  it('deduplicates symbol names and preserves first-seen order', () => {
    const out = projectNode(richNode(), 'skeleton') as { symbols: string[] };
    expect(out.symbols).toEqual(['createSession', 'validateSession', 'revokeSession']);
  });

  it('omits structural_warnings when the node has none or an empty array', () => {
    expect(projectNode(bareNode(), 'skeleton')).not.toHaveProperty('structural_warnings');
    expect(projectNode({ ...bareNode(), structural_warnings: [] }, 'skeleton')).not.toHaveProperty(
      'structural_warnings',
    );
  });

  it('omits behavioral when metadata has none', () => {
    expect(projectNode({ ...bareNode(), metadata: { other: 1 } }, 'skeleton')).not.toHaveProperty('behavioral');
  });

  it('omits behavioral when the behavioral block holds no recognised counters', () => {
    const n: SprangNode = { ...bareNode(), metadata: { behavioral: { authors: ['ada'] } } };
    expect(projectNode(n, 'skeleton')).not.toHaveProperty('behavioral');
  });

  it('ignores a non-object behavioral value instead of throwing', () => {
    const n: SprangNode = { ...bareNode(), metadata: { behavioral: 'yes' } };
    expect(() => projectNode(n, 'skeleton')).not.toThrow();
    expect(projectNode(n, 'skeleton')).not.toHaveProperty('behavioral');
  });

  it('ignores non-numeric counters', () => {
    const n: SprangNode = { ...bareNode(), metadata: { behavioral: { revisions: '41', bug_fixes: 2 } } };
    expect(projectNode(n, 'skeleton')).toHaveProperty('behavioral', { bug_fixes: 2 });
  });

  it('accepts symbols as plain strings, as {name} objects, or both', () => {
    const n: SprangNode = { ...bareNode(), metadata: { classes: [{ name: 'Session' }], symbols: ['x'] } };
    expect(projectNode(n, 'skeleton')).toHaveProperty('symbols', ['x', 'Session']);
  });

  it('omits symbols when metadata carries none', () => {
    expect(projectNode(bareNode(), 'skeleton')).not.toHaveProperty('symbols');
    expect(projectNode({ ...bareNode(), metadata: { symbols: [] } }, 'skeleton')).not.toHaveProperty('symbols');
  });

  it('handles a node with no metadata at all', () => {
    expect(projectNode(bareNode(), 'skeleton')).toEqual({
      id: 'concept:auth',
      type: 'concept',
      label: 'Authentication',
    });
  });
});

// ─── full ─────────────────────────────────────────────────────────────

describe("projectNode — 'full'", () => {
  it('returns the node unchanged', () => {
    const n = richNode();
    expect(projectNode(n, 'full')).toEqual(richNode());
    expect(projectNode(n, 'full')).toBe(n);
  });

  it('does not mutate the node at any level', () => {
    const n = richNode();
    for (const level of DETAIL_LEVELS) projectNode(n, level);
    expect(n).toEqual(richNode());
  });
});

// ─── projectNodes ─────────────────────────────────────────────────────

describe('projectNodes', () => {
  it('preserves order', () => {
    const nodes = [bareNode(), richNode()];
    expect(projectNodes(nodes, 'ids')).toEqual([{ id: 'concept:auth' }, { id: 'src/auth/session.ts' }]);
  });

  it('returns an empty array for empty input', () => {
    for (const level of DETAIL_LEVELS) expect(projectNodes([], level)).toEqual([]);
  });

  it('is deterministic', () => {
    const nodes = [richNode(), bareNode()];
    expect(projectNodes(nodes, 'skeleton')).toEqual(projectNodes(nodes, 'skeleton'));
    expect(JSON.stringify(projectNodes(nodes, 'summary'))).toBe(JSON.stringify(projectNodes(nodes, 'summary')));
  });
});

// ─── defaults ─────────────────────────────────────────────────────────

describe('detail level constants', () => {
  it("defaults to 'summary'", () => {
    expect(DEFAULT_DETAIL).toBe('summary');
  });

  it('lists the levels cheapest first', () => {
    expect(DETAIL_LEVELS).toEqual(['ids', 'summary', 'skeleton', 'full']);
  });
});

// ─── estimateSavings ──────────────────────────────────────────────────

describe('estimateSavings', () => {
  const nodes = [richNode(), richNode(), bareNode()];

  it('reports the full size as the serialised node array', () => {
    expect(estimateSavings(nodes, 'ids').fullChars).toBe(JSON.stringify(nodes).length);
  });

  it("reports ratio 1 and equal sizes at 'full'", () => {
    const savings = estimateSavings(nodes, 'full');
    expect(savings.ratio).toBe(1);
    expect(savings.projectedChars).toBe(savings.fullChars);
  });

  it('shrinks monotonically from full through skeleton and summary to ids', () => {
    const ratios = DETAIL_LEVELS.map((level) => estimateSavings(nodes, level).ratio);
    // DETAIL_LEVELS is cheapest-first, so ratios must be non-decreasing
    for (let i = 1; i < ratios.length; i += 1) {
      expect(ratios[i] as number).toBeGreaterThanOrEqual(ratios[i - 1] as number);
    }
    // and on realistic nodes each step is a strict improvement
    const [ids, summary, skeleton, full] = ratios as [number, number, number, number];
    expect(ids).toBeLessThan(summary);
    expect(summary).toBeLessThan(skeleton);
    expect(skeleton).toBeLessThan(full);
  });

  it('saves the overwhelming majority of characters at ids', () => {
    expect(estimateSavings(nodes, 'ids').ratio).toBeLessThan(0.1);
  });

  it('never returns NaN for an empty array', () => {
    for (const level of DETAIL_LEVELS) {
      const savings = estimateSavings([], level);
      expect(Number.isNaN(savings.ratio)).toBe(false);
      expect(savings.ratio).toBe(1);
    }
  });

  it('handles a single bare node without going negative', () => {
    const savings = estimateSavings([bareNode()], 'summary');
    expect(savings.projectedChars).toBeGreaterThan(0);
    expect(savings.ratio).toBeGreaterThan(0);
    expect(savings.ratio).toBeLessThanOrEqual(1);
  });

  it('is deterministic', () => {
    const level: DetailLevel = 'skeleton';
    expect(estimateSavings(nodes, level)).toEqual(estimateSavings(nodes, level));
  });
});
