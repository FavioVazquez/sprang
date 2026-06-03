import { describe, it, expect } from 'vitest';
import { GraphLoader } from '../src/graph-loader.js';
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
});
