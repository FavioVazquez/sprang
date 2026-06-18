import { describe, it, expect } from 'vitest';
import { GraphLoader, summarizeZodIssues } from '../src/graph-loader.js';
import { knowledgeGraphSchema } from '@sprang/core';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';

describe('GraphLoader', () => {
  it('returns null when no graph file exists', async () => {
    const loader = new GraphLoader('/nonexistent/path');
    const graph = await loader.getGraph();
    expect(graph).toBeNull();
  });

  it('loads a graph from disk', async () => {
    const dir = join(tmpdir(), `sprang-mcp-test-${Date.now()}`);
    const sprangDir = join(dir, '.sprang');
    await mkdir(sprangDir, { recursive: true });

    const graph = {
      version: '1.0.0',
      generated_at: new Date().toISOString(),
      project_root: dir,
      project_name: 'test',
      phase: 'skeleton',
      nodes: [{ id: 'file:src/index.ts', type: 'file', label: 'index.ts' }],
      edges: [],
      layers: [],
      tours: [],
      domains: [],
      stats: {
        node_count: 1,
        edge_count: 0,
        risk_summary: { high: 0, medium: 0, low: 0 },
        smell_summary: {},
        generated_at: new Date().toISOString(),
      },
    };

    await writeFile(join(sprangDir, 'knowledge-graph.json'), JSON.stringify(graph), 'utf-8');

    const loader = new GraphLoader(dir);
    const loaded = await loader.getGraph();
    expect(loaded).not.toBeNull();
    expect(loaded?.project_name).toBe('test');
    expect(loaded?.nodes).toHaveLength(1);
  });

  it('hot-reloads when mtime changes', async () => {
    const dir = join(tmpdir(), `sprang-mcp-reload-${Date.now()}`);
    const sprangDir = join(dir, '.sprang');
    await mkdir(sprangDir, { recursive: true });

    const makeGraph = (name: string) => ({
      version: '1.0.0',
      generated_at: new Date().toISOString(),
      project_root: dir,
      project_name: name,
      phase: 'skeleton',
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
        generated_at: new Date().toISOString(),
      },
    });

    const filePath = join(sprangDir, 'knowledge-graph.json');
    await writeFile(filePath, JSON.stringify(makeGraph('first')), 'utf-8');

    const loader = new GraphLoader(dir);
    const first = await loader.getGraph();
    expect(first?.project_name).toBe('first');

    // Wait 10ms so mtime changes
    await new Promise(r => setTimeout(r, 10));
    await writeFile(filePath, JSON.stringify(makeGraph('second')), 'utf-8');

    const second = await loader.getGraph();
    expect(second?.project_name).toBe('second');
  });

  it('returns null on a schema-invalid graph (does not throw)', async () => {
    const dir = join(tmpdir(), `sprang-mcp-invalid-${Date.now()}`);
    const sprangDir = join(dir, '.sprang');
    await mkdir(sprangDir, { recursive: true });
    // Domain missing `label` and tours missing required step fields — the exact
    // class of drift that produced GRAPH_NOT_FOUND before the v0.2.4 merge fix.
    const invalid = {
      version: '1.0.0', generated_at: new Date().toISOString(), project_root: dir,
      project_name: 'bad', phase: 'complete', nodes: [], edges: [], layers: [],
      tours: [], domains: [{ id: 'd', flows: [] }],
      stats: { node_count: 0, edge_count: 0, risk_summary: { high: 0, medium: 0, low: 0 }, smell_summary: {}, generated_at: new Date().toISOString() },
    };
    await writeFile(join(sprangDir, 'knowledge-graph.json'), JSON.stringify(invalid), 'utf-8');
    const loader = new GraphLoader(dir);
    await expect(loader.getGraph()).resolves.toBeNull();
  });
});

describe('summarizeZodIssues', () => {
  it('collapses many array-index issues into a concise count', () => {
    const bad = {
      version: '1', generated_at: 'x', project_root: '/x', project_name: 'p', phase: 'complete',
      nodes: [], edges: [], layers: [], tours: [],
      // three malformed domains → repeated `domains.[].label` Required issues
      domains: [{ id: 'a', flows: [] }, { id: 'b', flows: [] }, { id: 'c', flows: [] }],
      stats: { node_count: 0, edge_count: 0, risk_summary: { high: 0, medium: 0, low: 0 }, smell_summary: {}, generated_at: 'x' },
    };
    const res = knowledgeGraphSchema.safeParse(bad);
    expect(res.success).toBe(false);
    if (res.success) return;
    const summary = summarizeZodIssues(res.error);
    expect(summary).toMatch(/issue\(s\)/);
    expect(summary).toContain('domains.[].label');
    // the three identical issues collapse to a single "(×3)" group
    expect(summary).toMatch(/×3/);
  });
});
