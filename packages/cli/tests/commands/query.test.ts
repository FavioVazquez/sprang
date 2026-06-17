import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const CLI = join(import.meta.dirname, '../../dist/index.js');
const created: string[] = [];

function projectWithGraph(): string {
  const root = mkdtempSync(join(tmpdir(), 'sprang-query-test-'));
  created.push(root);
  const now = new Date().toISOString();
  const graph = {
    version: '1.0.0', generated_at: now, project_root: root, project_name: 'q',
    phase: 'complete',
    nodes: [
      { id: 'file:src/utils/validate.ts', type: 'file', label: 'validate.ts' },
      { id: 'function:src/utils/validate.ts:isNonEmpty', type: 'function', label: 'isNonEmpty' },
      { id: 'file:src/data/db.ts', type: 'file', label: 'db.ts' },
    ],
    edges: [], layers: [], tours: [], domains: [],
    stats: { node_count: 3, edge_count: 0, risk_summary: { high: 0, medium: 0, low: 3 }, smell_summary: {}, generated_at: now },
  };
  mkdirSync(join(root, '.sprang'), { recursive: true });
  writeFileSync(join(root, '.sprang', 'knowledge-graph.json'), JSON.stringify(graph));
  return root;
}

function query(root: string, q: string): string {
  const res = spawnSync('node', [CLI, 'query', q, root], { encoding: 'utf-8' });
  return res.stdout ?? '';
}

afterEach(() => {
  for (const d of created.splice(0)) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

describe('sprang query (v0.2.3 tokenization)', () => {
  it('matches a single keyword', () => {
    expect(query(projectWithGraph(), 'validate')).toContain('validate.ts');
  });

  it('matches a multi-word query by any token (regression)', () => {
    // Before the fix "validate input" was matched as a whole substring and
    // returned nothing; now the "validate" token matches validate.ts.
    const out = query(projectWithGraph(), 'validate input');
    expect(out).toContain('validate.ts');
    expect(out).not.toContain('No nodes matching');
  });

  it('still reports no match when no token matches', () => {
    expect(query(projectWithGraph(), 'zzzznotpresent')).toContain('No nodes matching');
  });
});
