import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const CLI = join(import.meta.dirname, '../../dist/index.js');

function runMerge(args: string[]): { stdout: string; stderr: string; status: number } {
  const result = spawnSync('node', [CLI, 'merge', ...args], { encoding: 'utf-8' });
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status ?? 1,
  };
}

function makeProject(overrides: {
  nodeChunks?: object[][];
  edges?: object[];
  layers?: object[];
  tours?: object[];
  assembled?: object;
  interDir?: string;
} = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'sprang-merge-test-'));
  const inter = join(root, overrides.interDir ?? 'intermediate');
  mkdirSync(inter, { recursive: true });
  mkdirSync(join(root, '.sprang'), { recursive: true });

  const chunks = overrides.nodeChunks ?? [[
    { id: 'file:src/index.ts', type: 'file', label: 'index.ts', summary: 'entry', risk_score: 0.2 },
    { id: 'fn:main', type: 'function', label: 'main', summary: 'main fn', risk_score: 0.8 },
  ]];
  chunks.forEach((chunk, i) => {
    writeFileSync(join(inter, `final-nodes-chunk-${i + 1}.json`), JSON.stringify(chunk));
  });

  if (overrides.edges !== undefined) {
    writeFileSync(join(inter, 'final-edges.json'), JSON.stringify(overrides.edges));
  }
  if (overrides.layers !== undefined) {
    writeFileSync(join(inter, 'final-layers.json'), JSON.stringify(overrides.layers));
  }
  if (overrides.tours !== undefined) {
    writeFileSync(join(inter, 'final-tours.json'), JSON.stringify(overrides.tours));
  }
  if (overrides.assembled !== undefined) {
    writeFileSync(join(inter, 'assembled-graph.json'), JSON.stringify(overrides.assembled));
  }
  return root;
}

describe('sprang merge', () => {
  let root: string;

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('writes a valid knowledge-graph.json from chunk files', () => {
    root = makeProject();
    const result = runMerge([root, '--intermediate', join(root, 'intermediate')]);
    expect(result.status).toBe(0);
    expect(result.stderr + result.stdout).toMatch(/OK:|nodes/);

    const graph = JSON.parse(readFileSync(join(root, '.sprang', 'knowledge-graph.json'), 'utf-8'));
    expect(graph.version).toBe('0.2.0');
    expect(graph.kind).toBe('codebase');
    expect(graph.phase).toBe('complete');
    expect(graph.project_name).toBe(root.split('/').pop());
    expect(graph.project_root).toBe(root);
    expect(Array.isArray(graph.nodes)).toBe(true);
    expect(graph.nodes).toHaveLength(2);
    expect(Array.isArray(graph.edges)).toBe(true);
    expect(Array.isArray(graph.layers)).toBe(true);
    expect(Array.isArray(graph.tours)).toBe(true);
    expect(typeof graph.stats).toBe('object');
    expect(graph.stats.node_count).toBe(2);
    expect(graph.stats.edge_count).toBe(0);
    expect(graph.stats.risk_summary).toEqual({ high: 1, medium: 0, low: 1 });
    expect(typeof graph.generated_at).toBe('string');
  });

  it('merges multiple node chunk files', () => {
    root = makeProject({
      nodeChunks: [
        [{ id: 'file:a.ts', type: 'file', label: 'a.ts', summary: 's', risk_score: 0.1 }],
        [{ id: 'file:b.ts', type: 'file', label: 'b.ts', summary: 's', risk_score: 0.5 }],
        [{ id: 'file:c.ts', type: 'file', label: 'c.ts', summary: 's', risk_score: 0.9 }],
      ],
    });
    const result = runMerge([root, '--intermediate', join(root, 'intermediate')]);
    expect(result.status).toBe(0);
    const graph = JSON.parse(readFileSync(join(root, '.sprang', 'knowledge-graph.json'), 'utf-8'));
    expect(graph.nodes).toHaveLength(3);
    expect(graph.stats.node_count).toBe(3);
    expect(graph.stats.risk_summary).toEqual({ high: 1, medium: 1, low: 1 });
  });

  it('normalises nodes written as a dict (common agent mistake)', () => {
    root = mkdtempSync(join(tmpdir(), 'sprang-merge-test-'));
    const inter = join(root, 'intermediate');
    mkdirSync(inter, { recursive: true });
    mkdirSync(join(root, '.sprang'), { recursive: true });
    // Agent wrote nodes as a dict keyed by id
    const nodesAsDict = {
      'file:src/a.ts': { id: 'file:src/a.ts', type: 'file', label: 'a.ts', summary: 's', risk_score: 0.1 },
      'fn:foo': { id: 'fn:foo', type: 'function', label: 'foo', summary: 'fn', risk_score: 0.6 },
    };
    writeFileSync(join(inter, 'final-nodes-chunk-1.json'), JSON.stringify(nodesAsDict));
    const result = runMerge([root, '--intermediate', inter]);
    expect(result.status).toBe(0);
    const graph = JSON.parse(readFileSync(join(root, '.sprang', 'knowledge-graph.json'), 'utf-8'));
    expect(Array.isArray(graph.nodes)).toBe(true);
    expect(graph.nodes).toHaveLength(2);
  });

  it('reads tours from final-tour.json if final-tours.json missing', () => {
    root = mkdtempSync(join(tmpdir(), 'sprang-merge-test-'));
    const inter = join(root, 'intermediate');
    mkdirSync(inter, { recursive: true });
    mkdirSync(join(root, '.sprang'), { recursive: true });
    writeFileSync(join(inter, 'final-nodes-chunk-1.json'), JSON.stringify([
      { id: 'file:a.ts', type: 'file', label: 'a.ts', summary: 's', risk_score: 0 },
    ]));
    const tours = [{ id: 'tour-1', title: 'My Tour', steps: [] }];
    writeFileSync(join(inter, 'final-tour.json'), JSON.stringify(tours));
    const result = runMerge([root, '--intermediate', inter]);
    expect(result.status).toBe(0);
    const graph = JSON.parse(readFileSync(join(root, '.sprang', 'knowledge-graph.json'), 'utf-8'));
    expect(graph.tours).toHaveLength(1);
    expect(graph.tours[0].id).toBe('tour-1');
  });

  it('uses assembled-graph.json for project metadata', () => {
    root = makeProject({
      assembled: {
        description: 'A test project',
        languages: ['typescript'],
        frameworks: ['react'],
        project_name: 'my-custom-name',
        smell_summary: { god_node: 2 },
      },
    });
    const result = runMerge([root, '--intermediate', join(root, 'intermediate')]);
    expect(result.status).toBe(0);
    const graph = JSON.parse(readFileSync(join(root, '.sprang', 'knowledge-graph.json'), 'utf-8'));
    expect(graph.description).toBe('A test project');
    expect(graph.languages).toEqual(['typescript']);
    expect(graph.frameworks).toEqual(['react']);
    expect(graph.project_name).toBe('my-custom-name');
    expect(graph.stats.smell_summary).toEqual({ god_node: 2 });
  });

  it('deduplicates edges', () => {
    root = makeProject({
      edges: [
        { source: 'a', target: 'b', type: 'imports' },
        { source: 'a', target: 'b', type: 'imports' },
        { source: 'b', target: 'c', type: 'imports' },
      ],
    });
    const result = runMerge([root, '--intermediate', join(root, 'intermediate')]);
    expect(result.status).toBe(0);
    const graph = JSON.parse(readFileSync(join(root, '.sprang', 'knowledge-graph.json'), 'utf-8'));
    expect(graph.edges).toHaveLength(2);
    expect(graph.stats.edge_count).toBe(2);
  });

  it('fails gracefully when intermediate directory does not exist', () => {
    root = mkdtempSync(join(tmpdir(), 'sprang-merge-test-'));
    const result = runMerge([root, '--intermediate', join(root, 'does-not-exist')]);
    expect(result.status).toBe(1);
    expect(result.stderr + result.stdout).toMatch(/not found/i);
  });

  it('fails when no nodes are found', () => {
    root = mkdtempSync(join(tmpdir(), 'sprang-merge-test-'));
    const inter = join(root, 'intermediate');
    mkdirSync(inter, { recursive: true });
    mkdirSync(join(root, '.sprang'), { recursive: true });
    // No chunk files
    const result = runMerge([root, '--intermediate', inter]);
    expect(result.status).toBe(1);
    expect(result.stderr + result.stdout).toMatch(/No nodes/i);
  });

  it('includes layers and tours in output', () => {
    const layers = [{ id: 'layer-1', name: 'Core', node_ids: [] }];
    const tours = [{ id: 'tour-1', title: 'Architecture', steps: [] }];
    root = makeProject({ layers, tours });
    const result = runMerge([root, '--intermediate', join(root, 'intermediate')]);
    expect(result.status).toBe(0);
    const graph = JSON.parse(readFileSync(join(root, '.sprang', 'knowledge-graph.json'), 'utf-8'));
    expect(graph.layers).toHaveLength(1);
    expect(graph.layers[0].id).toBe('layer-1');
    expect(graph.tours).toHaveLength(1);
    expect(graph.tours[0].id).toBe('tour-1');
  });
});
