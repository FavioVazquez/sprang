import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  sprangNodeSchema,
  sprangEdgeSchema,
  knowledgeGraphSchema,
} from '../../src/schema/validators.js';

describe('sprangNodeSchema', () => {
  it('passes for a minimal valid node', () => {
    const node = {
      id: 'file:src/index.ts',
      type: 'file',
      label: 'index.ts',
    };
    expect(() => sprangNodeSchema.parse(node)).not.toThrow();
  });

  it('throws ZodError when id is missing', () => {
    const node = {
      type: 'file',
      label: 'index.ts',
    };
    expect(() => sprangNodeSchema.parse(node)).toThrow(z.ZodError);
  });

  it('throws ZodError for an unknown node type', () => {
    const node = {
      id: 'x:y',
      type: 'unknown_type',
      label: 'foo',
    };
    expect(() => sprangNodeSchema.parse(node)).toThrow(z.ZodError);
  });

  it('accepts optional fields', () => {
    const node = {
      id: 'function:src/utils.ts:greet',
      type: 'function',
      label: 'greet',
      complexity: 'simple',
      location: { file: 'src/utils.ts', start_line: 1, end_line: 5 },
      tags: ['utility'],
    };
    const parsed = sprangNodeSchema.parse(node);
    expect(parsed.complexity).toBe('simple');
    expect(parsed.tags).toEqual(['utility']);
  });
});

describe('sprangNodeSchema — new M1 fields', () => {
  it('accepts knowledge node types', () => {
    for (const type of ['article', 'entity', 'topic', 'claim', 'source'] as const) {
      const node = { id: `${type}:1`, type, label: type };
      expect(() => sprangNodeSchema.parse(node)).not.toThrow();
    }
  });

  it('accepts languageNotes, filePath, lineRange, annotations', () => {
    const node = {
      id: 'file:src/app.ts',
      type: 'file',
      label: 'app.ts',
      name: 'app.ts',
      filePath: 'src/app.ts',
      lineRange: [1, 200] as [number, number],
      languageNotes: 'Uses module augmentation pattern.',
      summary: 'Entry point for the application.',
      tags: ['entry-point', 'bootstrap'],
      annotations: ['Good example of DI pattern.'],
    };
    const parsed = sprangNodeSchema.parse(node);
    expect(parsed.languageNotes).toBe('Uses module augmentation pattern.');
    expect(parsed.filePath).toBe('src/app.ts');
    expect(parsed.lineRange).toEqual([1, 200]);
    expect(parsed.annotations).toEqual(['Good example of DI pattern.']);
    expect(parsed.tags).toEqual(['entry-point', 'bootstrap']);
  });

  it('backward compat: name is optional', () => {
    const node = { id: 'file:src/x.ts', type: 'file', label: 'x.ts' };
    expect(() => sprangNodeSchema.parse(node)).not.toThrow();
  });
});

describe('sprangEdgeSchema', () => {
  it('passes for a valid edge', () => {
    const edge = {
      source: 'file:src/index.ts',
      target: 'file:src/utils.ts',
      type: 'imports',
    };
    expect(() => sprangEdgeSchema.parse(edge)).not.toThrow();
  });

  it('throws ZodError for an unknown edge type', () => {
    const edge = {
      source: 'file:src/index.ts',
      target: 'file:src/utils.ts',
      type: 'unknown_edge_type',
    };
    expect(() => sprangEdgeSchema.parse(edge)).toThrow(z.ZodError);
  });

  it('old "tests" edge type is now invalid (renamed to tested_by)', () => {
    const edge = { source: 'a', target: 'b', type: 'tests' };
    expect(() => sprangEdgeSchema.parse(edge)).toThrow(z.ZodError);
  });

  it('accepts tested_by edge type', () => {
    const edge = { source: 'a', target: 'b', type: 'tested_by' };
    expect(() => sprangEdgeSchema.parse(edge)).not.toThrow();
  });

  it('accepts knowledge edge types', () => {
    for (const type of ['cites', 'contradicts', 'builds_on', 'exemplifies', 'categorized_under', 'authored_by'] as const) {
      const edge = { source: 'a', target: 'b', type };
      expect(() => sprangEdgeSchema.parse(edge)).not.toThrow();
    }
  });

  it('accepts direction and description fields', () => {
    const edge = {
      source: 'a', target: 'b', type: 'related',
      direction: 'bidirectional', description: 'semantically related',
    };
    const parsed = sprangEdgeSchema.parse(edge);
    expect(parsed.direction).toBe('bidirectional');
    expect(parsed.description).toBe('semantically related');
  });

  it('accepts optional weight and metadata', () => {
    const edge = {
      source: 'file:src/a.ts',
      target: 'file:src/b.ts',
      type: 'depends_on',
      weight: 0.8,
      metadata: { reason: 'test' },
    };
    const parsed = sprangEdgeSchema.parse(edge);
    expect(parsed.weight).toBe(0.8);
  });
});

describe('knowledgeGraphSchema', () => {
  it('passes for a full graph with 2 nodes and 1 edge', () => {
    const now = new Date().toISOString();
    const graph = {
      version: '1.0.0',
      generated_at: now,
      project_root: '/tmp/test-project',
      project_name: 'test-project',
      phase: 'skeleton',
      nodes: [
        { id: 'file:src/a.ts', type: 'file', label: 'a.ts' },
        { id: 'file:src/b.ts', type: 'file', label: 'b.ts' },
      ],
      edges: [
        {
          source: 'file:src/a.ts',
          target: 'file:src/b.ts',
          type: 'imports',
        },
      ],
      layers: [],
      tours: [],
      domains: [],
      stats: {
        node_count: 2,
        edge_count: 1,
        risk_summary: { high: 0, medium: 0, low: 0 },
        smell_summary: {},
        generated_at: now,
      },
    };

    const result = knowledgeGraphSchema.safeParse(graph);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.nodes).toHaveLength(2);
      expect(result.data.edges).toHaveLength(1);
    }
  });

  it('accepts TourStep with node_ids instead of node_id', () => {
    const now = new Date().toISOString();
    const graph = {
      version: '1.0.0', generated_at: now,
      project_root: '/tmp/p', project_name: 'p',
      phase: 'complete',
      nodes: [
        { id: 'file:a.ts', type: 'file', label: 'a.ts' },
        { id: 'file:b.ts', type: 'file', label: 'b.ts' },
      ],
      edges: [],
      layers: [],
      tours: [{
        id: 'tour:1', title: 'Tour', description: 'Test tour',
        steps: [
          { node_ids: ['file:a.ts', 'file:b.ts'], step_title: 'Step 1', explanation: 'Explanation' },
        ],
      }],
      domains: [],
      stats: { node_count: 2, edge_count: 0, risk_summary: { high: 0, medium: 0, low: 0 }, smell_summary: {}, generated_at: now, gitCommitHash: 'abc1234' },
    };
    const result = knowledgeGraphSchema.safeParse(graph);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.stats.gitCommitHash).toBe('abc1234');
      expect(result.data.tours[0]?.steps[0]?.node_ids).toEqual(['file:a.ts', 'file:b.ts']);
    }
  });

  // Regression for v0.2.3: the MCP GraphLoader runs safeParse, and Zod strips
  // undeclared keys. Before the fix the schema omitted security_summary /
  // security_warnings, so all security data was silently dropped on load
  // (sprang_health reported 0 findings and the grade lost its security penalty).
  it('preserves stats.security_summary through safeParse (does not strip it)', () => {
    const now = new Date().toISOString();
    const graph = {
      version: '1.0.0', generated_at: now,
      project_root: '/p', project_name: 'p', phase: 'complete',
      nodes: [{ id: 'file:config.ts', type: 'file', label: 'config.ts' }],
      edges: [], layers: [], tours: [], domains: [],
      stats: {
        node_count: 1, edge_count: 0,
        risk_summary: { high: 0, medium: 0, low: 1 },
        smell_summary: {},
        security_summary: {
          total: 4,
          by_severity: { high: 3, medium: 0, low: 1 },
          by_category: { hardcoded_secret: 2, weak_crypto: 1, unsafe_eval: 1 },
        },
        generated_at: now,
      },
    };
    const result = knowledgeGraphSchema.safeParse(graph);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.stats.security_summary).toBeDefined();
      expect(result.data.stats.security_summary?.total).toBe(4);
      expect(result.data.stats.security_summary?.by_severity.high).toBe(3);
      expect(result.data.stats.security_summary?.by_category['hardcoded_secret']).toBe(2);
    }
  });

  it('preserves node.security_warnings through safeParse (does not strip them)', () => {
    const node = {
      id: 'file:src/data/config.ts',
      type: 'file',
      label: 'config.ts',
      security_warnings: [
        {
          category: 'hardcoded_secret',
          severity: 'high',
          description: 'Hardcoded credential detected',
          line: 2,
          pattern: 'password\\s*=',
          snippet: 'const DB_PASSWORD = "..."',
        },
      ],
    };
    const result = sprangNodeSchema.safeParse(node);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.security_warnings).toHaveLength(1);
      expect(result.data.security_warnings?.[0]?.category).toBe('hardcoded_secret');
      expect(result.data.security_warnings?.[0]?.severity).toBe('high');
    }
  });

  it('accepts kind: codebase', () => {
    const now = new Date().toISOString();
    const graph = {
      version: '1.0.0', kind: 'codebase', generated_at: now,
      project_root: '/p', project_name: 'p', phase: 'complete',
      nodes: [], edges: [], layers: [], tours: [], domains: [],
      stats: { node_count: 0, edge_count: 0, risk_summary: { high: 0, medium: 0, low: 0 }, smell_summary: {}, generated_at: now },
    };
    const result = knowledgeGraphSchema.safeParse(graph);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.kind).toBe('codebase');
  });

  it('accepts kind: knowledge', () => {
    const now = new Date().toISOString();
    const graph = {
      version: '1.0.0', kind: 'knowledge', generated_at: now,
      project_root: '/notes', project_name: 'my-notes', phase: 'complete',
      nodes: [{ id: 'article:readme', type: 'article', label: 'README' }],
      edges: [], layers: [], tours: [], domains: [],
      stats: { node_count: 1, edge_count: 0, risk_summary: { high: 0, medium: 0, low: 0 }, smell_summary: {}, generated_at: now },
    };
    const result = knowledgeGraphSchema.safeParse(graph);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.kind).toBe('knowledge');
  });

  it('accepts omitted kind (backward compat)', () => {
    const now = new Date().toISOString();
    const graph = {
      version: '1.0.0', generated_at: now,
      project_root: '/p', project_name: 'p', phase: 'skeleton',
      nodes: [], edges: [], layers: [], tours: [], domains: [],
      stats: { node_count: 0, edge_count: 0, risk_summary: { high: 0, medium: 0, low: 0 }, smell_summary: {}, generated_at: now },
    };
    const result = knowledgeGraphSchema.safeParse(graph);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.kind).toBeUndefined();
  });

  it('rejects invalid kind value', () => {
    const now = new Date().toISOString();
    const graph = {
      version: '1.0.0', kind: 'notes', generated_at: now,
      project_root: '/p', project_name: 'p', phase: 'complete',
      nodes: [], edges: [], layers: [], tours: [], domains: [],
      stats: { node_count: 0, edge_count: 0, risk_summary: { high: 0, medium: 0, low: 0 }, smell_summary: {}, generated_at: now },
    };
    const result = knowledgeGraphSchema.safeParse(graph);
    expect(result.success).toBe(false);
  });

  it('fails when phase is invalid', () => {
    const now = new Date().toISOString();
    const graph = {
      version: '1.0.0',
      generated_at: now,
      project_root: '/tmp/test-project',
      project_name: 'test-project',
      phase: 'invalid_phase',
      nodes: [],
      edges: [],
      layers: [],
      tours: [],
      domains: [],
      stats: {
        node_count: 0,
        edge_count: 0,
        risk_summary: { high: 0, medium: 0, low: 0 },
        smell_summary: {},
        generated_at: now,
      },
    };
    const result = knowledgeGraphSchema.safeParse(graph);
    expect(result.success).toBe(false);
  });
});
