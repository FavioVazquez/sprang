import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GraphLoader } from '../src/graph-loader.js';
import { sprangReview } from '../src/tools/sprang_review.js';
import { ReadLog, toPath, loadAllReadPaths } from '../src/receipt.js';

/** a.ts <- b.ts <- c.ts, plus an unrelated d.ts. */
function graph() {
  const file = (p: string, risk = 0) => ({
    id: `file:${p}`,
    type: 'file',
    label: p,
    location: { file: p },
    risk_score: risk,
  });
  return {
    version: '1.0.0',
    generated_at: new Date().toISOString(),
    project_root: '/tmp',
    project_name: 't',
    phase: 'complete',
    layers: [],
    tours: [],
    domains: [],
    nodes: [file('a.ts', 0.1), file('b.ts', 0.9), file('c.ts', 0.4), file('d.ts', 0.2)],
    edges: [
      { source: 'file:b.ts', target: 'file:a.ts', type: 'imports' },
      { source: 'file:c.ts', target: 'file:b.ts', type: 'imports' },
    ],
    stats: {
      node_count: 4,
      edge_count: 2,
      generated_at: new Date().toISOString(),
      risk_summary: { high: 0, medium: 0, low: 0 },
      smell_summary: {},
    },
  };
}

describe('read receipts', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'sprang-receipt-'));
    mkdirSync(join(root, '.sprang'), { recursive: true });
    writeFileSync(join(root, '.sprang', 'knowledge-graph.json'), JSON.stringify(graph()));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('normalises node ids of every shape to a file path', () => {
    expect(toPath('file:src/a.ts')).toBe('src/a.ts');
    expect(toPath('function:src/a.ts:doThing')).toBe('src/a.ts');
    expect(toPath('src/a.ts')).toBe('src/a.ts');
  });

  it('persists reads so a later process can audit them', () => {
    new ReadLog(root, 's1').record(['file:a.ts', 'function:b.ts:x'], 'sprang_node');
    const { paths, sessions } = loadAllReadPaths(root);
    expect(sessions).toBe(1);
    expect(paths.has('a.ts')).toBe(true);
    expect(paths.has('b.ts')).toBe(true);
  });

  it('records each node once however often it is surfaced', () => {
    const log = new ReadLog(root, 's1');
    log.record(['file:a.ts'], 'sprang_node');
    log.record(['file:a.ts'], 'sprang_query');
    expect(loadAllReadPaths(root).paths.size).toBe(1);
  });

  it('never throws when the directory cannot be created', () => {
    // Root is a regular file, so mkdir fails with ENOTDIR immediately.
    // (Do not point this at /proc — mkdir there hangs rather than erroring.)
    const asFile = join(root, 'not-a-dir');
    writeFileSync(asFile, 'x');
    expect(() => new ReadLog(asFile, 's1').record(['file:a.ts'], 't')).not.toThrow();
    expect(loadAllReadPaths(asFile).sessions).toBe(0);
  });
});

describe('sprang_review', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'sprang-review-'));
    mkdirSync(join(root, '.sprang'), { recursive: true });
    writeFileSync(join(root, '.sprang', 'knowledge-graph.json'), JSON.stringify(graph()));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('finds dependents of the changed file, with hop distance', async () => {
    new ReadLog(root, 's').record(['file:a.ts'], 'sprang_node');
    const res = await sprangReview(new GraphLoader(root), { changed_files: ['a.ts'] }, root);
    if (!('unread' in res)) throw new Error('expected a result');
    expect(res.blast_radius_size).toBe(2); // b (1 hop) and c (2 hops)
    const b = res.unread.find((u) => u.path === 'b.ts');
    expect(b?.hops).toBe(1);
  });

  it('ranks unread files by risk so the dangerous one is first', async () => {
    new ReadLog(root, 's').record(['file:a.ts'], 'sprang_node');
    const res = await sprangReview(new GraphLoader(root), { changed_files: ['a.ts'] }, root);
    if (!('unread' in res)) throw new Error('expected a result');
    expect(res.unread[0]!.path).toBe('b.ts'); // risk 0.9 beats c.ts at 0.4
  });

  it('reports full coverage when everything impacted was read', async () => {
    new ReadLog(root, 's').record(['file:a.ts', 'file:b.ts', 'file:c.ts'], 'sprang_node');
    const res = await sprangReview(new GraphLoader(root), { changed_files: ['a.ts'] }, root);
    if (!('unread' in res)) throw new Error('expected a result');
    expect(res.context_coverage).toBe(1);
    expect(res.verdict).toBe('looks_complete');
    expect(res.unread).toEqual([]);
  });

  it('refuses to imply completeness when there are no receipts', async () => {
    // Silence here would be read as approval, which is the failure mode this
    // whole tool exists to prevent.
    const res = await sprangReview(new GraphLoader(root), { changed_files: ['a.ts'] }, root);
    if (!('verdict' in res)) throw new Error('expected a result');
    expect(res.verdict).toBe('no_receipts');
    expect(res.guidance).toMatch(/not evidence/);
    expect(res.unread.length).toBeGreaterThan(0);
  });

  it('excludes the changed files themselves from the radius', async () => {
    new ReadLog(root, 's').record(['file:a.ts'], 'sprang_node');
    const res = await sprangReview(new GraphLoader(root), { changed_files: ['a.ts', 'b.ts'] }, root);
    if (!('unread' in res)) throw new Error('expected a result');
    expect(res.unread.some((u) => u.path === 'a.ts' || u.path === 'b.ts')).toBe(false);
  });

  it('honours the depth limit', async () => {
    new ReadLog(root, 's').record(['file:a.ts'], 'sprang_node');
    const res = await sprangReview(new GraphLoader(root), { changed_files: ['a.ts'], depth: 1 }, root);
    if (!('unread' in res)) throw new Error('expected a result');
    expect(res.blast_radius_size).toBe(1); // only b.ts at one hop
  });

  it('surfaces a graph error rather than reporting a clean bill of health', async () => {
    writeFileSync(join(root, '.sprang', 'knowledge-graph.json'), '{"nodes":"broken"}');
    const res = await sprangReview(new GraphLoader(root), { changed_files: ['a.ts'] }, root);
    expect('code' in res).toBe(true);
  });
});
