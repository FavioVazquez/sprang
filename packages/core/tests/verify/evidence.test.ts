import { describe, it, expect } from 'vitest';
import { buildEvidenceMatrix } from '../../src/verify/evidence.js';
import type { EvidenceRow, EvidenceVerdict } from '../../src/verify/evidence.js';
import type { FileCoverage } from '../../src/verify/coverage.js';
import type { KnowledgeGraph, SprangEdge, SprangNode } from '../../src/schema/types.js';

// ─── fixtures ────────────────────────────────────────────────────────────────

interface NodeOpts {
  revisions?: number;
  ageMonths?: number;
  lastChange?: string;
  /** Write a `behavioral` blob with none of the fields this module reads. */
  emptyBehavioral?: boolean;
  /** Omit any location so the node must be skipped. */
  noLocation?: boolean;
}

function fileNode(path: string, opts: NodeOpts = {}): SprangNode {
  const behavioral: Record<string, unknown> = {};
  if (opts.revisions !== undefined) behavioral['revisions'] = opts.revisions;
  if (opts.ageMonths !== undefined) behavioral['age_months'] = opts.ageMonths;
  if (opts.lastChange !== undefined) behavioral['last_change'] = opts.lastChange;
  if (opts.emptyBehavioral === true) behavioral['main_developer'] = 'ada';

  const node: SprangNode = {
    id: opts.noLocation === true ? `orphan:${path}` : `file:${path}`,
    type: 'file',
    name: path,
    label: path,
  };
  if (opts.noLocation !== true) node.filePath = path;
  if (Object.keys(behavioral).length > 0) node.metadata = { behavioral };
  return node;
}

function edge(from: string, to: string, extra: Partial<SprangEdge> = {}): SprangEdge {
  return { source: `file:${from}`, target: `file:${to}`, type: 'imports', ...extra };
}

function graphOf(nodes: SprangNode[], edges: SprangEdge[] = []): KnowledgeGraph {
  return {
    version: '1.0.0',
    generated_at: '2024-01-01T00:00:00.000Z',
    project_root: '/repo',
    project_name: 'demo',
    phase: 'complete',
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

function cov(path: string, percent: number, linesTotal = 100): FileCoverage {
  const linesCovered = Math.round((percent / 100) * linesTotal);
  const uncoveredLines: number[] = [];
  for (let i = linesCovered + 1; i <= linesTotal; i++) uncoveredLines.push(i);
  return { path, linesCovered, linesTotal, percent, uncoveredLines };
}

function rowFor(rows: EvidenceRow[], path: string): EvidenceRow {
  const row = rows.find((r) => r.path === path);
  if (row === undefined) throw new Error(`no row for ${path}; got ${rows.map((r) => r.path).join(', ')}`);
  return row;
}

function verdictOf(
  graph: KnowledgeGraph,
  coverage: FileCoverage[] | undefined,
  path: string,
): EvidenceVerdict {
  return rowFor(buildEvidenceMatrix(graph, coverage).rows, path).verdict;
}

/** Referenced + live + barely executed: the exact `untested-but-live` shape. */
function headlineGraph(overrides: NodeOpts = {}): KnowledgeGraph {
  return graphOf(
    [
      fileNode('src/a.ts', { revisions: 4, ageMonths: 1, lastChange: '2026-05-01', ...overrides }),
      fileNode('src/caller.ts', { revisions: 3, ageMonths: 1 }),
    ],
    [edge('src/caller.ts', 'src/a.ts')],
  );
}

const HEADLINE_COVERAGE = [cov('src/a.ts', 10), cov('src/caller.ts', 90)];

// ─── the empty / degenerate cases ────────────────────────────────────────────

describe('guards', () => {
  it('handles a graph with no nodes at all', () => {
    const matrix = buildEvidenceMatrix(graphOf([]));
    expect(matrix.rows).toEqual([]);
    expect(matrix.completeness).toBe(0);
    expect(matrix.counts).toEqual({
      'untested-but-live': 0,
      'dead-and-untested': 0,
      'covered-but-unreferenced': 0,
      'well-covered': 0,
      unknown: 0,
    });
    expect(matrix.caveats.join(' ')).toContain('matrix is empty');
  });

  it('handles an empty coverage array like no coverage at all', () => {
    const matrix = buildEvidenceMatrix(headlineGraph(), []);
    expect(rowFor(matrix.rows, 'src/a.ts').verdict).toBe('unknown');
    expect(matrix.caveats.join(' ')).toContain('No coverage data was supplied');
  });

  it('skips nodes with no resolvable location and says so', () => {
    const matrix = buildEvidenceMatrix(graphOf([fileNode('src/a.ts'), fileNode('ghost.ts', { noLocation: true })]));
    expect(matrix.rows.map((r) => r.path)).toEqual(['src/a.ts']);
    expect(matrix.caveats.join(' ')).toContain('no file location');
  });

  it('ignores a coverage entry for a file that is not in the graph', () => {
    const matrix = buildEvidenceMatrix(headlineGraph(), [
      ...HEADLINE_COVERAGE,
      cov('src/not-in-graph.ts', 100),
    ]);
    expect(matrix.rows.map((r) => r.path)).toEqual(['src/a.ts', 'src/caller.ts']);
  });

  it('never throws on a graph with edges pointing at unknown node ids', () => {
    const graph = graphOf([fileNode('src/a.ts', { revisions: 2, ageMonths: 1 })], [
      { source: 'file:nowhere.ts', target: 'file:src/a.ts', type: 'imports' },
      { source: 'file:src/a.ts', target: 'file:nowhere.ts', type: 'calls' },
    ]);
    const matrix = buildEvidenceMatrix(graph, [cov('src/a.ts', 10)]);
    // The edge exists, so static data is "available", but it resolves to no
    // file, so `src/a.ts` still has zero known referrers.
    expect(rowFor(matrix.rows, 'src/a.ts').staticRefs).toBe(0);
  });

  it('does not count a self-edge inside one file as a reference', () => {
    const graph = graphOf(
      [fileNode('src/a.ts', { revisions: 3, ageMonths: 1 }), fileNode('src/b.ts')],
      [edge('src/a.ts', 'src/a.ts', { type: 'calls' }), edge('src/b.ts', 'src/b.ts')],
    );
    expect(rowFor(buildEvidenceMatrix(graph, [cov('src/a.ts', 5)]).rows, 'src/a.ts').staticRefs).toBe(0);
  });

  it('counts distinct referring files, not edges', () => {
    const graph = graphOf(
      [fileNode('src/a.ts'), fileNode('src/caller.ts')],
      [
        edge('src/caller.ts', 'src/a.ts'),
        edge('src/caller.ts', 'src/a.ts', { type: 'calls' }),
        edge('src/caller.ts', 'src/a.ts', { type: 'calls' }),
      ],
    );
    expect(rowFor(buildEvidenceMatrix(graph).rows, 'src/a.ts').staticRefs).toBe(1);
  });

  it('ignores non-dependency edge types when counting references', () => {
    const graph = graphOf(
      [fileNode('src/a.ts'), fileNode('src/caller.ts')],
      [edge('src/caller.ts', 'src/a.ts', { type: 'related' })],
    );
    const matrix = buildEvidenceMatrix(graph);
    expect(rowFor(matrix.rows, 'src/a.ts').staticRefs).toBe(0);
    expect(matrix.caveats.join(' ')).toContain('no import or call edges');
  });
});

// ─── untested-but-live: the headline, and its four conditions ────────────────

describe('untested-but-live', () => {
  it('fires when all four conditions hold', () => {
    const matrix = buildEvidenceMatrix(headlineGraph(), HEADLINE_COVERAGE);
    const row = rowFor(matrix.rows, 'src/a.ts');
    expect(row.verdict).toBe('untested-but-live');
    expect(row.staticRefs).toBe(1);
    expect(row.coveredPercent).toBe(10);
    expect(row.revisions).toBe(4);
    expect(row.ageMonths).toBe(1);
  });

  it('does not fire without an incoming reference', () => {
    const graph = graphOf([
      fileNode('src/a.ts', { revisions: 4, ageMonths: 1 }),
      fileNode('src/caller.ts'),
    ], [edge('src/caller.ts', 'src/other.ts')]);
    expect(verdictOf(graph, [cov('src/a.ts', 10)], 'src/a.ts')).not.toBe('untested-but-live');
  });

  it('does not fire with only one revision', () => {
    expect(verdictOf(headlineGraph({ revisions: 1 }), HEADLINE_COVERAGE, 'src/a.ts')).toBe('unknown');
  });

  it('does not fire when the file is older than staleMonths', () => {
    expect(verdictOf(headlineGraph({ ageMonths: 24 }), HEADLINE_COVERAGE, 'src/a.ts')).toBe('unknown');
  });

  it('does not fire when coverage is absent for the file', () => {
    const matrix = buildEvidenceMatrix(headlineGraph(), [cov('src/caller.ts', 90)]);
    const row = rowFor(matrix.rows, 'src/a.ts');
    expect(row.verdict).toBe('unknown');
    expect(row.coveredPercent).toBeUndefined();
  });

  it('does not fire when coverage is at or above the threshold', () => {
    expect(verdictOf(headlineGraph(), [cov('src/a.ts', 50), cov('src/caller.ts', 90)], 'src/a.ts')).toBe(
      'well-covered',
    );
  });

  it('does not fire when history is missing entirely', () => {
    const graph = graphOf(
      [fileNode('src/a.ts'), fileNode('src/caller.ts')],
      [edge('src/caller.ts', 'src/a.ts')],
    );
    const row = rowFor(buildEvidenceMatrix(graph, [cov('src/a.ts', 10)]).rows, 'src/a.ts');
    expect(row.verdict).toBe('unknown');
    expect(row.reason).toContain('no git history');
  });

  it('treats a behavioural blob with no revisions or age as no history', () => {
    const graph = graphOf(
      [fileNode('src/a.ts', { emptyBehavioral: true }), fileNode('src/caller.ts')],
      [edge('src/caller.ts', 'src/a.ts')],
    );
    const row = rowFor(buildEvidenceMatrix(graph, [cov('src/a.ts', 10)]).rows, 'src/a.ts');
    expect(row.revisions).toBeUndefined();
    expect(row.verdict).toBe('unknown');
  });

  it('respects a custom staleMonths window', () => {
    const graph = headlineGraph({ revisions: 4, ageMonths: 9 });
    expect(buildEvidenceMatrix(graph, HEADLINE_COVERAGE).rows.find((r) => r.path === 'src/a.ts')?.verdict).toBe(
      'unknown',
    );
    expect(
      buildEvidenceMatrix(graph, HEADLINE_COVERAGE, { staleMonths: 12 }).rows.find((r) => r.path === 'src/a.ts')
        ?.verdict,
    ).toBe('untested-but-live');
  });

  it('respects a custom minCoveredPercent', () => {
    const coverage = [cov('src/a.ts', 60), cov('src/caller.ts', 90)];
    expect(verdictOf(headlineGraph(), coverage, 'src/a.ts')).toBe('well-covered');
    expect(
      buildEvidenceMatrix(headlineGraph(), coverage, { minCoveredPercent: 80 }).rows.find(
        (r) => r.path === 'src/a.ts',
      )?.verdict,
    ).toBe('untested-but-live');
  });

  it('mentions the uncovered line count in the reason when known', () => {
    const row = rowFor(buildEvidenceMatrix(headlineGraph(), HEADLINE_COVERAGE).rows, 'src/a.ts');
    expect(row.reason).toContain('lines never ran');
  });
});

// ─── dead-and-untested ───────────────────────────────────────────────────────

describe('dead-and-untested', () => {
  const deadGraph = (opts: NodeOpts = {}): KnowledgeGraph =>
    graphOf(
      [
        fileNode('src/dead.ts', { revisions: 3, ageMonths: 30, lastChange: '2020-01-01', ...opts }),
        fileNode('src/caller.ts', { revisions: 2, ageMonths: 1 }),
        fileNode('src/live.ts', { revisions: 2, ageMonths: 1 }),
      ],
      [edge('src/caller.ts', 'src/live.ts')],
    );
  const deadCoverage = [cov('src/dead.ts', 0), cov('src/caller.ts', 80), cov('src/live.ts', 80)];

  it('fires with no references, zero execution and an old last change', () => {
    const row = rowFor(buildEvidenceMatrix(deadGraph(), deadCoverage).rows, 'src/dead.ts');
    expect(row.verdict).toBe('dead-and-untested');
    expect(row.staticRefs).toBe(0);
    expect(row.coveredPercent).toBe(0);
  });

  it('does not fire when something references the file', () => {
    const graph = graphOf(
      [
        fileNode('src/dead.ts', { revisions: 3, ageMonths: 30 }),
        fileNode('src/caller.ts', { revisions: 2, ageMonths: 1 }),
      ],
      [edge('src/caller.ts', 'src/dead.ts')],
    );
    expect(verdictOf(graph, [cov('src/dead.ts', 0), cov('src/caller.ts', 80)], 'src/dead.ts')).not.toBe(
      'dead-and-untested',
    );
  });

  it('does not fire when any line was executed', () => {
    const coverage = [cov('src/dead.ts', 1), cov('src/caller.ts', 80), cov('src/live.ts', 80)];
    expect(verdictOf(deadGraph(), coverage, 'src/dead.ts')).toBe('unknown');
  });

  it('does not fire when the file changed recently', () => {
    expect(verdictOf(deadGraph({ ageMonths: 1 }), deadCoverage, 'src/dead.ts')).toBe('unknown');
  });

  it('does not fire when coverage is absent for the file', () => {
    const coverage = [cov('src/caller.ts', 80), cov('src/live.ts', 80)];
    const row = rowFor(buildEvidenceMatrix(deadGraph(), coverage).rows, 'src/dead.ts');
    expect(row.verdict).toBe('unknown');
    expect(row.reason).toContain('No coverage entry');
  });

  it('does not fire when there is no history to prove dormancy', () => {
    const graph = graphOf(
      [fileNode('src/dead.ts'), fileNode('src/caller.ts'), fileNode('src/live.ts')],
      [edge('src/caller.ts', 'src/live.ts')],
    );
    const row = rowFor(buildEvidenceMatrix(graph, deadCoverage).rows, 'src/dead.ts');
    expect(row.verdict).toBe('unknown');
    expect(row.reason).toContain('abandoned or simply new');
  });

  it('advises checking dynamic entry points', () => {
    const row = rowFor(buildEvidenceMatrix(deadGraph(), deadCoverage).rows, 'src/dead.ts');
    expect(row.reason).toContain('dynamic entry points');
  });
});

// ─── covered-but-unreferenced ────────────────────────────────────────────────

describe('covered-but-unreferenced', () => {
  const graph = graphOf(
    [
      fileNode('src/helper.ts', { revisions: 3, ageMonths: 1 }),
      fileNode('src/caller.ts', { revisions: 2, ageMonths: 1 }),
      fileNode('src/live.ts', { revisions: 2, ageMonths: 1 }),
    ],
    [edge('src/caller.ts', 'src/live.ts')],
  );

  it('fires when the suite executes it but nothing references it', () => {
    const coverage = [cov('src/helper.ts', 95), cov('src/caller.ts', 95), cov('src/live.ts', 95)];
    const row = rowFor(buildEvidenceMatrix(graph, coverage).rows, 'src/helper.ts');
    expect(row.verdict).toBe('covered-but-unreferenced');
    expect(row.staticRefs).toBe(0);
  });

  it('does not fire when a reference exists', () => {
    const coverage = [cov('src/live.ts', 95), cov('src/caller.ts', 95), cov('src/helper.ts', 95)];
    expect(verdictOf(graph, coverage, 'src/live.ts')).toBe('well-covered');
  });

  it('does not fire below the coverage threshold', () => {
    const coverage = [cov('src/helper.ts', 20), cov('src/caller.ts', 95), cov('src/live.ts', 95)];
    expect(verdictOf(graph, coverage, 'src/helper.ts')).toBe('unknown');
  });

  it('suggests moving it into the test tree', () => {
    const coverage = [cov('src/helper.ts', 95), cov('src/caller.ts', 95), cov('src/live.ts', 95)];
    expect(rowFor(buildEvidenceMatrix(graph, coverage).rows, 'src/helper.ts').reason).toContain('move it there');
  });
});

// ─── well-covered ────────────────────────────────────────────────────────────

describe('well-covered', () => {
  it('fires when referenced and executed at or above the threshold', () => {
    const row = rowFor(
      buildEvidenceMatrix(headlineGraph(), [cov('src/a.ts', 88), cov('src/caller.ts', 88)]).rows,
      'src/a.ts',
    );
    expect(row.verdict).toBe('well-covered');
    expect(row.reason).toContain('Execution is not assertion');
  });

  it('is exactly inclusive at the threshold', () => {
    expect(verdictOf(headlineGraph(), [cov('src/a.ts', 50), cov('src/caller.ts', 88)], 'src/a.ts')).toBe(
      'well-covered',
    );
    expect(verdictOf(headlineGraph(), [cov('src/a.ts', 49), cov('src/caller.ts', 88)], 'src/a.ts')).toBe(
      'untested-but-live',
    );
  });

  it('needs no history at all', () => {
    const graph = graphOf(
      [fileNode('src/a.ts'), fileNode('src/caller.ts')],
      [edge('src/caller.ts', 'src/a.ts')],
    );
    const row = rowFor(buildEvidenceMatrix(graph, [cov('src/a.ts', 99)]).rows, 'src/a.ts');
    expect(row.verdict).toBe('well-covered');
    expect(row.revisions).toBeUndefined();
  });
});

// ─── unknown: the honest default ─────────────────────────────────────────────

describe('unknown', () => {
  it('is used for every file when no coverage argument is passed', () => {
    const matrix = buildEvidenceMatrix(headlineGraph());
    expect(matrix.rows.every((r) => r.verdict === 'unknown')).toBe(true);
    expect(matrix.counts.unknown).toBe(matrix.rows.length);
  });

  it('never labels an uncovered-by-omission file as unexecuted', () => {
    const row = rowFor(buildEvidenceMatrix(headlineGraph()).rows, 'src/a.ts');
    expect(row.reason).toContain('unknown');
    expect(row.coveredPercent).toBeUndefined();
  });

  it('is used when the graph has coverage but no dependency edges', () => {
    const graph = graphOf([fileNode('src/a.ts', { revisions: 5, ageMonths: 1 })]);
    const row = rowFor(buildEvidenceMatrix(graph, [cov('src/a.ts', 5)]).rows, 'src/a.ts');
    expect(row.verdict).toBe('unknown');
    expect(row.reason).toContain('not analysed');
  });

  it('is used for partial execution with no callers', () => {
    const graph = graphOf(
      [
        fileNode('src/x.ts', { revisions: 2, ageMonths: 1 }),
        fileNode('src/caller.ts'),
        fileNode('src/live.ts'),
      ],
      [edge('src/caller.ts', 'src/live.ts')],
    );
    const row = rowFor(buildEvidenceMatrix(graph, [cov('src/x.ts', 20)]).rows, 'src/x.ts');
    expect(row.verdict).toBe('unknown');
    expect(row.reason).toContain('ambiguous');
  });

  it('is used for an unreferenced, unexecuted but brand new file', () => {
    const graph = graphOf(
      [
        fileNode('src/new.ts', { revisions: 1, ageMonths: 0 }),
        fileNode('src/caller.ts'),
        fileNode('src/live.ts'),
      ],
      [edge('src/caller.ts', 'src/live.ts')],
    );
    const row = rowFor(buildEvidenceMatrix(graph, [cov('src/new.ts', 0)]).rows, 'src/new.ts');
    expect(row.verdict).toBe('unknown');
    expect(row.reason).toContain('more likely new than dead');
  });
});

// ─── test files ──────────────────────────────────────────────────────────────

describe('test files', () => {
  it('excludes test files from the rows', () => {
    const graph = graphOf([
      fileNode('src/a.ts'),
      fileNode('tests/verify/a.test.ts'),
      fileNode('src/b.spec.ts'),
      fileNode('src/__tests__/c.ts'),
    ]);
    expect(buildEvidenceMatrix(graph).rows.map((r) => r.path)).toEqual(['src/a.ts']);
  });

  it('still counts references coming from test files', () => {
    const graph = graphOf(
      [fileNode('src/a.ts', { revisions: 3, ageMonths: 1 }), fileNode('tests/a.test.ts')],
      [edge('tests/a.test.ts', 'src/a.ts')],
    );
    expect(rowFor(buildEvidenceMatrix(graph).rows, 'src/a.ts').staticRefs).toBe(1);
  });

  it('does not let an excluded test file affect completeness', () => {
    const graph = graphOf([
      fileNode('src/a.ts', { revisions: 2, ageMonths: 1 }),
      fileNode('tests/a.test.ts'),
      fileNode('src/caller.ts', { revisions: 2, ageMonths: 1 }),
    ], [edge('src/caller.ts', 'src/a.ts')]);
    const matrix = buildEvidenceMatrix(graph, [cov('src/a.ts', 10), cov('src/caller.ts', 90)]);
    expect(matrix.rows).toHaveLength(2);
    expect(matrix.completeness).toBe(1);
  });
});

// ─── completeness ────────────────────────────────────────────────────────────

describe('completeness', () => {
  it('is 0 when there is no coverage at all', () => {
    expect(buildEvidenceMatrix(headlineGraph()).completeness).toBe(0);
  });

  it('is 0 when there are no rows', () => {
    expect(buildEvidenceMatrix(graphOf([])).completeness).toBe(0);
  });

  it('is 1 when all three sources exist for every file', () => {
    expect(buildEvidenceMatrix(headlineGraph(), HEADLINE_COVERAGE).completeness).toBe(1);
  });

  it('is partial when one of three files lacks history', () => {
    const graph = graphOf(
      [
        fileNode('src/a.ts', { revisions: 2, ageMonths: 1 }),
        fileNode('src/b.ts', { revisions: 2, ageMonths: 1 }),
        fileNode('src/caller.ts'),
      ],
      [edge('src/caller.ts', 'src/a.ts')],
    );
    const coverage = [cov('src/a.ts', 90), cov('src/b.ts', 90), cov('src/caller.ts', 90)];
    expect(buildEvidenceMatrix(graph, coverage).completeness).toBe(0.67);
  });

  it('is 0 when static evidence is missing even though the other two exist', () => {
    const graph = graphOf([fileNode('src/a.ts', { revisions: 2, ageMonths: 1 })]);
    expect(buildEvidenceMatrix(graph, [cov('src/a.ts', 90)]).completeness).toBe(0);
  });

  it('drops when coverage does not mention a file', () => {
    const graph = graphOf(
      [
        fileNode('src/a.ts', { revisions: 2, ageMonths: 1 }),
        fileNode('src/caller.ts', { revisions: 2, ageMonths: 1 }),
      ],
      [edge('src/caller.ts', 'src/a.ts')],
    );
    expect(buildEvidenceMatrix(graph, [cov('src/a.ts', 90)]).completeness).toBe(0.5);
  });
});

// ─── caveats ─────────────────────────────────────────────────────────────────

describe('caveats', () => {
  it('names missing coverage data', () => {
    expect(buildEvidenceMatrix(headlineGraph()).caveats.join('\n')).toContain(
      'No coverage data was supplied',
    );
  });

  it('names unreliable coverage matching when most paths do not match', () => {
    const coverage = [
      cov('src/a.ts', 10),
      cov('vendor/one.ts', 10),
      cov('vendor/two.ts', 10),
      cov('vendor/three.ts', 10),
    ];
    const caveats = buildEvidenceMatrix(headlineGraph(), coverage).caveats.join('\n');
    expect(caveats).toContain('fewer than 90%');
    expect(caveats).toContain('never compared');
  });

  it('names files that had no coverage entry', () => {
    expect(buildEvidenceMatrix(headlineGraph(), [cov('src/a.ts', 10)]).caveats.join('\n')).toContain(
      '1 of 2 files have no coverage entry',
    );
  });

  it('names a total absence of behavioural data', () => {
    const graph = graphOf([fileNode('src/a.ts'), fileNode('src/b.ts')]);
    expect(buildEvidenceMatrix(graph).caveats.join('\n')).toContain(
      'No behavioural (git history) data is present on any file node',
    );
  });

  it('names partially missing behavioural data', () => {
    const graph = graphOf([fileNode('src/a.ts', { revisions: 2, ageMonths: 1 }), fileNode('src/b.ts')]);
    const caveats = buildEvidenceMatrix(graph).caveats.join('\n');
    expect(caveats).toContain('1 of 2 files carry no behavioural');
    expect(caveats).not.toContain('any file node');
  });

  it('names an absence of import and call edges', () => {
    expect(buildEvidenceMatrix(graphOf([fileNode('src/a.ts')])).caveats.join('\n')).toContain(
      'no import or call edges',
    );
  });

  it('names low-confidence call edges', () => {
    const graph = graphOf(
      [fileNode('src/a.ts'), fileNode('src/caller.ts')],
      [edge('src/caller.ts', 'src/a.ts', { type: 'calls', confidence: 0.3 })],
    );
    expect(buildEvidenceMatrix(graph).caveats.join('\n')).toContain('low');
    expect(buildEvidenceMatrix(graph).caveats.join('\n')).toContain('overstated');
  });

  it('treats ambiguous resolution as low confidence even without a number', () => {
    const graph = graphOf(
      [fileNode('src/a.ts'), fileNode('src/caller.ts')],
      [edge('src/caller.ts', 'src/a.ts', { type: 'calls', resolution: 'imported-ambiguous' })],
    );
    expect(buildEvidenceMatrix(graph).caveats.join('\n')).toContain('ambiguous resolution');
  });

  it('does not complain about confidence when every edge is confident', () => {
    const graph = graphOf(
      [fileNode('src/a.ts'), fileNode('src/caller.ts')],
      [edge('src/caller.ts', 'src/a.ts', { type: 'calls', confidence: 0.95, resolution: 'same-file' })],
    );
    expect(buildEvidenceMatrix(graph).caveats.join('\n')).not.toContain('overstated');
  });

  it('flags a thin matrix as advisory', () => {
    expect(buildEvidenceMatrix(headlineGraph()).caveats.join('\n')).toContain(
      'list of questions, not a list of conclusions',
    );
  });

  it('does not flag a complete matrix as advisory', () => {
    const matrix = buildEvidenceMatrix(headlineGraph(), HEADLINE_COVERAGE);
    expect(matrix.completeness).toBe(1);
    expect(matrix.caveats.join('\n')).not.toContain('list of questions');
  });
});

// ─── refConfidence ───────────────────────────────────────────────────────────

describe('refConfidence', () => {
  it('reports the weakest confidence among incoming edges', () => {
    const graph = graphOf(
      [fileNode('src/a.ts'), fileNode('src/c1.ts'), fileNode('src/c2.ts')],
      [
        edge('src/c1.ts', 'src/a.ts', { type: 'calls', confidence: 0.9 }),
        edge('src/c2.ts', 'src/a.ts', { type: 'calls', confidence: 0.4 }),
      ],
    );
    expect(rowFor(buildEvidenceMatrix(graph).rows, 'src/a.ts').refConfidence).toBe(0.4);
  });

  it('is absent when no incoming edge records a confidence', () => {
    const graph = graphOf(
      [fileNode('src/a.ts'), fileNode('src/caller.ts')],
      [edge('src/caller.ts', 'src/a.ts')],
    );
    expect(rowFor(buildEvidenceMatrix(graph).rows, 'src/a.ts').refConfidence).toBeUndefined();
  });
});

// ─── ordering, counts, determinism ───────────────────────────────────────────

describe('ordering and determinism', () => {
  const mixedGraph = graphOf(
    [
      fileNode('src/z-live.ts', { revisions: 5, ageMonths: 1 }),
      fileNode('src/a-live.ts', { revisions: 5, ageMonths: 1 }),
      fileNode('src/dead.ts', { revisions: 2, ageMonths: 40 }),
      fileNode('src/helper.ts', { revisions: 2, ageMonths: 1 }),
      fileNode('src/caller.ts', { revisions: 2, ageMonths: 1 }),
      fileNode('src/mystery.ts', { revisions: 2, ageMonths: 1 }),
    ],
    [edge('src/caller.ts', 'src/z-live.ts'), edge('src/caller.ts', 'src/a-live.ts')],
  );
  const mixedCoverage = [
    cov('src/z-live.ts', 5),
    cov('src/a-live.ts', 5),
    cov('src/dead.ts', 0),
    cov('src/helper.ts', 90),
    cov('src/caller.ts', 90),
  ];

  it('orders by verdict priority, then path', () => {
    const rows = buildEvidenceMatrix(mixedGraph, mixedCoverage).rows;
    expect(rows.map((r) => `${r.verdict}:${r.path}`)).toEqual([
      'untested-but-live:src/a-live.ts',
      'untested-but-live:src/z-live.ts',
      'dead-and-untested:src/dead.ts',
      'covered-but-unreferenced:src/caller.ts',
      'covered-but-unreferenced:src/helper.ts',
      'unknown:src/mystery.ts',
    ]);
  });

  it('counts every verdict, including zeroes', () => {
    const matrix = buildEvidenceMatrix(mixedGraph, mixedCoverage);
    expect(matrix.counts).toEqual({
      'untested-but-live': 2,
      'dead-and-untested': 1,
      'covered-but-unreferenced': 2,
      'well-covered': 0,
      unknown: 1,
    });
    expect(Object.values(matrix.counts).reduce((a, b) => a + b, 0)).toBe(matrix.rows.length);
  });

  it('is byte-identical across repeated builds', () => {
    const a = JSON.stringify(buildEvidenceMatrix(mixedGraph, mixedCoverage));
    const b = JSON.stringify(buildEvidenceMatrix(mixedGraph, mixedCoverage));
    expect(a).toBe(b);
  });

  it('is independent of node and coverage input order', () => {
    const reversed = graphOf([...mixedGraph.nodes].reverse(), [...mixedGraph.edges].reverse());
    const a = JSON.stringify(buildEvidenceMatrix(mixedGraph, mixedCoverage));
    const b = JSON.stringify(buildEvidenceMatrix(reversed, [...mixedCoverage].reverse()));
    expect(b).toBe(a);
  });

  it('normalises backslash and ./ paths so they do not produce duplicate rows', () => {
    const graph = graphOf([fileNode('./src/a.ts'), fileNode('src\\a.ts')]);
    expect(buildEvidenceMatrix(graph).rows.map((r) => r.path)).toEqual(['src/a.ts']);
  });
});

// ─── the honesty invariant ───────────────────────────────────────────────────

describe('never claims anything was tested', () => {
  /** Every string this module can emit, across every verdict. */
  function allEmittedStrings(): string[] {
    const strings: string[] = [];
    const graphs: Array<[KnowledgeGraph, FileCoverage[] | undefined]> = [
      [headlineGraph(), HEADLINE_COVERAGE],
      [headlineGraph(), undefined],
      [headlineGraph(), []],
      [headlineGraph({ revisions: 1 }), HEADLINE_COVERAGE],
      [headlineGraph({ ageMonths: 40 }), HEADLINE_COVERAGE],
      [headlineGraph(), [cov('src/a.ts', 100), cov('src/caller.ts', 100)]],
      [graphOf([]), undefined],
      [graphOf([fileNode('src/a.ts')]), [cov('src/a.ts', 0)]],
      [
        graphOf(
          [
            fileNode('src/dead.ts', { revisions: 2, ageMonths: 40, lastChange: '2019-01-01' }),
            fileNode('src/helper.ts', { revisions: 2, ageMonths: 1 }),
            fileNode('src/caller.ts', { revisions: 2, ageMonths: 1 }),
            fileNode('src/live.ts', { revisions: 2, ageMonths: 1 }),
            fileNode('src/partial.ts', { revisions: 2, ageMonths: 1 }),
            fileNode('src/new.ts', { revisions: 1, ageMonths: 0 }),
            fileNode('ghost', { noLocation: true }),
          ],
          [
            edge('src/caller.ts', 'src/live.ts', { type: 'calls', confidence: 0.2 }),
            edge('src/caller.ts', 'vendor/x.ts', { resolution: 'imported-ambiguous' }),
          ],
        ),
        [
          cov('src/dead.ts', 0),
          cov('src/helper.ts', 95),
          cov('src/caller.ts', 95),
          cov('src/live.ts', 95),
          cov('src/partial.ts', 20),
          cov('src/new.ts', 0),
        ],
      ],
    ];
    for (const [graph, coverage] of graphs) {
      const matrix = buildEvidenceMatrix(graph, coverage);
      for (const row of matrix.rows) strings.push(row.reason);
      strings.push(...matrix.caveats);
    }
    return strings;
  }

  it('exercises every verdict in the corpus below', () => {
    const seen = new Set<EvidenceVerdict>();
    for (const [graph, coverage] of [
      [headlineGraph(), HEADLINE_COVERAGE],
      [headlineGraph(), undefined],
    ] as Array<[KnowledgeGraph, FileCoverage[] | undefined]>) {
      for (const row of buildEvidenceMatrix(graph, coverage).rows) seen.add(row.verdict);
    }
    expect(seen.has('untested-but-live')).toBe(true);
    expect(seen.has('unknown')).toBe(true);
  });

  it('emits no reason or caveat containing the word "tested"', () => {
    const offenders = allEmittedStrings().filter((s) => /tested/i.test(s));
    expect(offenders).toEqual([]);
  });

  it('emits no reason or caveat claiming a test "verifies" or "proves" behaviour', () => {
    const offenders = allEmittedStrings().filter((s) => /\b(proves|verifies|guarantees)\b/i.test(s));
    expect(offenders).toEqual([]);
  });

  it('says "executed" or "covered" wherever coverage is discussed', () => {
    const matrix = buildEvidenceMatrix(headlineGraph(), HEADLINE_COVERAGE);
    for (const row of matrix.rows) {
      if (row.coveredPercent === undefined) continue;
      expect(/executed|covered/i.test(row.reason)).toBe(true);
    }
  });

  it('emits a non-empty, sentence-shaped reason for every row', () => {
    for (const reason of allEmittedStrings()) {
      expect(reason.length).toBeGreaterThan(20);
      expect(reason.trim()).toBe(reason);
    }
  });
});
