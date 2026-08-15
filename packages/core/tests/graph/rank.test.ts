import { describe, it, expect } from 'vitest';
import { rankGraph } from '../../src/graph/rank.js';
import type { KnowledgeGraph, SprangEdge, SprangNode } from '../../src/schema/types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeGraph(nodes: SprangNode[], edges: SprangEdge[] = []): KnowledgeGraph {
  return {
    version: '1.0.0',
    generated_at: '2024-01-01T00:00:00.000Z',
    project_root: '/tmp/test',
    project_name: 'test',
    phase: 'skeleton',
    nodes,
    edges,
    layers: [],
    tours: [],
    domains: [],
    stats: {
      node_count: nodes.length,
      edge_count: edges.length,
      risk_summary: { high: 0, medium: 0, low: 0 },
      smell_summary: {},
      generated_at: '2024-01-01T00:00:00.000Z',
    },
  };
}

function fileNode(path: string): SprangNode {
  return {
    id: `file:${path}`,
    type: 'file',
    name: path,
    label: path,
    filePath: path,
    location: { file: path },
  };
}

function funcNode(path: string, ident: string): SprangNode {
  return {
    id: `function:${path}:${ident}`,
    type: 'function',
    name: ident,
    label: ident,
    location: { file: path, start_line: 1, end_line: 5 },
  };
}

/** `[referencerFile, definerFile, ident]`; repeat a triple to model repeated references. */
type CallSpec = readonly [string, string, string];

function callsGraph(specs: readonly CallSpec[], extraFiles: readonly string[] = []): KnowledgeGraph {
  const nodes = new Map<string, SprangNode>();
  const edges: SprangEdge[] = [];
  const addFile = (p: string) => {
    if (!nodes.has(`file:${p}`)) nodes.set(`file:${p}`, fileNode(p));
  };
  for (const f of extraFiles) addFile(f);
  for (const [ref, def, ident] of specs) {
    addFile(ref);
    addFile(def);
    const fn = funcNode(def, ident);
    if (!nodes.has(fn.id)) nodes.set(fn.id, fn);
    edges.push({ source: `file:${ref}`, target: fn.id, type: 'calls' });
  }
  return makeGraph([...nodes.values()], edges);
}

function importsGraph(pairs: ReadonlyArray<readonly [string, string]>): KnowledgeGraph {
  const nodes = new Map<string, SprangNode>();
  const edges: SprangEdge[] = [];
  for (const [from, to] of pairs) {
    if (!nodes.has(`file:${from}`)) nodes.set(`file:${from}`, fileNode(from));
    if (!nodes.has(`file:${to}`)) nodes.set(`file:${to}`, fileNode(to));
    edges.push({ source: `file:${from}`, target: `file:${to}`, type: 'imports' });
  }
  return makeGraph([...nodes.values()], edges);
}

function topFiles(ranks: Map<string, number>, k: number): string[] {
  return [...ranks.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, k)
    .map(([f]) => f);
}

function rankOf(ranks: Map<string, number>, file: string): number {
  const v = ranks.get(file);
  expect(v).toBeDefined();
  return v ?? 0;
}

function sum(values: Iterable<number>): number {
  let t = 0;
  for (const v of values) t += v;
  return t;
}

// ─── Degenerate cases ─────────────────────────────────────────────────────────

describe('rankGraph — degenerate cases', () => {
  it('returns empty maps and converged=true for an empty graph', () => {
    const res = rankGraph(makeGraph([], []));
    expect(res.fileRank.size).toBe(0);
    expect(res.symbolRank.size).toBe(0);
    expect(res.iterations).toBe(0);
    expect(res.converged).toBe(true);
  });

  it('gives uniform rank when there are no edges at all', () => {
    const graph = makeGraph([fileNode('src/a.ts'), fileNode('src/b.ts'), fileNode('src/c.ts')]);
    const res = rankGraph(graph);
    expect(res.fileRank.size).toBe(3);
    for (const v of res.fileRank.values()) expect(v).toBeCloseTo(1 / 3, 10);
    expect(res.converged).toBe(true);
    expect(res.symbolRank.size).toBe(0);
  });

  it('treats a graph of fully isolated nodes (only non-reference edges) as uniform', () => {
    const nodes = [
      fileNode('src/a.ts'),
      funcNode('src/a.ts', 'doThing'),
      fileNode('src/b.ts'),
      funcNode('src/b.ts', 'other'),
    ];
    const edges: SprangEdge[] = [
      { source: 'file:src/a.ts', target: 'function:src/a.ts:doThing', type: 'contains' },
      { source: 'file:src/b.ts', target: 'function:src/b.ts:other', type: 'contains' },
    ];
    const res = rankGraph(makeGraph(nodes, edges));
    expect([...res.fileRank.keys()].sort()).toEqual(['src/a.ts', 'src/b.ts']);
    expect(rankOf(res.fileRank, 'src/a.ts')).toBeCloseTo(0.5, 10);
    expect(rankOf(res.fileRank, 'src/b.ts')).toBeCloseTo(0.5, 10);
  });

  it('falls back to unpersonalized PageRank when the personalization vector is empty', () => {
    const graph = callsGraph([['src/a.ts', 'src/b.ts', 'alpha']]);
    const plain = rankGraph(graph);
    // Seeds that do not exist in the graph must not create personalization.
    const ghostSeeds = rankGraph(graph, { seedFiles: ['does/not/exist.ts'] });
    expect([...ghostSeeds.fileRank.entries()]).toEqual([...plain.fileRank.entries()]);
  });

  it('redistributes dangling-node mass through the personalization vector', () => {
    // b.ts has no out-edges: it is dangling. Its mass must return to the seed.
    const graph = callsGraph([['src/a.ts', 'src/b.ts', 'alpha']]);
    const res = rankGraph(graph, { seedFiles: ['src/a.ts'] });
    expect(sum(res.fileRank.values())).toBeCloseTo(1, 9);
    expect(rankOf(res.fileRank, 'src/a.ts')).toBeGreaterThan(0.4);
    expect(rankOf(res.fileRank, 'src/b.ts')).toBeGreaterThan(0);
  });

  it('skips self-edges', () => {
    const nodes = [fileNode('src/a.ts'), funcNode('src/a.ts', 'selfCall')];
    const edges: SprangEdge[] = [
      { source: 'file:src/a.ts', target: 'function:src/a.ts:selfCall', type: 'calls' },
    ];
    const res = rankGraph(makeGraph(nodes, edges));
    expect(res.symbolRank.size).toBe(0);
    expect(rankOf(res.fileRank, 'src/a.ts')).toBeCloseTo(1, 10);
  });
});

// ─── Structural ranking ───────────────────────────────────────────────────────

describe('rankGraph — structure', () => {
  it('ranks a hub that everything imports highest', () => {
    const graph = importsGraph([
      ['src/a.ts', 'src/hub.ts'],
      ['src/b.ts', 'src/hub.ts'],
      ['src/c.ts', 'src/hub.ts'],
      ['src/d.ts', 'src/hub.ts'],
      ['src/e.ts', 'src/hub.ts'],
    ]);
    const res = rankGraph(graph);
    expect(topFiles(res.fileRank, 1)).toEqual(['src/hub.ts']);
    expect(rankOf(res.fileRank, 'src/hub.ts')).toBeGreaterThan(rankOf(res.fileRank, 'src/a.ts'));
  });

  it('propagates importance transitively (used-by-the-used ranks above a leaf)', () => {
    const graph = importsGraph([
      ['src/a.ts', 'src/mid.ts'],
      ['src/b.ts', 'src/mid.ts'],
      ['src/c.ts', 'src/mid.ts'],
      ['src/mid.ts', 'src/deep.ts'],
      ['src/a.ts', 'src/leaf.ts'],
    ]);
    const res = rankGraph(graph);
    expect(rankOf(res.fileRank, 'src/deep.ts')).toBeGreaterThan(rankOf(res.fileRank, 'src/leaf.ts'));
  });

  it('file ranks sum to 1', () => {
    const graph = importsGraph([
      ['src/a.ts', 'src/b.ts'],
      ['src/b.ts', 'src/c.ts'],
      ['src/c.ts', 'src/a.ts'],
      ['src/d.ts', 'src/a.ts'],
    ]);
    const res = rankGraph(graph);
    expect(sum(res.fileRank.values())).toBeCloseTo(1, 9);
  });
});

// ─── Personalization ──────────────────────────────────────────────────────────

describe('rankGraph — personalization', () => {
  const graph = importsGraph([
    ['src/left.ts', 'src/leftDep.ts'],
    ['src/right.ts', 'src/rightDep.ts'],
  ]);

  it('changes the top-ranked file when the seeds change', () => {
    const a = rankGraph(graph, { seedFiles: ['src/left.ts'] });
    const b = rankGraph(graph, { seedFiles: ['src/right.ts'] });
    expect(topFiles(a.fileRank, 1)).toEqual(['src/left.ts']);
    expect(topFiles(b.fileRank, 1)).toEqual(['src/right.ts']);
    expect(topFiles(a.fileRank, 2)[1]).toBe('src/leftDep.ts');
    expect(topFiles(b.fileRank, 2)[1]).toBe('src/rightDep.ts');
  });

  it('treats mentionedFiles as personalization mass too', () => {
    const plain = rankGraph(graph);
    const mentioned = rankGraph(graph, { mentionedFiles: ['src/right.ts'] });
    expect(rankOf(mentioned.fileRank, 'src/rightDep.ts')).toBeGreaterThan(
      rankOf(plain.fileRank, 'src/rightDep.ts'),
    );
  });

  it('personalizes files whose path components match a mentioned identifier (once)', () => {
    const g = importsGraph([
      ['src/alpha/one.ts', 'src/util.ts'],
      ['src/beta/two.ts', 'src/util.ts'],
    ]);
    const res = rankGraph(g, { mentionedIdents: ['alpha'] });
    expect(rankOf(res.fileRank, 'src/alpha/one.ts')).toBeGreaterThan(
      rankOf(res.fileRank, 'src/beta/two.ts'),
    );
  });
});

// ─── Weight cascade ───────────────────────────────────────────────────────────

describe('rankGraph — weight multiplier cascade', () => {
  it('demotes identifiers starting with an underscore', () => {
    const res = rankGraph(
      callsGraph([
        ['src/main.ts', 'src/pub.ts', 'helper'],
        ['src/main.ts', 'src/priv.ts', '_helper'],
      ]),
    );
    expect(rankOf(res.fileRank, 'src/pub.ts')).toBeGreaterThan(rankOf(res.fileRank, 'src/priv.ts'));
  });

  it('demotes identifiers defined in more than five distinct files', () => {
    const noisy: CallSpec[] = [
      ['src/main.ts', 'src/uniq.ts', 'alpha'],
      ['src/main.ts', 'src/generic.ts', 'run'],
    ];
    // Six more definers of `run` -> seven total -> over the threshold.
    for (let i = 0; i < 6; i++) noisy.push([`src/r${i}.ts`, `src/d${i}.ts`, 'run']);

    const quiet: CallSpec[] = [
      ['src/main.ts', 'src/uniq.ts', 'alpha'],
      ['src/main.ts', 'src/generic.ts', 'run'],
    ];
    // Only three more definers -> four total -> under the threshold.
    for (let i = 0; i < 3; i++) quiet.push([`src/r${i}.ts`, `src/d${i}.ts`, 'run']);

    const noisyRes = rankGraph(callsGraph(noisy));
    const quietRes = rankGraph(callsGraph(quiet));

    // Under the threshold both idents weigh the same, so the two targets tie.
    expect(rankOf(quietRes.fileRank, 'src/generic.ts')).toBeCloseTo(
      rankOf(quietRes.fileRank, 'src/uniq.ts'),
      12,
    );
    // Over the threshold the generic ident is demoted 10x.
    expect(rankOf(noisyRes.fileRank, 'src/generic.ts')).toBeLessThan(
      rankOf(noisyRes.fileRank, 'src/uniq.ts'),
    );
  });

  it('boosts distinctive identifiers', () => {
    const res = rankGraph(
      callsGraph([
        ['src/main.ts', 'src/rich.ts', 'calculateInvoiceTotal'],
        ['src/main.ts', 'src/plain.ts', 'parse'],
      ]),
    );
    expect(rankOf(res.fileRank, 'src/rich.ts')).toBeGreaterThan(rankOf(res.fileRank, 'src/plain.ts'));

    // Short camelCase names are NOT distinctive (length < 8).
    const control = rankGraph(
      callsGraph([
        ['src/main.ts', 'src/rich.ts', 'calcAll'],
        ['src/main.ts', 'src/plain.ts', 'parse'],
      ]),
    );
    expect(rankOf(control.fileRank, 'src/rich.ts')).toBeCloseTo(
      rankOf(control.fileRank, 'src/plain.ts'),
      12,
    );
  });

  it('boosts edges carrying a mentioned identifier', () => {
    const graph = callsGraph([
      ['src/main.ts', 'src/one.ts', 'alpha'],
      ['src/main.ts', 'src/two.ts', 'beta'],
    ]);
    const plain = rankGraph(graph);
    expect(rankOf(plain.fileRank, 'src/one.ts')).toBeCloseTo(rankOf(plain.fileRank, 'src/two.ts'), 12);

    const boosted = rankGraph(graph, { mentionedIdents: ['beta'] });
    expect(rankOf(boosted.fileRank, 'src/two.ts')).toBeGreaterThan(
      rankOf(boosted.fileRank, 'src/one.ts'),
    );
  });

  it('weights repeated references sub-linearly via sqrt(count)', () => {
    const res = rankGraph(
      callsGraph([
        ['src/main.ts', 'src/hot.ts', 'alpha'],
        ['src/main.ts', 'src/hot.ts', 'alpha'],
        ['src/main.ts', 'src/hot.ts', 'alpha'],
        ['src/main.ts', 'src/hot.ts', 'alpha'],
        ['src/main.ts', 'src/cold.ts', 'gamma'],
      ]),
    );
    expect(rankOf(res.fileRank, 'src/hot.ts')).toBeGreaterThan(rankOf(res.fileRank, 'src/cold.ts'));
    // The flow out of main.ts splits by weight: sqrt(4) = 2 vs 1 — not 4 vs 1.
    const hotFlow = res.symbolRank.get('src/hot.ts::alpha') ?? 0;
    const coldFlow = res.symbolRank.get('src/cold.ts::gamma') ?? 0;
    expect(hotFlow / coldFlow).toBeCloseTo(2, 9);
  });

  it('applies the seed-referencer multiplier without breaking normalization', () => {
    const graph = callsGraph([
      ['src/main.ts', 'src/one.ts', 'alpha'],
      ['src/main.ts', 'src/two.ts', 'beta'],
    ]);
    const res = rankGraph(graph, { seedFiles: ['src/main.ts'] });
    expect(sum(res.fileRank.values())).toBeCloseTo(1, 9);
    // Both out-edges of the seed are scaled equally, so they stay tied.
    expect(rankOf(res.fileRank, 'src/one.ts')).toBeCloseTo(rankOf(res.fileRank, 'src/two.ts'), 12);
  });
});

// ─── Symbol rank ──────────────────────────────────────────────────────────────

describe('rankGraph — symbolRank', () => {
  it('is populated with "path::ident" keys and sums to the referencing mass', () => {
    const res = rankGraph(
      callsGraph([
        ['src/main.ts', 'src/util.ts', 'formatDate'],
        ['src/main.ts', 'src/util.ts', 'parseDate'],
        ['src/other.ts', 'src/util.ts', 'formatDate'],
      ]),
    );
    expect([...res.symbolRank.keys()].sort()).toEqual([
      'src/util.ts::formatDate',
      'src/util.ts::parseDate',
    ]);
    for (const v of res.symbolRank.values()) expect(v).toBeGreaterThan(0);

    const total = sum(res.symbolRank.values());
    const referencingMass =
      rankOf(res.fileRank, 'src/main.ts') + rankOf(res.fileRank, 'src/other.ts');
    expect(total).toBeCloseTo(referencingMass, 9);
    expect(total).toBeLessThanOrEqual(1 + 1e-9);
  });

  it('ranks the symbol used by the most important file highest', () => {
    const res = rankGraph(
      callsGraph([
        ['src/a.ts', 'src/hub.ts', 'importantThing'],
        ['src/b.ts', 'src/hub.ts', 'importantThing'],
        ['src/c.ts', 'src/hub.ts', 'importantThing'],
        ['src/a.ts', 'src/side.ts', 'minor'],
      ]),
    );
    const hub = res.symbolRank.get('src/hub.ts::importantThing') ?? 0;
    const side = res.symbolRank.get('src/side.ts::minor') ?? 0;
    expect(hub).toBeGreaterThan(side);
  });

  it('derives import identifiers from the imported file basename', () => {
    const res = rankGraph(importsGraph([['src/a.ts', 'src/lib/logger.ts']]));
    expect([...res.symbolRank.keys()]).toEqual(['src/lib/logger.ts::logger.ts']);
  });
});

// ─── Convergence / determinism / performance ──────────────────────────────────

describe('rankGraph — convergence, determinism, performance', () => {
  it('reports convergence on a well-behaved graph', () => {
    const res = rankGraph(
      importsGraph([
        ['src/a.ts', 'src/b.ts'],
        ['src/b.ts', 'src/c.ts'],
        ['src/c.ts', 'src/a.ts'],
      ]),
    );
    expect(res.converged).toBe(true);
    expect(res.iterations).toBeGreaterThan(0);
    expect(res.iterations).toBeLessThan(100);
  });

  it('terminates at maxIterations without converging when starved of iterations', () => {
    const pairs: Array<readonly [string, string]> = [];
    // Deeply asymmetric: a long chain plus a back-edge, so the distribution
    // keeps shifting for many iterations.
    for (let i = 0; i < 39; i++) pairs.push([`src/f${i}.ts`, `src/f${i + 1}.ts`]);
    pairs.push(['src/f39.ts', 'src/f0.ts']);
    pairs.push(['src/f5.ts', 'src/f0.ts']);
    const res = rankGraph(importsGraph(pairs), { maxIterations: 2, tolerance: 1e-18 });
    expect(res.converged).toBe(false);
    expect(res.iterations).toBe(2);
    expect(res.fileRank.size).toBe(40);
  });

  it('is deterministic: two runs on the same input give identical numbers', () => {
    const graph = callsGraph([
      ['src/a.ts', 'src/b.ts', 'calculateInvoiceTotal'],
      ['src/b.ts', 'src/c.ts', 'run'],
      ['src/c.ts', 'src/a.ts', '_secret'],
      ['src/d.ts', 'src/a.ts', 'load_config'],
    ]);
    const opts = { seedFiles: ['src/a.ts'], mentionedIdents: ['run'] };
    const first = rankGraph(graph, opts);
    const second = rankGraph(graph, opts);
    expect([...second.fileRank.entries()]).toEqual([...first.fileRank.entries()]);
    expect([...second.symbolRank.entries()]).toEqual([...first.symbolRank.entries()]);
    expect(second.iterations).toBe(first.iterations);
  });

  it('handles 10k nodes / 50k edges quickly', () => {
    const fileCount = 10_000;
    const nodes: SprangNode[] = [];
    for (let i = 0; i < fileCount; i++) nodes.push(fileNode(`src/mod${i}/file${i}.ts`));
    const edges: SprangEdge[] = [];
    for (let i = 0; i < 50_000; i++) {
      const from = i % fileCount;
      const to = (from * 7 + (i % 13) + 1) % fileCount;
      if (from === to) continue;
      const ident = `symbol${to % 500}`;
      const target = `function:src/mod${to}/file${to}.ts:${ident}`;
      if (i % 5 === 0) nodes.push(funcNode(`src/mod${to}/file${to}.ts`, ident));
      edges.push({ source: `file:src/mod${from}/file${from}.ts`, target, type: 'calls' });
    }
    const graph = makeGraph(nodes, edges);

    const start = Date.now();
    const res = rankGraph(graph, { seedFiles: ['src/mod0/file0.ts'] });
    const elapsed = Date.now() - start;

    expect(res.fileRank.size).toBe(fileCount);
    expect(sum(res.fileRank.values())).toBeCloseTo(1, 6);
    expect(elapsed).toBeLessThan(2000);
  });
});
