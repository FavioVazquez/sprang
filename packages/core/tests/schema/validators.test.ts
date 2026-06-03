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
