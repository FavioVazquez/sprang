import { describe, it, expect } from 'vitest';
import {
  detectCoverageFormat,
  parseLcov,
  parseCobertura,
  parseCoverage,
  matchCoverageToGraph,
  MAX_UNMATCHED_RATIO,
} from '../../src/verify/coverage.js';
import type { FileCoverage } from '../../src/verify/coverage.js';
import type { KnowledgeGraph, SprangNode } from '../../src/schema/types.js';

function fileNode(path: string): SprangNode {
  return { id: `file:${path}`, type: 'file', name: path, label: path, filePath: path };
}

function graphOf(paths: string[]): KnowledgeGraph {
  const nodes = paths.map(fileNode);
  return {
    version: '1.0.0',
    generated_at: '2024-01-01T00:00:00.000Z',
    project_root: '/repo',
    project_name: 'demo',
    phase: 'complete',
    nodes,
    edges: [],
    layers: [],
    tours: [],
    domains: [],
    stats: {
      node_count: nodes.length,
      edge_count: 0,
      risk_summary: { high: 0, medium: 0, low: 0 },
      smell_summary: {},
      generated_at: '2024-01-01T00:00:00.000Z',
    },
  };
}

/**
 * Real-shaped lcov: two TN sections for the same file (as istanbul emits when a
 * module is exercised by two suites) plus MD5 checksums on some DA records.
 */
const LCOV_REPEATED = `TN:suite one
SF:src/a.ts
FN:1,alpha
FNDA:2,alpha
DA:1,1,f7g8h9==
DA:2,0
DA:3,0,aBcDeF12==
LF:3
LH:1
end_of_record
TN:suite two
SF:src/a.ts
DA:1,3
DA:2,5,zzzz==
DA:3,0
LF:3
LH:2
end_of_record
TN:
SF:src/b.ts
DA:10,0
DA:11,0
LF:2
LH:0
end_of_record
`;

const COBERTURA = `<?xml version="1.0" ?>
<coverage line-rate="0.6" version="1.9" timestamp="1700000000">
  <sources><source>/home/runner/work/repo/repo</source></sources>
  <packages>
    <package name="src" line-rate="0.6">
      <classes>
        <class name="a" filename="src/a.py" line-rate="0.66">
          <methods/>
          <lines>
            <line number="1" hits="4"/>
            <line number="2" hits="0"/>
            <line number="7" hits="1"/>
          </lines>
        </class>
        <class name="b" filename="src/b.py" line-rate="0.0">
          <lines>
            <line number="3" hits="0"/>
          </lines>
        </class>
      </classes>
    </package>
  </packages>
</coverage>
`;

describe('detectCoverageFormat', () => {
  it('detects lcov from a TN: header', () => {
    expect(detectCoverageFormat(LCOV_REPEATED)).toBe('lcov');
  });

  it('detects lcov from an SF:-only report', () => {
    expect(detectCoverageFormat('SF:src/a.ts\nDA:1,1\nend_of_record\n')).toBe('lcov');
  });

  it('detects cobertura from the <coverage> root element', () => {
    expect(detectCoverageFormat(COBERTURA)).toBe('cobertura');
  });

  it('detects cobertura from a DOCTYPE declaration', () => {
    const doc = '<?xml version="1.0"?>\n<!DOCTYPE coverage SYSTEM "cobertura.dtd">\n<coverage/>';
    expect(detectCoverageFormat(doc)).toBe('cobertura');
  });

  it('returns unknown for empty input', () => {
    expect(detectCoverageFormat('')).toBe('unknown');
  });

  it('returns unknown for arbitrary text rather than guessing', () => {
    expect(detectCoverageFormat('{"total":{"lines":{"pct":80}}}')).toBe('unknown');
  });
});

describe('parseLcov', () => {
  it('accumulates hits across repeated TN sections instead of overwriting', () => {
    const files = parseLcov(LCOV_REPEATED);
    const a = files.find((f) => f.path === 'src/a.ts');
    // Line 2 has 0 hits in suite one and 5 in suite two: it IS executed.
    expect(a?.linesCovered).toBe(2);
    expect(a?.linesTotal).toBe(3);
    expect(a?.uncoveredLines).toEqual([3]);
  });

  it('handles the optional MD5 checksum third field on DA:', () => {
    const files = parseLcov('SF:src/x.ts\nDA:1,7,aBcDeF==\nend_of_record\n');
    expect(files[0]?.linesCovered).toBe(1);
    expect(files[0]?.uncoveredLines).toEqual([]);
  });

  it('computes percent to two decimals', () => {
    const files = parseLcov('SF:src/x.ts\nDA:1,1\nDA:2,0\nDA:3,0\nend_of_record\n');
    expect(files[0]?.percent).toBe(33.33);
  });

  it('reports a fully uncovered file', () => {
    const b = parseLcov(LCOV_REPEATED).find((f) => f.path === 'src/b.ts');
    expect(b).toMatchObject({ linesCovered: 0, linesTotal: 2, percent: 0 });
    expect(b?.uncoveredLines).toEqual([10, 11]);
  });

  it('sorts uncovered lines ascending', () => {
    const files = parseLcov('SF:src/x.ts\nDA:9,0\nDA:2,0\nDA:5,0\nend_of_record\n');
    expect(files[0]?.uncoveredLines).toEqual([2, 5, 9]);
  });

  it('returns files sorted by path', () => {
    const files = parseLcov(
      'SF:src/z.ts\nDA:1,1\nend_of_record\nSF:src/a.ts\nDA:1,1\nend_of_record\n',
    );
    expect(files.map((f) => f.path)).toEqual(['src/a.ts', 'src/z.ts']);
  });

  it('falls back to LF:/LH: when a record has no DA: lines', () => {
    const files = parseLcov('TN:\nSF:src/summary.ts\nLF:10\nLH:7\nend_of_record\n');
    expect(files[0]).toMatchObject({ linesCovered: 7, linesTotal: 10, percent: 70 });
    expect(files[0]?.uncoveredLines).toEqual([]);
  });

  it('treats a "-" hit count as not executed', () => {
    const files = parseLcov('SF:src/x.ts\nDA:1,-\nend_of_record\n');
    expect(files[0]?.uncoveredLines).toEqual([1]);
  });

  it('skips malformed DA: records instead of throwing', () => {
    const files = parseLcov('SF:src/x.ts\nDA:\nDA:abc,1\nDA:2\nDA:3,1\nend_of_record\n');
    expect(files[0]?.linesTotal).toBe(1);
    expect(files[0]?.linesCovered).toBe(1);
  });

  it('ignores records outside any SF: block', () => {
    expect(parseLcov('DA:1,1\nend_of_record\n')).toEqual([]);
  });

  it('returns an empty array for empty input', () => {
    expect(parseLcov('')).toEqual([]);
  });

  it('tolerates a truncated report with no end_of_record', () => {
    const files = parseLcov('TN:x\nSF:src/x.ts\nDA:1,1\nDA:2,0');
    expect(files[0]).toMatchObject({ path: 'src/x.ts', linesCovered: 1, linesTotal: 2 });
  });
});

describe('parseCobertura', () => {
  it('parses classes and their line hits', () => {
    const files = parseCobertura(COBERTURA);
    expect(files.map((f) => f.path)).toEqual(['src/a.py', 'src/b.py']);
    expect(files[0]).toMatchObject({ linesCovered: 2, linesTotal: 3, percent: 66.67 });
    expect(files[0]?.uncoveredLines).toEqual([2]);
  });

  it('reports a class with no executed lines', () => {
    const b = parseCobertura(COBERTURA).find((f) => f.path === 'src/b.py');
    expect(b).toMatchObject({ linesCovered: 0, linesTotal: 1, percent: 0 });
  });

  it('accumulates a class that appears in more than one package', () => {
    const xml = `<coverage><packages>
      <package name="p1"><classes><class filename="src/a.py"><lines>
        <line number="1" hits="0"/></lines></class></classes></package>
      <package name="p2"><classes><class filename="src/a.py"><lines>
        <line number="1" hits="2"/></lines></class></classes></package>
    </packages></coverage>`;
    const files = parseCobertura(xml);
    expect(files).toHaveLength(1);
    expect(files[0]?.linesCovered).toBe(1);
  });

  it('handles a self-closing class with no lines', () => {
    const files = parseCobertura('<coverage><class filename="src/empty.py"/></coverage>');
    expect(files[0]).toMatchObject({ path: 'src/empty.py', linesTotal: 0, percent: 0 });
  });

  it('returns an empty array for malformed XML rather than throwing', () => {
    expect(() => parseCobertura('<coverage><class filename="a.py"><lines>')).not.toThrow();
    expect(parseCobertura('<coverage><class filename="a.py"><lines>')).toEqual([]);
  });

  it('returns an empty array for empty input', () => {
    expect(parseCobertura('')).toEqual([]);
  });
});

describe('parseCoverage', () => {
  it('detects and parses lcov', () => {
    const result = parseCoverage(LCOV_REPEATED);
    expect(result.format).toBe('lcov');
    expect(result.files).toHaveLength(2);
  });

  it('detects and parses cobertura', () => {
    const result = parseCoverage(COBERTURA);
    expect(result.format).toBe('cobertura');
    expect(result.files).toHaveLength(2);
  });

  it('returns unknown with no files for unrecognised content', () => {
    expect(parseCoverage('hello world')).toEqual({ format: 'unknown', files: [] });
  });

  it('returns unknown with no files for empty input', () => {
    expect(parseCoverage('')).toEqual({ format: 'unknown', files: [] });
  });
});

describe('matchCoverageToGraph', () => {
  const cov = (path: string): FileCoverage => ({
    path,
    linesCovered: 1,
    linesTotal: 2,
    percent: 50,
    uncoveredLines: [2],
  });

  it('matches absolute CI paths by longest common suffix', () => {
    const graph = graphOf(['src/a.ts', 'src/b.ts']);
    const result = matchCoverageToGraph(graph, [
      cov('/home/runner/work/repo/repo/src/a.ts'),
      cov('/home/runner/work/repo/repo/src/b.ts'),
    ]);
    expect(result.matched).toBe(2);
    expect(result.unmatched).toEqual([]);
    expect(result.byPath.get('src/a.ts')?.percent).toBe(50);
  });

  it('matches identical relative paths', () => {
    const result = matchCoverageToGraph(graphOf(['src/a.ts']), [cov('src/a.ts')]);
    expect(result.matched).toBe(1);
  });

  it('normalises Windows separators in report paths', () => {
    const result = matchCoverageToGraph(graphOf(['src/a.ts']), [cov('C:\\build\\src\\a.ts')]);
    expect(result.byPath.has('src/a.ts')).toBe(true);
  });

  it('prefers the deeper suffix when two graph files share a basename', () => {
    const graph = graphOf(['pkg/one/util.ts', 'pkg/two/util.ts']);
    const result = matchCoverageToGraph(graph, [cov('/ci/repo/pkg/two/util.ts')]);
    expect(result.byPath.has('pkg/two/util.ts')).toBe(true);
    expect(result.byPath.has('pkg/one/util.ts')).toBe(false);
  });

  it('reports unmatched report paths explicitly', () => {
    const result = matchCoverageToGraph(graphOf(['src/a.ts']), [cov('vendor/other.ts')]);
    expect(result.matched).toBe(0);
    expect(result.unmatched).toEqual(['vendor/other.ts']);
  });

  it('is not unreliable when everything matches', () => {
    const result = matchCoverageToGraph(graphOf(['src/a.ts']), [cov('/ci/src/a.ts')]);
    expect(result.unreliable).toBe(false);
    expect(result.unmatchedRatio).toBe(0);
  });

  it('flags unreliable when more than 10% of entries fail to match', () => {
    const graph = graphOf(['src/a.ts', 'src/b.ts']);
    const entries = [cov('/ci/src/a.ts'), cov('/ci/src/b.ts'), cov('/ci/vendor/x.ts')];
    const result = matchCoverageToGraph(graph, entries);
    expect(result.unmatchedRatio).toBeGreaterThan(MAX_UNMATCHED_RATIO);
    expect(result.unreliable).toBe(true);
    expect(result.unmatched).toEqual(['/ci/vendor/x.ts']);
  });

  it('stays reliable at exactly the 10% threshold', () => {
    const paths = Array.from({ length: 10 }, (_, i) => `src/f${i}.ts`);
    const graph = graphOf(paths);
    const entries = [...paths.map((p) => cov(`/ci/${p}`)), cov('/ci/vendor/x.ts')];
    const result = matchCoverageToGraph(graph, entries);
    expect(result.unmatched).toHaveLength(1);
    expect(result.unreliable).toBe(false);
  });

  it('handles an empty coverage list', () => {
    const result = matchCoverageToGraph(graphOf(['src/a.ts']), []);
    expect(result).toMatchObject({ matched: 0, unmatchedRatio: 0, unreliable: false });
    expect(result.byPath.size).toBe(0);
  });

  it('handles an empty graph by reporting everything unmatched', () => {
    const result = matchCoverageToGraph(graphOf([]), [cov('src/a.ts')]);
    expect(result.matched).toBe(0);
    expect(result.unreliable).toBe(true);
  });

  it('keeps the richer entry when two report paths map to one graph file', () => {
    const graph = graphOf(['src/a.ts']);
    const rich: FileCoverage = { ...cov('/ci/src/a.ts'), linesTotal: 20, linesCovered: 10 };
    const result = matchCoverageToGraph(graph, [cov('/other/src/a.ts'), rich]);
    expect(result.byPath.get('src/a.ts')?.linesTotal).toBe(20);
  });

  it('end-to-end: parse an lcov CI report and reconcile it with the graph', () => {
    const lcov = [
      'TN:',
      'SF:/home/runner/work/sprang/sprang/packages/core/src/a.ts',
      'DA:1,1',
      'DA:2,0',
      'end_of_record',
      '',
    ].join('\n');
    const parsed = parseCoverage(lcov);
    expect(parsed.format).toBe('lcov');
    const result = matchCoverageToGraph(graphOf(['packages/core/src/a.ts']), parsed.files);
    expect(result.matched).toBe(1);
    expect(result.byPath.get('packages/core/src/a.ts')?.uncoveredLines).toEqual([2]);
  });
});
