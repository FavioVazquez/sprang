import { describe, it, expect } from 'vitest';
import type { KnowledgeGraph, SprangNode } from '../../src/schema/types.js';
import {
  COMMON_FUNCTION_NAMES,
  MAX_PAIRS_PER_BUCKET,
  SIMILARITY_SAMPLE_CHARS,
  codeFingerprint,
  codeSimilarity,
  detectClones,
  isCommonFunctionName,
  normalizeCode,
} from '../../src/graph/clones.js';

type Graph = Pick<KnowledgeGraph, 'nodes' | 'edges'>;

const graph = (nodes: SprangNode[]): Graph => ({ nodes, edges: [] });

const fn = (path: string, name: string, start: number, end: number): SprangNode => ({
  id: `function:${path}:${name}`,
  type: 'function',
  name,
  label: name,
  location: { file: path, start_line: start, end_line: end },
});

const BODY_A = [
  'function computeTotals(items) {',
  '  let total = 0;',
  '  for (const item of items) {',
  '    if (item.active) {',
  '      total += item.price * item.qty;',
  '    }',
  '  }',
  '  return total;',
  '}',
].join('\n');

/** Same logic, different identifiers and literals — a textbook copy-paste. */
const BODY_B = [
  'function sumOrders(orders) {',
  '  let sum = 0;',
  '  for (const order of orders) {',
  '    if (order.enabled) {',
  '      sum += order.cost * order.count;',
  '    }',
  '  }',
  '  return sum;',
  '}',
].join('\n');

function sources(entries: Record<string, string>): Map<string, string> {
  return new Map(Object.entries(entries));
}

/** Place a body at line 1 of its own file. */
function fileWith(body: string): string {
  return body;
}

const twoClones = (): { g: Graph; src: Map<string, string> } => {
  const g = graph([
    fn('src/a.ts', 'computeTotals', 1, 9),
    fn('src/b.ts', 'sumOrders', 1, 9),
  ]);
  const src = sources({ 'src/a.ts': fileWith(BODY_A), 'src/b.ts': fileWith(BODY_B) });
  return { g, src };
};

describe('normalizeCode', () => {
  it('strips line comments', () => {
    expect(normalizeCode('let x = 1; // secret note')).toBe(normalizeCode('let x = 1;'));
  });

  it('strips block comments', () => {
    expect(normalizeCode('/* header */ let x = 1;')).toBe(normalizeCode('let x = 1;'));
  });

  it('strips python-style comments and docstrings', () => {
    const a = normalizeCode('def f():\n    """doc"""\n    # note\n    return 1\n');
    const b = normalizeCode('def g():\n    ""\n    return 2\n');
    expect(a).toBe(b);
  });

  it('empties string contents but keeps the literal', () => {
    expect(normalizeCode('const a = "hello world";')).toBe(normalizeCode('const b = "x";'));
  });

  it('folds identifiers to I and numbers to N', () => {
    expect(normalizeCode('foo = 42')).toBe('I = N');
  });

  it('collapses whitespace', () => {
    expect(normalizeCode('a   +\n\n  b')).toBe('I + I');
  });

  it('renaming variables does not change the normalized form', () => {
    expect(normalizeCode(BODY_A)).toBe(normalizeCode(BODY_B));
  });
});

describe('codeFingerprint', () => {
  it('produces the documented L/C/F/R/S shape', () => {
    expect(codeFingerprint('function f() { return 1; }')).toMatch(/^L\d+C\d+F\d+R\d+S\d+$/);
  });

  it('is identical for two renamed copies of the same function', () => {
    expect(codeFingerprint(BODY_A)).toBe(codeFingerprint(BODY_B));
  });

  it('counts loops', () => {
    expect(codeFingerprint('for (;;) {}').startsWith('L1')).toBe(true);
    expect(codeFingerprint('{}').startsWith('L0')).toBe(true);
  });

  it('counts conditions', () => {
    expect(codeFingerprint('if (a) {}')).toContain('C1');
  });

  it('counts returns', () => {
    expect(codeFingerprint('return a; return b;')).toContain('R2');
  });

  it('does not count control-flow keywords as calls', () => {
    expect(codeFingerprint('if (a) { while (b) {} }')).toContain('F0');
  });

  it('buckets by normalized length in units of 50 characters', () => {
    const short = codeFingerprint('a;');
    const long = codeFingerprint('a;'.repeat(200));
    expect(short).not.toBe(long);
    expect(short.endsWith('S0')).toBe(true);
  });

  it('is stable for an empty snippet', () => {
    expect(codeFingerprint('')).toBe('L0C0F0R0S0');
  });
});

describe('codeSimilarity', () => {
  it('is 1 for identical non-empty code', () => {
    expect(codeSimilarity('let a = 1;', 'let a = 1;')).toBe(1);
  });

  it('is 1 for a pure rename', () => {
    expect(codeSimilarity(BODY_A, BODY_B)).toBe(1);
  });

  it('is 0 when either side is empty', () => {
    expect(codeSimilarity('', 'let a = 1;')).toBe(0);
    expect(codeSimilarity('let a = 1;', '')).toBe(0);
    expect(codeSimilarity('', '')).toBe(0);
  });

  it('is low for structurally different code', () => {
    const a = 'let a = 1;';
    const b = 'while (x) { doSomething(x, y, z); breakOut(); }';
    expect(codeSimilarity(a, b)).toBeLessThan(0.7);
  });

  it('is symmetric', () => {
    const a = 'function f(a) { return a + 1; }';
    const b = 'function g(b) { if (b) { return b; } return 0; }';
    expect(codeSimilarity(a, b)).toBeCloseTo(codeSimilarity(b, a), 12);
  });

  it('is always within [0, 1]', () => {
    const score = codeSimilarity(BODY_A, 'x();');
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('does not hang or crash on a 100k-character function', () => {
    const huge = `function big() {\n${'  doThing(value, other);\n'.repeat(4000)}}`;
    expect(huge.length).toBeGreaterThan(100_000);
    const started = Date.now();
    const score = codeSimilarity(huge, huge);
    expect(score).toBe(1);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('only samples the first SIMILARITY_SAMPLE_CHARS characters', () => {
    const prefix = 'doThing(a, b);\n'.repeat(200);
    const a = `${prefix}uniqueTail();`;
    const b = `${prefix}completelyDifferent(1, 2, 3, 4, 5);`;
    expect(normalizeCode(prefix).length).toBeGreaterThan(SIMILARITY_SAMPLE_CHARS);
    expect(codeSimilarity(a, b)).toBe(1);
  });
});

describe('COMMON_FUNCTION_NAMES', () => {
  it('has roughly sixty entries', () => {
    expect(COMMON_FUNCTION_NAMES.length).toBeGreaterThanOrEqual(55);
  });

  it('covers React, Vue, Python, routes, migrations and tests', () => {
    for (const name of ['componentDidMount', 'mounted', '__init__', 'GET', 'upgrade', 'beforeEach', 'toString', 'constructor', 'render', 'setUp', 'tearDown']) {
      expect(COMMON_FUNCTION_NAMES).toContain(name);
    }
  });

  it('matches case-insensitively', () => {
    expect(isCommonFunctionName('get')).toBe(true);
    expect(isCommonFunctionName('GET')).toBe(true);
    expect(isCommonFunctionName('computeTotals')).toBe(false);
  });

  it('has no duplicate entries', () => {
    expect(new Set(COMMON_FUNCTION_NAMES).size).toBe(COMMON_FUNCTION_NAMES.length);
  });
});

describe('detectClones — guards', () => {
  it('returns [] for an empty graph', () => {
    expect(detectClones(graph([]), sources({}))).toEqual([]);
  });

  it('returns [] when sources are empty', () => {
    const { g } = twoClones();
    expect(detectClones(g, new Map())).toEqual([]);
  });

  it('skips nodes whose file is missing from the sources map', () => {
    const { g } = twoClones();
    expect(detectClones(g, sources({ 'src/a.ts': BODY_A }))).toEqual([]);
  });

  it('skips functions with no location', () => {
    const g = graph([
      { id: 'function:src/a.ts:computeTotals', type: 'function', name: 'computeTotals', label: 'computeTotals' },
      fn('src/b.ts', 'sumOrders', 1, 9),
    ]);
    expect(detectClones(g, sources({ 'src/a.ts': BODY_A, 'src/b.ts': BODY_B }))).toEqual([]);
  });

  it('skips functions with a location but no line numbers', () => {
    const noLines: SprangNode = {
      id: 'function:src/a.ts:computeTotals',
      type: 'function',
      name: 'computeTotals',
      label: 'computeTotals',
      location: { file: 'src/a.ts' },
    };
    const g = graph([noLines, fn('src/b.ts', 'sumOrders', 1, 9)]);
    expect(detectClones(g, sources({ 'src/a.ts': BODY_A, 'src/b.ts': BODY_B }))).toEqual([]);
  });

  it('skips functions shorter than minLines', () => {
    const g = graph([fn('src/a.ts', 'tiny', 1, 3), fn('src/b.ts', 'small', 1, 3)]);
    const body = 'function t() {\n  return 1;\n}';
    expect(detectClones(g, sources({ 'src/a.ts': body, 'src/b.ts': body }))).toEqual([]);
  });

  it('honours a custom minLines', () => {
    const body = 'function t(a) {\n  const b = a + 1;\n  return b;\n}';
    const g = graph([fn('src/a.ts', 'alpha', 1, 4), fn('src/b.ts', 'beta', 1, 4)]);
    expect(detectClones(g, sources({ 'src/a.ts': body, 'src/b.ts': body }))).toEqual([]);
    expect(detectClones(g, sources({ 'src/a.ts': body, 'src/b.ts': body }), { minLines: 2 })).toHaveLength(1);
  });

  it('skips identical zero-length (whitespace-only) bodies', () => {
    const body = '\n\n\n\n\n\n';
    const g = graph([fn('src/a.ts', 'blankOne', 1, 6), fn('src/b.ts', 'blankTwo', 1, 6)]);
    expect(detectClones(g, sources({ 'src/a.ts': body, 'src/b.ts': body }))).toEqual([]);
  });

  it('ignores non-function nodes', () => {
    const g = graph([
      { id: 'file:src/a.ts', type: 'file', label: 'src/a.ts', filePath: 'src/a.ts' },
      { id: 'class:src/a.ts:Thing', type: 'class', name: 'Thing', label: 'Thing', location: { file: 'src/a.ts', start_line: 1, end_line: 9 } },
    ]);
    expect(detectClones(g, sources({ 'src/a.ts': BODY_A }))).toEqual([]);
  });

  it('tolerates a span that runs past the end of the file', () => {
    const g = graph([fn('src/a.ts', 'computeTotals', 1, 900), fn('src/b.ts', 'sumOrders', 1, 900)]);
    const groups = detectClones(g, sources({ 'src/a.ts': BODY_A, 'src/b.ts': BODY_B }));
    expect(groups).toHaveLength(1);
  });

  it('returns [] when a single candidate survives filtering', () => {
    const g = graph([fn('src/a.ts', 'computeTotals', 1, 9)]);
    expect(detectClones(g, sources({ 'src/a.ts': BODY_A }))).toEqual([]);
  });
});

describe('detectClones — findings', () => {
  it('finds two genuinely duplicated functions', () => {
    const { g, src } = twoClones();
    const groups = detectClones(g, src);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.members.map((m) => m.nodeId)).toEqual([
      'function:src/a.ts:computeTotals',
      'function:src/b.ts:sumOrders',
    ]);
    expect(groups[0]?.similarity).toBeGreaterThan(0.9);
    expect(groups[0]?.fingerprint).toBe(codeFingerprint(BODY_A));
  });

  it('reports file, name and line for each member', () => {
    const { g, src } = twoClones();
    const member = detectClones(g, src)[0]?.members[0];
    expect(member?.file).toBe('src/a.ts');
    expect(member?.name).toBe('computeTotals');
    expect(member?.line).toBe(1);
  });

  it('groups three copies into one group, not three pairs', () => {
    const g = graph([
      fn('src/a.ts', 'computeTotals', 1, 9),
      fn('src/b.ts', 'sumOrders', 1, 9),
      fn('src/c.ts', 'addUp', 1, 9),
    ]);
    const src = sources({ 'src/a.ts': BODY_A, 'src/b.ts': BODY_B, 'src/c.ts': BODY_A });
    const groups = detectClones(g, src);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.members).toHaveLength(3);
  });

  it('does NOT report two different functions that merely share a fingerprint', () => {
    // Same L/C/F/R/S counts, entirely different token order.
    const a = [
      'function alpha(input) {',
      '  const parsed = parseThing(input);',
      '  for (const row of parsed) {',
      '    if (row.ok) { collect(row); }',
      '  }',
      '  return parsed;',
      '}',
    ].join('\n');
    const b = [
      'function beta(cfg) {',
      '  for (const key of Object.keys(cfg)) {',
      '    if (!key) { continue; }',
      '  }',
      '  const out = buildResult(cfg);',
      '  return out;',
      '}',
    ].join('\n');
    const g = graph([fn('src/a.ts', 'alpha', 1, 7), fn('src/b.ts', 'beta', 1, 7)]);
    expect(codeFingerprint(a)).toBe(codeFingerprint(b));
    expect(codeSimilarity(a, b)).toBeLessThanOrEqual(0.7);
    // default minSimilarity (0.7) must already reject them
    expect(detectClones(g, sources({ 'src/a.ts': a, 'src/b.ts': b }))).toEqual([]);
  });

  it('the allowlist suppresses framework lifecycle duplicates', () => {
    const body = [
      'componentDidMount() {',
      '  this.setState({ loading: true });',
      '  fetchData().then((data) => {',
      '    this.setState({ data, loading: false });',
      '  });',
      '}',
    ].join('\n');
    const g = graph([
      fn('src/A.tsx', 'componentDidMount', 1, 6),
      fn('src/B.tsx', 'componentDidMount', 1, 6),
    ]);
    expect(detectClones(g, sources({ 'src/A.tsx': body, 'src/B.tsx': body }))).toEqual([]);
  });

  it('the allowlist suppresses Alembic upgrade/downgrade pairs', () => {
    const body = [
      'def upgrade():',
      '    op.create_table("a")',
      '    op.add_column("a", "b")',
      '    op.create_index("i")',
      '    op.execute("x")',
      '    return None',
    ].join('\n');
    const g = graph([
      fn('mig/0001.py', 'upgrade', 1, 6),
      fn('mig/0002.py', 'upgrade', 1, 6),
    ]);
    expect(detectClones(g, sources({ 'mig/0001.py': body, 'mig/0002.py': body }))).toEqual([]);
  });

  it('still reports non-allowlisted functions in the same file set', () => {
    const g = graph([
      fn('src/a.ts', 'render', 1, 9),
      fn('src/b.ts', 'computeTotals', 1, 9),
      fn('src/c.ts', 'sumOrders', 1, 9),
    ]);
    const src = sources({ 'src/a.ts': BODY_A, 'src/b.ts': BODY_A, 'src/c.ts': BODY_B });
    const groups = detectClones(g, src);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.members.map((m) => m.name)).toEqual(['computeTotals', 'sumOrders']);
  });

  it('respects a custom minSimilarity threshold', () => {
    const { g, src } = twoClones();
    expect(detectClones(g, src, { minSimilarity: 0.99 })).toHaveLength(1);
    expect(detectClones(g, src, { minSimilarity: 1 })).toEqual([]);
  });

  it('ignores comment and string differences between copies', () => {
    const withComments = BODY_A.replace(
      'let total = 0;',
      '// running total for the whole basket\n  let total = 0; /* starts empty */',
    );
    const g = graph([fn('src/a.ts', 'computeTotals', 1, 10), fn('src/b.ts', 'sumOrders', 1, 9)]);
    expect(codeFingerprint(withComments)).toBe(codeFingerprint(BODY_B));
    const groups = detectClones(g, sources({ 'src/a.ts': withComments, 'src/b.ts': BODY_B }));
    expect(codeSimilarity(withComments, BODY_B)).toBeGreaterThan(0.7);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.members).toHaveLength(2);
  });

  it('caps pairwise comparisons in a very large bucket and still returns a group', () => {
    const count = 60; // 1,770 pairs > MAX_PAIRS_PER_BUCKET
    const nodes: SprangNode[] = [];
    const src = new Map<string, string>();
    for (let i = 0; i < count; i++) {
      const path = `src/dup${String(i).padStart(3, '0')}.ts`;
      nodes.push(fn(path, `duplicated${i}`, 1, 9));
      src.set(path, BODY_A);
    }
    expect(MAX_PAIRS_PER_BUCKET).toBe(1000);
    const groups = detectClones(graph(nodes), src);
    expect(groups).toHaveLength(1);
    // The cap truncates the pair enumeration, but union-find still transitively
    // links every member reached before the cap.
    expect(groups[0]?.members.length).toBeGreaterThan(2);
  });
});

describe('detectClones — determinism and ordering', () => {
  it('produces identical output across two runs', () => {
    const { g, src } = twoClones();
    expect(detectClones(g, src)).toEqual(detectClones(g, src));
  });

  it('is invariant to node input order', () => {
    const { g, src } = twoClones();
    const reversed: Graph = { nodes: g.nodes.slice().reverse(), edges: [] };
    expect(detectClones(reversed, src)).toEqual(detectClones(g, src));
  });

  it('sorts members by node id', () => {
    const g = graph([
      fn('src/z.ts', 'zeta', 1, 9),
      fn('src/a.ts', 'alphaSum', 1, 9),
    ]);
    const src = sources({ 'src/z.ts': BODY_A, 'src/a.ts': BODY_B });
    const groups = detectClones(g, src);
    expect(groups[0]?.members.map((m) => m.nodeId)).toEqual([
      'function:src/a.ts:alphaSum',
      'function:src/z.ts:zeta',
    ]);
  });

  it('sorts groups by descending similarity', () => {
    const near = BODY_B.replace('sum += order.cost * order.count;', 'sum += order.cost * order.count + extraFee(order);');
    const g = graph([
      fn('src/a.ts', 'computeTotals', 1, 9),
      fn('src/b.ts', 'sumOrders', 1, 9),
      fn('src/c.ts', 'tallyThings', 1, 9),
      fn('src/d.ts', 'tallyOther', 1, 9),
    ]);
    const src = sources({
      'src/a.ts': BODY_A, 'src/b.ts': BODY_A,
      'src/c.ts': BODY_A, 'src/d.ts': near,
    });
    const groups = detectClones(g, src);
    const sims = groups.map((x) => x.similarity);
    expect([...sims].sort((x, y) => y - x)).toEqual(sims);
  });

  it('does not mutate the graph or the sources map', () => {
    const { g, src } = twoClones();
    const graphSnapshot = JSON.stringify(g);
    const sourceSnapshot = JSON.stringify([...src.entries()]);
    detectClones(g, src);
    expect(JSON.stringify(g)).toBe(graphSnapshot);
    expect(JSON.stringify([...src.entries()])).toBe(sourceSnapshot);
  });
});
