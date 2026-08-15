import { describe, it, expect } from 'vitest';
import { runEval, formatEvalReport } from '../../src/eval/run.js';
import type { EvalExample } from '../../src/eval/dataset.js';
import type { KnowledgeGraph } from '../../src/schema/types.js';

function graph(files: string[], edges: Array<[string, string]> = []): KnowledgeGraph {
  return {
    version: '1.0.0',
    generated_at: new Date().toISOString(),
    project_root: '/t',
    project_name: 't',
    phase: 'complete',
    nodes: files.map((f) => ({
      id: `file:${f}`,
      type: 'file',
      label: f.split('/').pop(),
      location: { file: f },
      metadata: { sizeLines: 50, fileCategory: 'source' },
    })),
    edges: edges.map(([a, b]) => ({ source: `file:${a}`, target: `file:${b}`, type: 'imports' })),
    layers: [],
    tours: [],
    domains: [],
    stats: {
      node_count: files.length,
      edge_count: edges.length,
      generated_at: new Date().toISOString(),
      risk_summary: { high: 0, medium: 0, low: 0 },
      smell_summary: {},
    },
  } as unknown as KnowledgeGraph;
}

const example = (query: string, groundTruth: string[]): EvalExample => ({
  sha: 'abc1234',
  query,
  groundTruth,
  parentSha: 'def5678',
  date: '2026-01-01T00:00:00Z',
});

describe('runEval', () => {
  const g = graph(
    ['src/payments/charge.ts', 'src/payments/refund.ts', 'src/users/profile.ts', 'src/util/log.ts'],
    [['src/payments/refund.ts', 'src/payments/charge.ts']],
  );
  const examples = [
    example('rounding error in the payments charge path', ['src/payments/charge.ts']),
  ];

  it('runs every arm by default', () => {
    const res = runEval(g, examples);
    expect(res.arms.map((a) => a.arm)).toEqual([
      'random',
      'keyword',
      'pagerank',
      'keyword+graph',
      'full',
    ]);
  });

  it('reports the example count', () => {
    expect(runEval(g, examples).examples).toBe(1);
  });

  it('lets the caller select a subset of arms', () => {
    const res = runEval(g, examples, { arms: ['keyword', 'full'] });
    expect(res.arms.map((a) => a.arm)).toEqual(['keyword', 'full']);
  });

  it('scores the full pipeline at least as well as random on a solvable query', () => {
    const res = runEval(g, examples, { arms: ['random', 'full'] });
    const random = res.arms.find((a) => a.arm === 'random')!;
    const full = res.arms.find((a) => a.arm === 'full')!;
    expect(full.aggregate.recallAt[10] ?? 0).toBeGreaterThanOrEqual(random.aggregate.recallAt[10] ?? 0);
  });

  it('is deterministic, including the random arm', () => {
    // Latency is wall-clock and cannot be stable; everything that feeds a
    // conclusion must be. The random arm is seeded precisely so the floor of
    // the ladder does not move between runs.
    const strip = (r: ReturnType<typeof runEval>) =>
      JSON.stringify({
        examples: r.examples,
        ks: r.ks,
        arms: r.arms.map((a) => ({ arm: a.arm, aggregate: a.aggregate })),
      });
    expect(strip(runEval(g, examples))).toBe(strip(runEval(g, examples)));
  });

  it('records per-query latency', () => {
    const res = runEval(g, examples, { arms: ['keyword'] });
    expect(res.arms[0]!.meanLatencyMs).toBeGreaterThanOrEqual(0);
  });

  it('handles an empty dataset without dividing by zero', () => {
    const res = runEval(g, []);
    expect(res.examples).toBe(0);
    for (const arm of res.arms) expect(arm.meanLatencyMs).toBe(0);
  });

  it('handles an empty graph', () => {
    const res = runEval(graph([]), examples);
    expect(res.arms.every((a) => (a.aggregate.recallAt[10] ?? 0) === 0)).toBe(true);
  });

  it('honours custom k values', () => {
    const res = runEval(g, examples, { ks: [3], arms: ['keyword'] });
    expect(Object.keys(res.arms[0]!.aggregate.recallAt)).toEqual(['3']);
  });
});

describe('formatEvalReport', () => {
  const g = graph(['src/payments/charge.ts', 'src/users/profile.ts']);
  const examples = [example('payments charge rounding problem', ['src/payments/charge.ts'])];

  it('renders a markdown table with one row per arm', () => {
    const report = formatEvalReport(runEval(g, examples));
    expect(report).toContain('| arm');
    expect(report).toContain('| full');
    expect(report.split('\n').filter((l) => l.startsWith('|')).length).toBeGreaterThanOrEqual(7);
  });

  it('states the sample size, because a small n changes how to read it', () => {
    const report = formatEvalReport(runEval(g, examples));
    expect(report).toMatch(/n = 1 example/);
    expect(report).toMatch(/Sample is small/);
  });

  it('warns loudly when the pipeline fails to beat the baseline', () => {
    // Ground truth nothing can retrieve: every arm scores zero, so the full
    // pipeline does not beat keyword and the report must say so rather than
    // printing a comfortable-looking table.
    const impossible = [example('zzzz qqqq', ['does/not/exist.ts'])];
    const report = formatEvalReport(runEval(g, impossible));
    expect(report).toMatch(/not beaten|did not/i);
  });

  it('omits the small-sample caveat once the set is large enough', () => {
    const many = Array.from({ length: 60 }, (_, i) =>
      example(`payments charge issue number ${i}`, ['src/payments/charge.ts']),
    );
    const report = formatEvalReport(runEval(g, many));
    expect(report).not.toMatch(/Sample is small/);
  });
});
