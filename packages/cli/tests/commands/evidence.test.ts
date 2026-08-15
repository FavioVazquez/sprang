import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, '../../dist/index.js');

const created: string[] = [];

interface Result {
  code: number;
  stdout: string;
  stderr: string;
  all: string;
}

/** Colour codes are noise for assertions; JSON output contains none anyway. */
function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

function evidence(args: string[]): Result {
  const res = spawnSync('node', [CLI, 'evidence', ...args], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 60_000,
  });
  const stdout = stripAnsi(res.stdout ?? '');
  const stderr = stripAnsi(res.stderr ?? '');
  return { code: res.status ?? 1, stdout, stderr, all: stdout + stderr };
}

function tempProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'sprang-evidence-'));
  created.push(root);
  return root;
}

interface NodeSpec {
  file: string;
  revisions?: number;
  ageMonths?: number;
}

/**
 * A graph with real static edges and behavioural history, so every verdict is
 * reachable. Anything less and the matrix would only ever say "unknown".
 */
function writeGraph(root: string, files: NodeSpec[], edges: Array<[string, string]>): void {
  const now = new Date().toISOString();
  const nodes = files.map((spec) => ({
    id: `file:${spec.file}`,
    type: 'file',
    label: spec.file.slice(spec.file.lastIndexOf('/') + 1),
    filePath: spec.file,
    ...(spec.revisions === undefined && spec.ageMonths === undefined
      ? {}
      : {
          metadata: {
            behavioral: {
              ...(spec.revisions === undefined ? {} : { revisions: spec.revisions }),
              ...(spec.ageMonths === undefined ? {} : { age_months: spec.ageMonths }),
              last_change: '2024-01-01',
            },
          },
        }),
  }));
  const graph = {
    version: '1.0.0',
    generated_at: now,
    project_root: root,
    project_name: 'evidence-fixture',
    phase: 'complete',
    nodes,
    edges: edges.map(([from, to]) => ({
      source: `file:${from}`,
      target: `file:${to}`,
      type: 'imports',
      confidence: 1,
      resolution: 'imported-unique',
    })),
    layers: [],
    tours: [],
    domains: [],
    stats: {
      node_count: nodes.length,
      edge_count: edges.length,
      risk_summary: { high: 0, medium: 0, low: nodes.length },
      smell_summary: {},
      generated_at: now,
    },
  };
  mkdirSync(join(root, '.sprang'), { recursive: true });
  writeFileSync(join(root, '.sprang', 'knowledge-graph.json'), JSON.stringify(graph));
}

/** An lcov record: `covered` of `total` instrumented lines executed. */
function lcovRecord(path: string, covered: number, total: number): string {
  const lines: string[] = ['TN:', `SF:${path}`];
  for (let i = 1; i <= total; i++) lines.push(`DA:${i},${i <= covered ? 3 : 0}`);
  lines.push(`LF:${total}`, `LH:${covered}`, 'end_of_record');
  return lines.join('\n') + '\n';
}

/**
 * The standard fixture:
 *   src/live.ts  — referenced, churning, barely executed  → untested-but-live
 *   src/dead.ts  — unreferenced, never executed, dormant  → dead-and-untested
 *   src/good.ts  — referenced and executed                → well-covered
 *   src/app.ts   — executed but nothing references it     → covered-but-unreferenced
 */
function standardProject(): { root: string; lcov: string } {
  const root = tempProject();
  writeGraph(
    root,
    [
      { file: 'src/app.ts', revisions: 4, ageMonths: 1 },
      { file: 'src/live.ts', revisions: 7, ageMonths: 1 },
      { file: 'src/good.ts', revisions: 3, ageMonths: 2 },
      { file: 'src/dead.ts', revisions: 1, ageMonths: 30 },
    ],
    [
      ['src/app.ts', 'src/live.ts'],
      ['src/app.ts', 'src/good.ts'],
    ],
  );
  const lcov =
    lcovRecord('src/app.ts', 9, 10) +
    lcovRecord('src/live.ts', 1, 10) +
    lcovRecord('src/good.ts', 9, 10) +
    lcovRecord('src/dead.ts', 0, 10);
  return { root, lcov };
}

function withLcov(): string {
  const { root, lcov } = standardProject();
  writeFileSync(join(root, 'report.info'), lcov);
  return root;
}

beforeAll(() => {
  if (!existsSync(CLI)) throw new Error(`build the CLI first: ${CLI} missing`);
});

afterEach(() => {
  for (const dir of created.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* the OS will get it */
    }
  }
});

describe('sprang evidence', () => {
  it('exits 1 with a useful message when there is no graph', () => {
    const root = tempProject();
    const res = evidence([root]);
    expect(res.code).toBe(1);
    expect(res.stderr).toMatch(/No knowledge graph found/);
    expect(res.all).not.toMatch(/TypeError|SyntaxError|node:internal/);
  });

  it('runs without coverage and says every verdict will be unknown', () => {
    const { root } = standardProject();
    const res = evidence([root]);
    expect(res.code).toBe(0);
    expect(res.stdout).toMatch(/No coverage report found/);
    expect(res.stdout).toMatch(/will be "unknown"/);
    // The remedy has to be in the output, not in the docs.
    expect(res.stdout).toMatch(/pnpm vitest run --coverage/);
    expect(res.stdout).toMatch(/unknown\s+4/);
  });

  it('--json emits parseable JSON with the matrix and its caveats', () => {
    const { root } = standardProject();
    const res = evidence([root, '--json']);
    expect(res.code).toBe(0);
    const parsed = JSON.parse(res.stdout) as {
      completeness: number;
      caveats: string[];
      counts: Record<string, number>;
      rows: Array<{ path: string; verdict: string; reason: string }>;
      coverage: { source: string | null };
    };
    expect(typeof parsed.completeness).toBe('number');
    expect(Array.isArray(parsed.caveats)).toBe(true);
    expect(parsed.caveats.join(' ')).toMatch(/No coverage data was supplied/);
    expect(parsed.rows.map((r) => r.path).sort()).toEqual([
      'src/app.ts',
      'src/dead.ts',
      'src/good.ts',
      'src/live.ts',
    ]);
    expect(parsed.coverage.source).toBeNull();
  });

  it('--coverage with a real lcov report produces the four verdicts', () => {
    const root = withLcov();
    const res = evidence([root, '--coverage', 'report.info', '--json']);
    expect(res.code).toBe(0);
    const parsed = JSON.parse(res.stdout) as {
      counts: Record<string, number>;
      coverage: { format: string; entries: number };
      rows: Array<{ path: string; verdict: string; coveredPercent?: number }>;
    };
    expect(parsed.coverage.format).toBe('lcov');
    expect(parsed.coverage.entries).toBe(4);
    const byPath = new Map(parsed.rows.map((r) => [r.path, r.verdict]));
    expect(byPath.get('src/live.ts')).toBe('untested-but-live');
    expect(byPath.get('src/dead.ts')).toBe('dead-and-untested');
    expect(byPath.get('src/good.ts')).toBe('well-covered');
    expect(byPath.get('src/app.ts')).toBe('covered-but-unreferenced');
    expect(parsed.counts['untested-but-live']).toBe(1);
  });

  it('auto-detects coverage/lcov.info and says which file it used', () => {
    const { root, lcov } = standardProject();
    mkdirSync(join(root, 'coverage'), { recursive: true });
    writeFileSync(join(root, 'coverage', 'lcov.info'), lcov);
    const res = evidence([root]);
    expect(res.code).toBe(0);
    expect(res.stdout).toMatch(/Coverage: .*coverage\/lcov\.info \(lcov format\)/);
    expect(res.stdout).toMatch(/untested-but-live/);
  });

  it('falls back to lcov.info at the repository root', () => {
    const { root, lcov } = standardProject();
    writeFileSync(join(root, 'lcov.info'), lcov);
    const res = evidence([root, '--json']);
    const parsed = JSON.parse(res.stdout) as { coverage: { source: string | null } };
    expect(parsed.coverage.source).toMatch(/lcov\.info$/);
  });

  it('warns but does not fail when the coverage path cannot be read', () => {
    const { root } = standardProject();
    const res = evidence([root, '--coverage', 'does/not/exist.info']);
    expect(res.code).toBe(0);
    expect(res.stdout).toMatch(/Could not read the coverage report/);
    // Degrading honestly means still printing the matrix.
    expect(res.stdout).toMatch(/4 file\(s\) in the matrix/);
  });

  it('warns but does not fail on a malformed coverage report', () => {
    const { root } = standardProject();
    writeFileSync(join(root, 'junk.info'), 'this is not lcov and not xml\n');
    const res = evidence([root, '--coverage', 'junk.info']);
    expect(res.code).toBe(0);
    expect(res.stdout).toMatch(/not a recognisable lcov or cobertura report/);
    expect(res.all).not.toMatch(/TypeError|at Command/);
  });

  it('--fail-on-live exits 1 when a referenced, changing file was barely executed', () => {
    const root = withLcov();
    const res = evidence([root, '--coverage', 'report.info', '--fail-on-live']);
    expect(res.code).toBe(1);
    expect(res.stderr).toMatch(/untested-but-live|referenced and still/);
  });

  it('--fail-on-live exits 0 when no such file exists', () => {
    const root = tempProject();
    writeGraph(
      root,
      [
        { file: 'src/app.ts', revisions: 4, ageMonths: 1 },
        { file: 'src/good.ts', revisions: 3, ageMonths: 1 },
      ],
      [['src/app.ts', 'src/good.ts']],
    );
    writeFileSync(
      join(root, 'report.info'),
      lcovRecord('src/app.ts', 9, 10) + lcovRecord('src/good.ts', 10, 10),
    );
    const res = evidence([root, '--coverage', 'report.info', '--fail-on-live']);
    expect(res.code).toBe(0);
  });

  it('--fail-on-live still gates when --verdict hides the offending rows', () => {
    // Filtering the view must not filter the CI signal.
    const root = withLcov();
    const res = evidence([
      root,
      '--coverage',
      'report.info',
      '--verdict',
      'well-covered',
      '--fail-on-live',
    ]);
    expect(res.code).toBe(1);
  });

  it('--verdict shows only the requested verdict', () => {
    const root = withLcov();
    const res = evidence([root, '--coverage', 'report.info', '--verdict', 'dead-and-untested']);
    expect(res.code).toBe(0);
    expect(res.stdout).toMatch(/src\/dead\.ts/);
    expect(res.stdout).not.toMatch(/src\/good\.ts/);
  });

  it('says so when --verdict matches nothing instead of printing an empty list', () => {
    const { root } = standardProject();
    const res = evidence([root, '--verdict', 'well-covered']);
    expect(res.code).toBe(0);
    expect(res.stdout).toMatch(/No file has the verdict/);
  });

  it('rejects a --verdict that is not a verdict and lists the valid ones', () => {
    const { root } = standardProject();
    const res = evidence([root, '--verdict', 'flaky']);
    expect(res.code).toBe(1);
    expect(res.stderr).toMatch(/is not a verdict/);
    expect(res.stderr).toMatch(/untested-but-live/);
    expect(res.stderr).toMatch(/well-covered/);
  });

  it('prints completeness and every caveat before the rows', () => {
    // A report missing one file is the case where caveats matter most: the
    // missing file must not read as unexecuted.
    const { root, lcov } = standardProject();
    writeFileSync(
      join(root, 'partial.info'),
      lcov.split('SF:src/dead.ts')[0] ?? '',
    );
    const res = evidence([root, '--coverage', 'partial.info']);
    expect(res.stdout).toMatch(/have no coverage entry/);
    const completeness = res.stdout.indexOf('Completeness:');
    const caveats = res.stdout.indexOf('Caveats');
    const firstRow = res.stdout.indexOf('src/live.ts');
    expect(completeness).toBeGreaterThan(-1);
    expect(caveats).toBeGreaterThan(-1);
    expect(firstRow).toBeGreaterThan(-1);
    expect(completeness).toBeLessThan(firstRow);
    expect(caveats).toBeLessThan(firstRow);
  });

  it('never claims a file is tested — coverage is execution, not assertion', () => {
    const root = withLcov();
    const runs = [
      evidence([root, '--coverage', 'report.info']),
      evidence([root, '--coverage', 'report.info', '--json']),
      evidence([root]),
      evidence([root, '--verdict', 'flaky']),
    ];
    for (const run of runs) {
      // "untested-but-live" is a verdict name, so match the standalone word.
      expect(run.all).not.toMatch(/\btested\b/i);
    }
    // ...and the honest word is present.
    expect(runs[0]?.stdout).toMatch(/EXECUTED|executed/);
  });

  it('reports zero rows honestly on a graph with no files', () => {
    const root = tempProject();
    writeGraph(root, [], []);
    const res = evidence([root]);
    expect(res.code).toBe(0);
    expect(res.stdout).toMatch(/0 file\(s\) in the matrix/);
    expect(res.stdout).toMatch(/no rows/);
    expect(res.all).not.toMatch(/TypeError|NaN/);
  });

  it('skips test files rather than reporting them as findings', () => {
    const root = tempProject();
    writeGraph(
      root,
      [
        { file: 'src/app.ts', revisions: 4, ageMonths: 1 },
        { file: 'tests/app.test.ts', revisions: 4, ageMonths: 1 },
      ],
      [['tests/app.test.ts', 'src/app.ts']],
    );
    const res = evidence([root, '--json']);
    const parsed = JSON.parse(res.stdout) as { rows: Array<{ path: string }> };
    expect(parsed.rows.map((r) => r.path)).toEqual(['src/app.ts']);
  });

  it('honours --min-covered when deciding what counts as covered', () => {
    const root = withLcov();
    // good.ts is at 90%; raising the bar above that removes it from well-covered.
    const strict = evidence([root, '--coverage', 'report.info', '--min-covered', '95', '--json']);
    const parsed = JSON.parse(strict.stdout) as { counts: Record<string, number> };
    expect(parsed.counts['well-covered']).toBe(0);
    expect(parsed.counts['untested-but-live']).toBe(2);
  });

  it('honours --stale-months when deciding what counts as dormant', () => {
    const root = withLcov();
    // dead.ts last changed 30 months ago; a 36-month window makes it not dormant.
    const res = evidence([root, '--coverage', 'report.info', '--stale-months', '36', '--json']);
    const parsed = JSON.parse(res.stdout) as { counts: Record<string, number> };
    expect(parsed.counts['dead-and-untested']).toBe(0);
  });

  it('does not crash on a truncated graph file', () => {
    const root = tempProject();
    mkdirSync(join(root, '.sprang'), { recursive: true });
    writeFileSync(join(root, '.sprang', 'knowledge-graph.json'), '{"nodes": [');
    const res = evidence([root]);
    expect(res.code).toBe(1);
    expect(res.all).not.toMatch(/TypeError|SyntaxError|at Command|Node\.js v/);
  });

  it('parses a cobertura report as readily as lcov', () => {
    const { root } = standardProject();
    const xml =
      `<?xml version="1.0" ?>\n<coverage>\n<packages><package><classes>\n` +
      `<class filename="src/live.ts"><lines>` +
      `<line number="1" hits="1"/><line number="2" hits="0"/><line number="3" hits="0"/>` +
      `<line number="4" hits="0"/></lines></class>\n` +
      `<class filename="src/app.ts"><lines><line number="1" hits="4"/></lines></class>\n` +
      `<class filename="src/good.ts"><lines><line number="1" hits="2"/></lines></class>\n` +
      `<class filename="src/dead.ts"><lines><line number="1" hits="0"/></lines></class>\n` +
      `</classes></package></packages>\n</coverage>\n`;
    writeFileSync(join(root, 'coverage.xml'), xml);
    const res = evidence([root, '--json']);
    const parsed = JSON.parse(res.stdout) as {
      coverage: { format: string };
      rows: Array<{ path: string; verdict: string }>;
    };
    expect(parsed.coverage.format).toBe('cobertura');
    expect(parsed.rows.find((r) => r.path === 'src/live.ts')?.verdict).toBe('untested-but-live');
  });

  it('appears in --help so it is discoverable', () => {
    const res = spawnSync('node', [CLI, '--help'], { encoding: 'utf-8' });
    expect(res.stdout).toMatch(/evidence/);
  });
});

describe('sprang evidence — report volume', () => {
  it('lists only actionable verdicts by default', () => {
    // A full listing is 700+ lines on a real repository, almost all of it
    // restating a caveat already printed above. Two real findings buried under
    // two hundred non-findings is a report nobody reads twice.
    const root = tempProject();
    writeGraph(
      root,
      [
        { file: 'src/live.ts', revisions: 5, ageMonths: 0 },
        { file: 'src/caller.ts', revisions: 1, ageMonths: 0 },
        { file: 'src/mystery.ts', revisions: 1, ageMonths: 0 },
      ],
      [['src/caller.ts', 'src/live.ts']],
    );
    const lcov = lcovRecord('src/live.ts', 0, 10);
    writeFileSync(join(root, 'cov.info'), lcov);

    const out = stripAnsi(evidence([root, '--coverage', join(root, 'cov.info')]).stdout);
    expect(out).toMatch(/untested-but-live/);
    // The unknown row is counted in the summary but not enumerated.
    expect(out).toMatch(/not listed/);
  });

  it('--all lists the rows the default hides', () => {
    const root = tempProject();
    writeGraph(root, [{ file: 'src/mystery.ts', revisions: 1, ageMonths: 0 }], []);
    const out = stripAnsi(evidence([root, '--all']).stdout);
    expect(out).toMatch(/src\/mystery\.ts/);
    expect(out).not.toMatch(/not listed/);
  });

  it('an explicit --verdict lists those rows even when they are not actionable', () => {
    const root = tempProject();
    writeGraph(root, [{ file: 'src/mystery.ts', revisions: 1, ageMonths: 0 }], []);
    const out = stripAnsi(evidence([root, '--verdict', 'unknown']).stdout);
    expect(out).toMatch(/src\/mystery\.ts/);
  });

  it('excludes files that cannot meaningfully be executed', () => {
    // Asking whether pnpm-lock.yaml was executed is not a question with an
    // answer, and a README with 88 revisions reported as "liveness unknown" is
    // filler that pushes the real findings off the screen.
    const root = tempProject();
    writeGraph(root, [{ file: 'src/real.ts', revisions: 2, ageMonths: 0 }], []);
    const out = stripAnsi(evidence([root, '--all']).stdout);
    expect(out).not.toMatch(/README\.md/);
    expect(out).not.toMatch(/pnpm-lock/);
  });
});
