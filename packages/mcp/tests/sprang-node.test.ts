import { describe, it, expect } from 'vitest';
import { GraphLoader } from '../src/graph-loader.js';
import { sprangNode } from '../src/tools/sprang_node.js';
import { sprangAnnotate } from '../src/tools/sprang_annotate.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdir, writeFile, readFile } from 'node:fs/promises';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function makeTestDir(): Promise<string> {
  const dir = join(tmpdir(), `sprang-node-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(join(dir, '.sprang'), { recursive: true });
  return dir;
}

function makeGraph(overrides: Record<string, unknown> = {}) {
  return {
    version: '1.0.0',
    generated_at: new Date().toISOString(),
    project_root: '/test',
    project_name: 'test',
    phase: 'complete',
    nodes: [
      { id: 'file:src/auth.ts', type: 'file', label: 'auth.ts', summary: 'Auth logic', tags: ['auth'] },
      { id: 'file:src/index.ts', type: 'file', label: 'index.ts', summary: 'Entry point', tags: [] },
      { id: 'file:src/utils.ts', type: 'file', label: 'utils.ts', summary: 'Utilities', tags: [] },
    ],
    edges: [
      { source: 'file:src/index.ts', target: 'file:src/auth.ts', type: 'imports' },
      { source: 'file:src/index.ts', target: 'file:src/utils.ts', type: 'imports' },
      { source: 'file:src/auth.ts', target: 'file:src/utils.ts', type: 'imports' },
    ],
    layers: [
      { id: 'layer:core', name: 'Core', node_ids: ['file:src/auth.ts', 'file:src/utils.ts'] },
      { id: 'layer:entry', name: 'Entry', node_ids: ['file:src/index.ts'] },
    ],
    tours: [],
    domains: [],
    stats: {
      node_count: 3,
      edge_count: 3,
      risk_summary: { high: 0, medium: 0, low: 3 },
      smell_summary: {},
      generated_at: new Date().toISOString(),
    },
    ...overrides,
  };
}

// ─── sprang_node tests ────────────────────────────────────────────────────────

describe('sprang_node enrichment', () => {
  it('returns error for missing graph', async () => {
    const loader = new GraphLoader('/nonexistent/path');
    const result = await sprangNode(loader, { node_id: 'file:src/auth.ts' });
    expect(result).toMatchObject({ error: 'Knowledge graph not found' });
  });

  it('returns error for unknown node', async () => {
    const dir = await makeTestDir();
    await writeFile(join(dir, '.sprang', 'knowledge-graph.json'), JSON.stringify(makeGraph()), 'utf-8');
    const loader = new GraphLoader(dir);
    const result = await sprangNode(loader, { node_id: 'file:nonexistent.ts' });
    expect(result).toMatchObject({ error: 'Node not found' });
  });

  it('returns node with in/out degree', async () => {
    const dir = await makeTestDir();
    await writeFile(join(dir, '.sprang', 'knowledge-graph.json'), JSON.stringify(makeGraph()), 'utf-8');
    const loader = new GraphLoader(dir);

    const result = await sprangNode(loader, { node_id: 'file:src/auth.ts' });
    expect('error' in result).toBe(false);
    const r = result as Awaited<ReturnType<typeof sprangNode>> & { in_degree: number; out_degree: number };
    expect(r.in_degree).toBe(1);   // index.ts → auth.ts
    expect(r.out_degree).toBe(1);  // auth.ts → utils.ts
  });

  it('returns correct neighbors', async () => {
    const dir = await makeTestDir();
    await writeFile(join(dir, '.sprang', 'knowledge-graph.json'), JSON.stringify(makeGraph()), 'utf-8');
    const loader = new GraphLoader(dir);

    const result = await sprangNode(loader, { node_id: 'file:src/index.ts' });
    const r = result as { neighbors: Array<{ node_id: string; direction: string }> };
    const outgoing = r.neighbors.filter((n) => n.direction === 'outgoing');
    expect(outgoing).toHaveLength(2);
    expect(outgoing.map((n) => n.node_id).sort()).toEqual([
      'file:src/auth.ts',
      'file:src/utils.ts',
    ].sort());
  });

  it('resolves layer membership', async () => {
    const dir = await makeTestDir();
    await writeFile(join(dir, '.sprang', 'knowledge-graph.json'), JSON.stringify(makeGraph()), 'utf-8');
    const loader = new GraphLoader(dir);

    const result = await sprangNode(loader, { node_id: 'file:src/auth.ts' });
    const r = result as { layer?: { id: string; name: string }; layer_mate_count?: number };
    expect(r.layer).toEqual({ id: 'layer:core', name: 'Core' });
    expect(r.layer_mate_count).toBe(1); // utils.ts is the other member
  });

  it('reports has_annotation: false when no annotation exists', async () => {
    const dir = await makeTestDir();
    await writeFile(join(dir, '.sprang', 'knowledge-graph.json'), JSON.stringify(makeGraph()), 'utf-8');
    const loader = new GraphLoader(dir);

    const result = await sprangNode(loader, { node_id: 'file:src/auth.ts' });
    const r = result as { has_annotation: boolean; annotation_path?: string };
    expect(r.has_annotation).toBe(false);
    expect(r.annotation_path).toBeUndefined();
  });

  it('reports has_annotation: true after annotation is written', async () => {
    const dir = await makeTestDir();
    await writeFile(join(dir, '.sprang', 'knowledge-graph.json'), JSON.stringify(makeGraph()), 'utf-8');
    const loader = new GraphLoader(dir);

    // Write annotation via sprangAnnotate
    await sprangAnnotate(loader, {
      node_id: 'file:src/auth.ts',
      content: 'Core auth module — handles JWT and session tokens.',
      tags: ['security', 'auth'],
    }, dir);

    const result = await sprangNode(loader, { node_id: 'file:src/auth.ts' });
    const r = result as { has_annotation: boolean; annotation_path?: string };
    expect(r.has_annotation).toBe(true);
    expect(r.annotation_path).toMatch(/\.sprang\/annotations\//);
  });
});

// ─── sprang_annotate tests ────────────────────────────────────────────────────

describe('sprang_annotate', () => {
  it('returns error for unknown node', async () => {
    const dir = await makeTestDir();
    await writeFile(join(dir, '.sprang', 'knowledge-graph.json'), JSON.stringify(makeGraph()), 'utf-8');
    const loader = new GraphLoader(dir);

    const result = await sprangAnnotate(loader, { node_id: 'file:nonexistent.ts', content: 'test' }, dir);
    expect(result).toMatchObject({ error: 'Node not found' });
  });

  it('writes annotation file with frontmatter', async () => {
    const dir = await makeTestDir();
    await writeFile(join(dir, '.sprang', 'knowledge-graph.json'), JSON.stringify(makeGraph()), 'utf-8');
    const loader = new GraphLoader(dir);

    const result = await sprangAnnotate(loader, {
      node_id: 'file:src/utils.ts',
      content: 'Shared utility helpers.',
      tags: ['utility'],
    }, dir);

    expect(result).toMatchObject({ success: true, node_id: 'file:src/utils.ts' });

    const r = result as { path: string };
    const filePath = join(dir, r.path);
    const content = await readFile(filePath, 'utf-8');
    expect(content).toContain('node_id: "file:src/utils.ts"');
    expect(content).toContain('node_label: "utils.ts"');
    expect(content).toContain('annotated_at:');
    expect(content).toContain('["utility"]');
    expect(content).toContain('Shared utility helpers.');
  });

  it('overwrites an existing annotation', async () => {
    const dir = await makeTestDir();
    await writeFile(join(dir, '.sprang', 'knowledge-graph.json'), JSON.stringify(makeGraph()), 'utf-8');
    const loader = new GraphLoader(dir);

    await sprangAnnotate(loader, { node_id: 'file:src/utils.ts', content: 'First version.' }, dir);
    await sprangAnnotate(loader, { node_id: 'file:src/utils.ts', content: 'Updated version.' }, dir);

    const r1 = await sprangAnnotate(loader, { node_id: 'file:src/utils.ts', content: 'Final version.' }, dir) as { path: string };
    const content = await readFile(join(dir, r1.path), 'utf-8');
    expect(content).toContain('Final version.');
    expect(content).not.toContain('First version.');
  });

  it('writes annotation without tags', async () => {
    const dir = await makeTestDir();
    await writeFile(join(dir, '.sprang', 'knowledge-graph.json'), JSON.stringify(makeGraph()), 'utf-8');
    const loader = new GraphLoader(dir);

    const result = await sprangAnnotate(loader, { node_id: 'file:src/index.ts', content: 'No tags here.' }, dir);
    expect(result).toMatchObject({ success: true });
    const r = result as { path: string };
    const content = await readFile(join(dir, r.path), 'utf-8');
    expect(content).toContain('tags: []');
  });
});
