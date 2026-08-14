import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { knowledgeGraphSchema } from '@sprang/core';

// merge.py lives at the repo root (three levels up from packages/cli/tests).
const REPO_ROOT = resolve(__dirname, '../../..');
const MERGE_PY = join(REPO_ROOT, 'skills/sprang-analyze/scripts/merge.py');

const pythonAvailable = spawnSync('python3', ['--version']).status === 0;

/** Write intermediate fixtures, run merge.py, return the parsed graph. */
function runMerge(tmpDir: string, files: Record<string, unknown>): unknown {
  const inter = join(tmpDir, '.sprang', 'intermediate');
  mkdirSync(inter, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(inter, name), JSON.stringify(content));
  }
  const res = spawnSync('python3', [MERGE_PY], {
    env: { ...process.env, PROJECT_ROOT: tmpDir },
    encoding: 'utf-8',
  });
  if (res.status !== 0) {
    throw new Error(`merge.py failed: ${res.stderr}`);
  }
  return JSON.parse(readFileSync(join(tmpDir, '.sprang', 'knowledge-graph.json'), 'utf-8'));
}

describe.skipIf(!pythonAvailable)('merge.py schema normalisation (v0.2.4)', () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'sprang-merge-test-'));
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('coerces drifted agent output into a schema-valid graph (the v0.2.3 GRAPH_NOT_FOUND bug)', () => {
    // This mirrors the exact shapes the analyze agent produced against rlm that
    // failed knowledgeGraphSchema with 216 issues: domains using `name` not
    // `label`, tour steps using title/description, invalid risk_factors enum
    // values, structural_warnings written as bare strings, and an incomplete
    // decision_context with a string change_frequency.
    const graph = runMerge(tmpDir, {
      'final-nodes-chunk-000.json': [
        { id: 'file:src/core.ts', type: 'file', label: 'core.ts', summary: 'Core module' },
        { id: 'file:src/util.ts', type: 'file', label: 'util.ts', summary: 'Utilities' },
      ],
      'final-edges.json': [{ source: 'file:src/core.ts', target: 'file:src/util.ts', type: 'imports' }],
      'final-layers.json': ['Core', { id: 'layer:utils', name: 'Utilities', node_ids: ['file:src/util.ts'] }],
      'final-tours.json': [
        {
          id: 'tour-main',
          title: 'Architecture Tour',
          description: 'Walkthrough',
          // step uses title/description instead of step_title/explanation
          steps: [{ title: 'Entry', description: 'Where it starts', node_ids: ['file:src/core.ts'] }],
        },
      ],
      'final-domains.json': [
        // domain uses `name`, not `label`; flat (node_ids, no flows)
        { id: 'inference', name: 'Inference Engine', node_ids: ['file:src/core.ts'] },
      ],
      'risk-scores.json': {
        'file:src/core.ts': {
          risk_score: 0.82,
          // mix of valid + invalid risk factors
          risk_factors: ['high_coupling', 'many_dependents', 'api_contract'],
          // structural_warnings as bare strings + one invalid-category object
          structural_warnings: [
            'this file is too big',
            { category: 'high_coupling', severity: 'high', description: 'x', related_node_ids: [], heuristic: '' },
            { category: 'god_node', severity: 'high', description: 'too many deps', related_node_ids: [], heuristic: 'out_degree > 20' },
          ],
          decision_context: {
            // missing commits/pr_references/changelog_entries; change_frequency is a string
            primary_authors: ['a@b.com'],
            last_changed: '2026-06-01',
            change_frequency: '8',
          },
        },
      },
      'assembled-graph.json': { project_name: 'fixture', description: 'test', languages: ['ts'] },
    });

    const res = knowledgeGraphSchema.safeParse(graph);
    expect(res.success).toBe(true);
  });

  it('maps domain `name` → `label` and wraps a flat domain into flows/steps', () => {
    const graph = runMerge(tmpDir, {
      'final-nodes-chunk-000.json': [{ id: 'file:a.ts', type: 'file', label: 'a.ts' }],
      'final-domains.json': [{ id: 'd1', name: 'Payments', node_ids: ['file:a.ts'] }],
    }) as { domains: Array<{ label: string; flows: Array<{ steps: Array<{ id: string; label: string; weight: number; node_ids: string[] }> }> }> };

    expect(graph.domains[0].label).toBe('Payments');
    expect(graph.domains[0].flows.length).toBeGreaterThanOrEqual(1);
    const step = graph.domains[0].flows[0].steps[0];
    expect(step.id).toBeTruthy();
    expect(step.label).toBeTruthy();
    expect(step.node_ids).toContain('file:a.ts');
    expect(typeof step.weight).toBe('number');
    expect(knowledgeGraphSchema.safeParse(graph).success).toBe(true);
  });

  it('drops invalid risk_factors but keeps the valid ones', () => {
    const graph = runMerge(tmpDir, {
      'final-nodes-chunk-000.json': [{ id: 'file:a.ts', type: 'file', label: 'a.ts' }],
      'risk-scores.json': {
        'file:a.ts': { risk_score: 0.5, risk_factors: ['critical_path', 'made_up_factor', 'test_code'] },
      },
    }) as { nodes: Array<{ id: string; risk_factors?: string[] }> };

    const node = graph.nodes.find((n) => n.id === 'file:a.ts')!;
    expect(node.risk_factors).toEqual(['critical_path']);
    expect(knowledgeGraphSchema.safeParse(graph).success).toBe(true);
  });

  it('wraps a flat tour step array into a Tour object with step_title/explanation', () => {
    const graph = runMerge(tmpDir, {
      'final-nodes-chunk-000.json': [{ id: 'file:a.ts', type: 'file', label: 'a.ts' }],
      // flat array of steps, no Tour wrapper, using title/description
      'final-tours.json': [{ title: 'Step one', description: 'does a thing', node_ids: ['file:a.ts'] }],
    }) as { tours: Array<{ id: string; title: string; steps: Array<{ step_title: string; explanation: string }> }> };

    expect(graph.tours.length).toBe(1);
    expect(graph.tours[0].steps.length).toBeGreaterThanOrEqual(1);
    expect(graph.tours[0].steps[0].step_title).toBeTruthy();
    expect(knowledgeGraphSchema.safeParse(graph).success).toBe(true);
  });

  it('recomputes smell_summary from canonical node warnings, dropping non-canonical categories', () => {
    const graph = runMerge(tmpDir, {
      'final-nodes-chunk-000.json': [{ id: 'file:a.ts', type: 'file', label: 'a.ts' }],
      'risk-scores.json': {
        'file:a.ts': {
          structural_warnings: [
            { category: 'god_node', severity: 'high', description: 'x', related_node_ids: [], heuristic: '' },
            { category: 'not_a_real_smell', severity: 'high', description: 'y', related_node_ids: [], heuristic: '' },
          ],
        },
      },
    }) as { stats: { smell_summary: Record<string, number> } };

    expect(graph.stats.smell_summary).toEqual({ god_node: 1 });
    expect(knowledgeGraphSchema.safeParse(graph).success).toBe(true);
  });

  it('maps drifted edge types and swaps `tests` into `tested_by`', () => {
    // The TypeScript twin is covered in packages/core; this pins that merge.py
    // produces byte-identical results, since the two must never diverge.
    const graph = runMerge(tmpDir, {
      'final-nodes-chunk-1.json': [
        { id: 'file:src/a.ts', type: 'file', label: 'a.ts', layer: null },
      ],
      'final-edges.json': [
        { source: 'file:t/a.test.ts', target: 'file:src/a.ts', type: 'tests' },
        { source: 'file:src/a.ts', target: 'file:src/b.ts', type: 'dependsOn' },
        { source: 'file:src/a.ts', target: 'file:src/c.ts', type: 'references' },
        { source: 'file:src/a.ts', target: 'file:src/d.ts', type: 'vibes' },
      ],
    }) as { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, string>> };

    expect(knowledgeGraphSchema.safeParse(graph).success).toBe(true);
    // `layer: null` is not `layer` absent — this exact template broke production.
    expect('layer' in graph.nodes[0]!).toBe(false);
    expect(graph.edges).toEqual([
      { source: 'file:src/a.ts', target: 'file:t/a.test.ts', type: 'tested_by' },
      { source: 'file:src/a.ts', target: 'file:src/b.ts', type: 'depends_on' },
      { source: 'file:src/a.ts', target: 'file:src/c.ts', type: 'related' },
    ]);
  });

  it('restores Phase 1 warnings from node-warnings.json without clobbering the agent', () => {
    const secWarning = {
      category: 'hardcoded_secret', severity: 'high',
      description: 'Hardcoded API key', pattern: 'api_key',
    };
    const graph = runMerge(tmpDir, {
      'final-nodes-chunk-1.json': [
        { id: 'file:bad.js', type: 'file', label: 'bad.js', summary: 'Agent summary.' },
        { id: 'file:ok.js', type: 'file', label: 'ok.js', risk_score: 0.1 },
      ],
      'node-warnings.json': {
        'file:bad.js': { security_warnings: [secWarning], risk_score: 0.82 },
        'file:ok.js': { risk_score: 0.99 },
      },
    }) as {
      nodes: Array<Record<string, unknown>>;
      stats: { security_summary?: { total: number } };
    };

    const bad = graph.nodes.find((n) => n['id'] === 'file:bad.js')!;
    expect(bad['security_warnings']).toEqual([secWarning]);
    expect(bad['risk_score']).toBe(0.82);
    expect(bad['summary']).toBe('Agent summary.');   // enrichment preserved
    // The agent already scored this node; the older static value must not win.
    expect(graph.nodes.find((n) => n['id'] === 'file:ok.js')!['risk_score']).toBe(0.1);
    // Findings feed the summary again, so the health grade stops inflating.
    expect(graph.stats.security_summary?.total).toBe(1);
  });

  it('accepts both risk-scores.json shapes', () => {
    // Phase 1 writes { nodes: [{ nodeId }] }; the analyze skill tells agents to
    // write { "<node-id>": {...} }. Reading only the latter silently dropped all
    // Phase 1 risk data.
    const graph = runMerge(tmpDir, {
      'final-nodes-chunk-1.json': [{ id: 'file:a.ts', type: 'file', label: 'a.ts' }],
      'risk-scores.json': { nodes: [{ nodeId: 'file:a.ts', risk_score: 0.77 }] },
    }) as { nodes: Array<Record<string, unknown>> };
    expect(graph.nodes[0]!['risk_score']).toBe(0.77);
  });

  it('honours SPRANG_GRAPH_KIND for knowledge-base graphs', () => {
    const inter = join(tmpDir, '.sprang', 'intermediate');
    mkdirSync(inter, { recursive: true });
    writeFileSync(join(inter, 'final-nodes-chunk-1.json'),
      JSON.stringify([{ id: 'article:note.md', type: 'article', label: 'note' }]));
    const res = spawnSync('python3', [MERGE_PY], {
      env: { ...process.env, PROJECT_ROOT: tmpDir, SPRANG_GRAPH_KIND: 'knowledge' },
      encoding: 'utf-8',
    });
    expect(res.status, res.stderr).toBe(0);
    const graph = JSON.parse(readFileSync(join(tmpDir, '.sprang', 'knowledge-graph.json'), 'utf-8')) as { kind: string };
    expect(graph.kind).toBe('knowledge');
  });

  it('ships merge.py to every platform from one canonical copy', () => {
    // Pre-0.3 there were two hand-maintained copies. `skills/` is now canonical
    // and scripts/sync-agent-assets.mjs generates the per-platform trees, so all
    // copies must be byte-identical to it.
    const canonical = readFileSync(MERGE_PY, 'utf-8');
    for (const tree of ['.devin/skills', '.claude/skills']) {
      const copy = join(REPO_ROOT, tree, 'sprang-analyze/scripts/merge.py');
      expect(readFileSync(copy, 'utf-8'), `${tree} copy of merge.py`).toBe(canonical);
    }
  });
});
