/**
 * Regression tests for the v0.3.0 graph-correctness fixes.
 *
 * A real `/sprang-analyze` run produced a graph the MCP server refused to load,
 * because the analyze template told the agent to emit `"layer": null` on nodes
 * and a `tests` edge — neither of which validates. The templates were fixed, but
 * an LLM following a long multi-phase procedure will always drift, so both
 * assemblers normalise defensively. These tests pin that behaviour.
 */

import { describe, it, expect } from 'vitest';
import { normalizeEdge, normalizeEdges, normalizeAssembledGraph } from '../../src/graph/normalize-assembled.js';
import { knowledgeGraphSchema } from '../../src/schema/validators.js';
import { EDGE_TYPES } from '../../src/schema/types.js';

describe('normalizeEdge', () => {
  it('passes canonical edge types through untouched', () => {
    expect(normalizeEdge({ source: 'a', target: 'b', type: 'imports' }))
      .toEqual({ source: 'a', target: 'b', type: 'imports' });
  });

  it('maps `tests` to `tested_by` AND swaps source/target', () => {
    // The agent writes test-file → source-file; the canonical edge points the
    // other way. Mapping the name without swapping would invert every test edge.
    expect(normalizeEdge({ source: 'file:t/a.test.ts', target: 'file:src/a.ts', type: 'tests' }))
      .toEqual({ source: 'file:src/a.ts', target: 'file:t/a.test.ts', type: 'tested_by' });
  });

  it.each([
    ['dependsOn', 'depends_on'],
    ['depends-on', 'depends_on'],
    ['Depends On', 'depends_on'],
    ['references', 'related'],
    ['relatedTo', 'related'],
    ['builds', 'builds_on'],
    ['extends', 'inherits'],
    ['invokes', 'calls'],
    ['reads', 'reads_from'],
    ['definesSchema', 'defines_schema'],
  ])('maps drifted alias %s → %s', (alias, canonical) => {
    expect(normalizeEdge({ source: 'a', target: 'b', type: alias })?.['type']).toBe(canonical);
  });

  it.each([
    ['importedBy', 'imports'],
    ['calledBy', 'calls'],
    ['partOf', 'contains'],
    ['documentedBy', 'documents'],
    ['triggeredBy', 'triggers'],
  ])('swaps direction for the reversed alias %s → %s', (alias, canonical) => {
    const out = normalizeEdge({ source: 'a', target: 'b', type: alias });
    expect(out).toEqual({ source: 'b', target: 'a', type: canonical });
  });

  it('recovers a canonical type written without separators', () => {
    expect(normalizeEdge({ source: 'a', target: 'b', type: 'crossdomain' })?.['type']).toBe('cross_domain');
  });

  it('accepts from/to as aliases for source/target', () => {
    expect(normalizeEdge({ from: 'a', to: 'b', type: 'calls' }))
      .toEqual({ source: 'a', target: 'b', type: 'calls' });
  });

  it('drops edges that cannot be mapped rather than failing the whole graph', () => {
    expect(normalizeEdge({ source: 'a', target: 'b', type: 'vibes' })).toBeNull();
    expect(normalizeEdge({ source: 'a', target: 'b' })).toBeNull();
    expect(normalizeEdge({ source: 'a', type: 'calls' })).toBeNull();
    expect(normalizeEdge('nonsense')).toBeNull();
  });

  it('keeps optional fields and discards unknown ones', () => {
    const out = normalizeEdge({
      source: 'a', target: 'b', type: 'calls',
      direction: 'bidirectional', description: 'why', weight: 0.5,
      metadata: { k: 1 }, bogus: 'drop me',
    });
    expect(out).toEqual({
      source: 'a', target: 'b', type: 'calls',
      direction: 'bidirectional', description: 'why', weight: 0.5, metadata: { k: 1 },
    });
  });

  it('every canonical edge type survives a round trip', () => {
    for (const type of EDGE_TYPES) {
      expect(normalizeEdge({ source: 'a', target: 'b', type })?.['type'], type).toBe(type);
    }
  });
});

describe('normalizeEdges', () => {
  it('deduplicates by source+target+type', () => {
    const { edges } = normalizeEdges([
      { source: 'a', target: 'b', type: 'imports' },
      { source: 'a', target: 'b', type: 'imports' },
      { source: 'a', target: 'b', type: 'calls' },
    ]);
    expect(edges).toHaveLength(2);
  });

  it('dedupes across an alias and its canonical form', () => {
    const { edges } = normalizeEdges([
      { source: 'a', target: 'b', type: 'depends_on' },
      { source: 'a', target: 'b', type: 'dependsOn' },
    ]);
    expect(edges).toHaveLength(1);
  });

  it('reports what it dropped, with counts', () => {
    const { edges, dropped } = normalizeEdges([
      { source: 'a', target: 'b', type: 'vibes' },
      { source: 'c', target: 'd', type: 'vibes' },
      { source: 'e', target: 'f', type: 'imports' },
      { source: 'g', target: 'h' },
    ]);
    expect(edges).toHaveLength(1);
    expect(dropped).toEqual({ vibes: 2, '(missing type)': 1 });
  });
});

describe('normalizeAssembledGraph null-field stripping', () => {
  it('strips `layer: null` so the node validates', () => {
    // knowledgeGraphSchema declares `layer: z.string().optional()`; null is not
    // absent, so this exact template produced an unloadable graph in production.
    const { nodes } = normalizeAssembledGraph({
      nodes: [{ id: 'file:a.ts', type: 'file', label: 'a.ts', layer: null }],
      layers: [], tours: [], domains: [],
    });
    expect('layer' in nodes[0]!).toBe(false);
  });

  it('strips every null field, not just layer', () => {
    const { nodes } = normalizeAssembledGraph({
      nodes: [{ id: 'file:a.ts', type: 'file', label: 'a.ts', layer: null, summary: null, filePath: 'a.ts' }],
      layers: [], tours: [], domains: [],
    });
    expect(Object.values(nodes[0]!)).not.toContain(null);
    expect(nodes[0]!['filePath']).toBe('a.ts');
  });

  it('produces a schema-valid graph from the exact drifted output seen in production', () => {
    const norm = normalizeAssembledGraph({
      nodes: [
        { id: 'file:src/a.ts', type: 'file', name: 'a.ts', label: 'a.ts', layer: null },
        { id: 'function:src/a.ts:go', type: 'function', name: 'go', label: 'go', layer: null },
      ],
      edges: [
        { source: 'file:t/a.test.ts', target: 'file:src/a.ts', type: 'tests' },
        { source: 'file:src/a.ts', target: 'file:src/b.ts', type: 'dependsOn' },
        { source: 'file:src/a.ts', target: 'file:src/c.ts', type: 'references' },
      ],
      layers: [], tours: [], domains: [],
    });

    const graph = {
      version: '0.2.0', kind: 'codebase', generated_at: new Date().toISOString(),
      project_root: '/tmp/x', project_name: 'x', description: '',
      languages: [], frameworks: [], phase: 'complete',
      stats: {
        node_count: norm.nodes.length, edge_count: norm.edges.length,
        risk_summary: norm.risk_summary, smell_summary: norm.smell_summary,
        generated_at: new Date().toISOString(), gitCommitHash: '',
      },
      nodes: norm.nodes, edges: norm.edges, layers: norm.layers,
      tours: norm.tours, domains: norm.domains, annotations: [], health: {},
    };

    const result = knowledgeGraphSchema.safeParse(graph);
    expect(result.success, JSON.stringify(result.success ? [] : result.error.issues.slice(0, 3))).toBe(true);
    expect(norm.edges.map((e) => e['type'])).toEqual(['tested_by', 'depends_on', 'related']);
  });
});
