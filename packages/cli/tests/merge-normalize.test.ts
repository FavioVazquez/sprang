import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { knowledgeGraphSchema } from '@sprang/core';

// merge.py lives at the repo root (three levels up from packages/cli/tests).
const REPO_ROOT = resolve(__dirname, '../../..');
const MERGE_PY = join(REPO_ROOT, 'skills/sprang-analyze/scripts/merge.py');
const MERGE_PY_WINDSURF = join(REPO_ROOT, '.windsurf/skills/sprang-analyze/scripts/merge.py');

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

  it('keeps the two distributed merge.py copies byte-identical', () => {
    expect(readFileSync(MERGE_PY, 'utf-8')).toBe(readFileSync(MERGE_PY_WINDSURF, 'utf-8'));
  });
});
