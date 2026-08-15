import { describe, it, expect } from 'vitest';
import type { KnowledgeGraph, SprangEdge, SprangNode } from '../../src/schema/types.js';
import {
  UnionFind,
  computeLcom4,
  computeMartinMetrics,
  defaultComponentOf,
  findCycles,
  findSdpViolations,
} from '../../src/graph/architecture-metrics.js';

type Graph = Pick<KnowledgeGraph, 'nodes' | 'edges'>;

const graph = (nodes: SprangNode[], edges: SprangEdge[]): Graph => ({ nodes, edges });

const file = (path: string): SprangNode => ({
  id: `file:${path}`,
  type: 'file',
  label: path,
  filePath: path,
});

const klass = (path: string, name: string, metadata?: Record<string, unknown>): SprangNode => ({
  id: `class:${path}:${name}`,
  type: 'class',
  name,
  label: name,
  location: { file: path },
  ...(metadata ? { metadata } : {}),
});

const fn = (path: string, name: string, metadata?: Record<string, unknown>): SprangNode => ({
  id: `function:${path}:${name}`,
  type: 'function',
  name,
  label: name,
  location: { file: path },
  ...(metadata ? { metadata } : {}),
});

const imports = (from: string, to: string, weight?: number): SprangEdge => ({
  source: `file:${from}`,
  target: `file:${to}`,
  type: 'imports',
  ...(weight === undefined ? {} : { weight }),
});

const contains = (source: string, target: string): SprangEdge => ({
  source,
  target,
  type: 'contains',
});

// ─── findCycles ──────────────────────────────────────────────────────

describe('findCycles', () => {
  it('returns nothing for an empty graph', () => {
    expect(findCycles(graph([], []))).toEqual([]);
  });

  it('returns nothing for an acyclic (properly layered) import graph', () => {
    const g = graph(
      [file('src/a.ts'), file('src/b.ts'), file('src/c.ts')],
      [imports('src/a.ts', 'src/b.ts'), imports('src/b.ts', 'src/c.ts'), imports('src/a.ts', 'src/c.ts')],
    );
    expect(findCycles(g)).toEqual([]);
  });

  it('finds a two-file cycle and reports both members', () => {
    const g = graph(
      [file('src/a.ts'), file('src/b.ts')],
      [imports('src/a.ts', 'src/b.ts'), imports('src/b.ts', 'src/a.ts')],
    );
    const cycles = findCycles(g);
    expect(cycles).toHaveLength(1);
    expect(cycles[0]?.members).toEqual(['file:src/a.ts', 'file:src/b.ts']);
    expect(cycles[0]?.witness).toEqual(['file:src/a.ts', 'file:src/b.ts', 'file:src/a.ts']);
  });

  it('finds a cycle of length three as ONE component, not three pairs', () => {
    // A naive "did I come back to a node I have seen" walker reports this as
    // several overlapping loops; Tarjan reports the single SCC.
    const g = graph(
      [file('a.ts'), file('b.ts'), file('c.ts')],
      [imports('a.ts', 'b.ts'), imports('b.ts', 'c.ts'), imports('c.ts', 'a.ts')],
    );
    const cycles = findCycles(g);
    expect(cycles).toHaveLength(1);
    expect(cycles[0]?.members).toEqual(['file:a.ts', 'file:b.ts', 'file:c.ts']);
    // Closed walk: three hops, four entries.
    expect(cycles[0]?.witness).toEqual(['file:a.ts', 'file:b.ts', 'file:c.ts', 'file:a.ts']);
  });

  it('reports the shortest witness when the SCC also contains a longer loop', () => {
    // a→b→a is the short loop; a→b→c→d→a is the long one. Same SCC.
    const g = graph(
      [file('a.ts'), file('b.ts'), file('c.ts'), file('d.ts')],
      [
        imports('a.ts', 'b.ts'),
        imports('b.ts', 'a.ts'),
        imports('b.ts', 'c.ts'),
        imports('c.ts', 'd.ts'),
        imports('d.ts', 'a.ts'),
      ],
    );
    const cycles = findCycles(g);
    expect(cycles).toHaveLength(1);
    expect(cycles[0]?.members).toHaveLength(4);
    expect(cycles[0]?.witness).toEqual(['file:a.ts', 'file:b.ts', 'file:a.ts']);
  });

  it('reports two independent tangles separately, largest first', () => {
    const g = graph(
      [file('a.ts'), file('b.ts'), file('c.ts'), file('x.ts'), file('y.ts')],
      [
        imports('a.ts', 'b.ts'),
        imports('b.ts', 'c.ts'),
        imports('c.ts', 'a.ts'),
        imports('x.ts', 'y.ts'),
        imports('y.ts', 'x.ts'),
      ],
    );
    const cycles = findCycles(g);
    expect(cycles).toHaveLength(2);
    expect(cycles[0]?.members).toHaveLength(3);
    expect(cycles[1]?.members).toEqual(['file:x.ts', 'file:y.ts']);
  });

  it('reports a self-import as a one-member cycle', () => {
    const g = graph([file('a.ts')], [imports('a.ts', 'a.ts')]);
    const cycles = findCycles(g);
    expect(cycles).toEqual([
      { members: ['file:a.ts'], witness: ['file:a.ts', 'file:a.ts'], suggestedCut: { from: 'file:a.ts', to: 'file:a.ts' } },
    ]);
  });

  it('ignores edges pointing at nodes that are not in the graph', () => {
    const g = graph(
      [file('a.ts')],
      [imports('a.ts', 'ghost.ts'), imports('ghost.ts', 'a.ts')],
    );
    expect(findCycles(g)).toEqual([]);
  });

  it('ignores non-file endpoints and non-import edge types', () => {
    const g = graph(
      [file('a.ts'), file('b.ts'), fn('a.ts', 'go')],
      [
        { source: 'function:a.ts:go', target: 'file:b.ts', type: 'imports' },
        { source: 'file:b.ts', target: 'function:a.ts:go', type: 'imports' },
        { source: 'file:a.ts', target: 'file:b.ts', type: 'calls' },
        { source: 'file:b.ts', target: 'file:a.ts', type: 'calls' },
      ],
    );
    expect(findCycles(g)).toEqual([]);
  });

  it('cuts the lightest edge when every intra-cycle edge carries a weight', () => {
    const g = graph(
      [file('a.ts'), file('b.ts')],
      [imports('a.ts', 'b.ts', 5), imports('b.ts', 'a.ts', 1)],
    );
    expect(findCycles(g)[0]?.suggestedCut).toEqual({ from: 'file:b.ts', to: 'file:a.ts' });
  });

  it('cuts the most-disconnecting edge, which is NOT the first witness edge', () => {
    // Triangle a→b→c→a plus a chord c→b. Deleting b→c is the only removal that
    // leaves the component acyclic; a naive "cut the first edge of the witness"
    // would answer a→b and leave b↔c looping.
    const g = graph(
      [file('a.ts'), file('b.ts'), file('c.ts')],
      [
        imports('a.ts', 'b.ts'),
        imports('b.ts', 'c.ts'),
        imports('c.ts', 'a.ts'),
        imports('c.ts', 'b.ts'),
      ],
    );
    const cycles = findCycles(g);
    expect(cycles[0]?.suggestedCut).toEqual({ from: 'file:b.ts', to: 'file:c.ts' });
  });

  it('handles a very deep cycle without blowing the stack (iterative Tarjan)', () => {
    const size = 20000;
    const nodes: SprangNode[] = [];
    const edges: SprangEdge[] = [];
    for (let i = 0; i < size; i += 1) {
      const path = `f${String(i).padStart(6, '0')}.ts`;
      nodes.push(file(path));
      const next = `f${String((i + 1) % size).padStart(6, '0')}.ts`;
      edges.push(imports(path, next));
    }
    const cycles = findCycles(graph(nodes, edges));
    expect(cycles).toHaveLength(1);
    expect(cycles[0]?.members).toHaveLength(size);
    expect(cycles[0]?.witness).toHaveLength(size + 1);
  });
});

// ─── computeMartinMetrics ────────────────────────────────────────────

describe('defaultComponentOf', () => {
  it('groups at directory depth two and falls back to "." at the root', () => {
    expect(defaultComponentOf('packages/core/src/graph/x.ts')).toBe('packages/core');
    expect(defaultComponentOf('src/a.ts')).toBe('src');
    expect(defaultComponentOf('a.ts')).toBe('.');
  });
});

describe('computeMartinMetrics', () => {
  it('returns nothing for an empty graph', () => {
    expect(computeMartinMetrics(graph([], []))).toEqual([]);
  });

  it('gives a lone unconnected component I = 0 and D = 1 rather than NaN', () => {
    // Ca + Ce == 0: the division 0/0 must not escape as NaN.
    const metrics = computeMartinMetrics(graph([file('src/a.ts')], []));
    expect(metrics).toHaveLength(1);
    expect(metrics[0]?.ca).toBe(0);
    expect(metrics[0]?.ce).toBe(0);
    expect(metrics[0]?.instability).toBe(0);
    expect(metrics[0]?.abstractness).toBe(0);
    expect(metrics[0]?.distance).toBe(1);
    expect(metrics[0]?.zone).toBe('ok');
  });

  it('computes Ca, Ce and instability across components', () => {
    const g = graph(
      [file('src/app/a.ts'), file('src/lib/b.ts')],
      [imports('src/app/a.ts', 'src/lib/b.ts')],
    );
    const metrics = computeMartinMetrics(g);
    const app = metrics.find((m) => m.component === 'src/app');
    const lib = metrics.find((m) => m.component === 'src/lib');
    expect(app).toMatchObject({ ca: 0, ce: 1, instability: 1, distance: 0 });
    expect(lib).toMatchObject({ ca: 1, ce: 0, instability: 0, distance: 1 });
  });

  it('ignores intra-component imports — they are not coupling between components', () => {
    const g = graph(
      [file('src/app/a.ts'), file('src/app/b.ts')],
      [imports('src/app/a.ts', 'src/app/b.ts')],
    );
    const metrics = computeMartinMetrics(g);
    expect(metrics).toEqual([
      { component: 'src/app', ca: 0, ce: 0, instability: 0, abstractness: 0, distance: 1, zone: 'ok' },
    ]);
  });

  it('counts DISTINCT files, so two imports of the same file count once', () => {
    const g = graph(
      [file('src/app/a.ts'), file('src/lib/b.ts'), file('src/lib/c.ts')],
      [
        imports('src/app/a.ts', 'src/lib/b.ts'),
        imports('src/app/a.ts', 'src/lib/b.ts'),
        imports('src/app/a.ts', 'src/lib/c.ts'),
      ],
    );
    const app = computeMartinMetrics(g).find((m) => m.component === 'src/app');
    expect(app?.ce).toBe(2);
  });

  it('honours a custom componentOf', () => {
    const g = graph(
      [file('a/x.ts'), file('b/y.ts')],
      [imports('a/x.ts', 'b/y.ts')],
    );
    const metrics = computeMartinMetrics(g, { componentOf: () => 'everything' });
    expect(metrics).toHaveLength(1);
    // Everything collapses into one component, so the import is now internal.
    expect(metrics[0]).toMatchObject({ component: 'everything', ca: 0, ce: 0 });
  });

  it('derives abstractness from class naming conventions and metadata', () => {
    const g = graph(
      [
        file('src/core/a.ts'),
        klass('src/core/a.ts', 'IRepository'),
        klass('src/core/a.ts', 'AbstractStore'),
        klass('src/core/a.ts', 'BaseThing', { isAbstract: true }),
        klass('src/core/a.ts', 'Invoice'),
      ],
      [],
    );
    const metrics = computeMartinMetrics(g);
    // 3 of 4 abstract. "Invoice" must NOT match the /^I[A-Z]/ interface prefix.
    expect(metrics[0]?.abstractness).toBeCloseTo(0.75, 10);
  });

  it('treats a component with zero classes as abstractness 0', () => {
    const metrics = computeMartinMetrics(graph([file('src/util/a.ts')], []));
    expect(metrics[0]?.abstractness).toBe(0);
  });

  it('flags the Zone of Pain: concrete, stable, and more depended on than most', () => {
    // src/core is imported by two other components and imports nothing.
    const g = graph(
      [file('src/core/c.ts'), file('src/app/a.ts'), file('src/web/w.ts')],
      [imports('src/app/a.ts', 'src/core/c.ts'), imports('src/web/w.ts', 'src/core/c.ts')],
    );
    const metrics = computeMartinMetrics(g);
    expect(metrics.find((m) => m.component === 'src/core')?.zone).toBe('pain');
    expect(metrics.find((m) => m.component === 'src/app')?.zone).toBe('ok');
  });

  it('flags the Zone of Uselessness: all abstract, nothing depends on it', () => {
    const g = graph(
      [
        file('src/abs/i.ts'),
        klass('src/abs/i.ts', 'IThing'),
        file('src/app/a.ts'),
        file('src/web/w.ts'),
      ],
      [imports('src/abs/i.ts', 'src/app/a.ts'), imports('src/abs/i.ts', 'src/web/w.ts')],
    );
    const abs = computeMartinMetrics(g).find((m) => m.component === 'src/abs');
    expect(abs).toMatchObject({ ca: 0, ce: 2, instability: 1, abstractness: 1, zone: 'uselessness' });
  });

  it('skips file nodes with no resolvable path instead of inventing a component', () => {
    const orphan: SprangNode = { id: 'weird-node', type: 'file', label: 'weird' };
    const metrics = computeMartinMetrics(graph([orphan, file('src/a.ts')], []));
    expect(metrics.map((m) => m.component)).toEqual(['src']);
  });

  it('ignores import edges whose endpoints are missing from the graph', () => {
    const g = graph([file('src/app/a.ts')], [imports('src/app/a.ts', 'src/lib/ghost.ts')]);
    const metrics = computeMartinMetrics(g);
    expect(metrics).toHaveLength(1);
    expect(metrics[0]?.ce).toBe(0);
  });

  it('ignores a file that imports itself', () => {
    const g = graph([file('src/a.ts')], [imports('src/a.ts', 'src/a.ts')]);
    expect(computeMartinMetrics(g)[0]).toMatchObject({ ca: 0, ce: 0 });
  });
});

// ─── findSdpViolations ───────────────────────────────────────────────

describe('findSdpViolations', () => {
  it('returns nothing when there are no metrics', () => {
    expect(findSdpViolations([], graph([], []))).toEqual([]);
  });

  it('reports nothing when every dependency points towards stability', () => {
    const g = graph(
      [file('src/app/a.ts'), file('src/core/c.ts')],
      [imports('src/app/a.ts', 'src/core/c.ts')],
    );
    expect(findSdpViolations(computeMartinMetrics(g), g)).toEqual([]);
  });

  it('finds a violation only visible after both instabilities are computed', () => {
    // src/x: Ca=2 (p, q), Ce=1 (y)  -> I = 1/3  (relatively stable)
    // src/y: Ca=1 (x), Ce=2 (p, q)  -> I = 2/3  (relatively unstable)
    // x → y therefore depends on something LESS stable than itself. Neither
    // component looks wrong on its own; only the comparison exposes it.
    const g = graph(
      [file('src/x/x.ts'), file('src/y/y.ts'), file('src/p/p.ts'), file('src/q/q.ts')],
      [
        imports('src/p/p.ts', 'src/x/x.ts'),
        imports('src/q/q.ts', 'src/x/x.ts'),
        imports('src/x/x.ts', 'src/y/y.ts'),
        imports('src/y/y.ts', 'src/p/p.ts'),
        imports('src/y/y.ts', 'src/q/q.ts'),
      ],
    );
    const metrics = computeMartinMetrics(g);
    expect(metrics.find((m) => m.component === 'src/x')?.instability).toBeCloseTo(1 / 3, 10);
    expect(metrics.find((m) => m.component === 'src/y')?.instability).toBeCloseTo(2 / 3, 10);

    const violations = findSdpViolations(metrics, g);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ from: 'src/x', to: 'src/y', edgeCount: 1 });
    expect(violations[0]?.delta).toBeCloseTo(1 / 3, 10);
  });

  it('sorts violations by delta descending, worst offender first', () => {
    // h: Ca=4 (p,q,r,s), Ce=2 (m,v)   -> I = 1/3
    // m: Ca=1 (h),       Ce=1 (p)     -> I = 1/2   → h→m violates by 1/6
    // v: Ca=1 (h),       Ce=3 (p,q,r) -> I = 3/4   → h→v violates by 5/12
    const g = graph(
      [
        file('h/h.ts'),
        file('m/m.ts'),
        file('v/v.ts'),
        file('p/p.ts'),
        file('q/q.ts'),
        file('r/r.ts'),
        file('s/s.ts'),
      ],
      [
        imports('p/p.ts', 'h/h.ts'),
        imports('q/q.ts', 'h/h.ts'),
        imports('r/r.ts', 'h/h.ts'),
        imports('s/s.ts', 'h/h.ts'),
        imports('h/h.ts', 'm/m.ts'),
        imports('h/h.ts', 'v/v.ts'),
        imports('m/m.ts', 'p/p.ts'),
        imports('v/v.ts', 'p/p.ts'),
        imports('v/v.ts', 'q/q.ts'),
        imports('v/v.ts', 'r/r.ts'),
      ],
    );
    const violations = findSdpViolations(computeMartinMetrics(g), g);
    expect(violations.map((v) => `${v.from}->${v.to}`)).toEqual(['h->v', 'h->m']);
    expect(violations[0]?.delta).toBeCloseTo(5 / 12, 10);
    expect(violations[1]?.delta).toBeCloseTo(1 / 6, 10);
  });

  it('returns nothing when the componentOf used does not match the metrics keys', () => {
    const g = graph(
      [file('src/x/x.ts'), file('src/y/y.ts')],
      [imports('src/x/x.ts', 'src/y/y.ts')],
    );
    const metrics = computeMartinMetrics(g);
    expect(findSdpViolations(metrics, g, { componentOf: () => 'lumped' })).toEqual([]);
  });
});

// ─── UnionFind ───────────────────────────────────────────────────────

describe('UnionFind', () => {
  it('treats an unknown key as its own singleton set', () => {
    const uf = new UnionFind();
    expect(uf.find('a')).toBe('a');
    expect(uf.groupCount()).toBe(1);
  });

  it('merges sets transitively', () => {
    const uf = new UnionFind();
    uf.union('a', 'b');
    uf.union('b', 'c');
    uf.add('z');
    expect(uf.find('a')).toBe(uf.find('c'));
    expect(uf.groupCount()).toBe(2);
    expect(uf.groups()).toEqual([['a', 'b', 'c'], ['z']]);
  });

  it('reports false when the two keys are already joined', () => {
    const uf = new UnionFind();
    expect(uf.union('a', 'b')).toBe(true);
    expect(uf.union('b', 'a')).toBe(false);
  });

  it('stays flat on a long chain (path compression, no recursion)', () => {
    const uf = new UnionFind();
    for (let i = 0; i < 50000; i += 1) uf.union(`n${i}`, `n${i + 1}`);
    expect(uf.groupCount()).toBe(1);
    expect(uf.find('n0')).toBe(uf.find('n50000'));
  });
});

// ─── computeLcom4 ────────────────────────────────────────────────────

describe('computeLcom4', () => {
  it('returns nothing for an empty graph', () => {
    expect(computeLcom4(graph([], []))).toEqual([]);
  });

  it('is inert on the current graph shape, where the member metadata is absent', () => {
    // Sprang's extractors do not yet emit fieldsAccessed / callsWithinClass, so
    // the honest answer is "no data", not a fabricated cohesion number.
    const g = graph(
      [klass('a.ts', 'Svc'), fn('a.ts', 'one'), fn('a.ts', 'two')],
      [contains('class:a.ts:Svc', 'function:a.ts:one'), contains('class:a.ts:Svc', 'function:a.ts:two')],
    );
    expect(computeLcom4(g)).toEqual([]);
  });

  it('scores a cohesive class as 1 once field metadata exists', () => {
    const g = graph(
      [
        klass('a.ts', 'Svc'),
        fn('a.ts', 'one', { fieldsAccessed: ['state'] }),
        fn('a.ts', 'two', { fieldsAccessed: ['state'] }),
      ],
      [contains('class:a.ts:Svc', 'function:a.ts:one'), contains('class:a.ts:Svc', 'function:a.ts:two')],
    );
    const [result] = computeLcom4(g);
    expect(result?.lcom4).toBe(1);
    expect(result?.clusters).toEqual([['one', 'two']]);
  });

  it('splits a class whose methods never touch the same state', () => {
    const g = graph(
      [
        klass('a.ts', 'Svc'),
        fn('a.ts', 'readA', { fieldsAccessed: ['a'] }),
        fn('a.ts', 'writeA', { fieldsAccessed: ['a'] }),
        fn('a.ts', 'readB', { fieldsAccessed: ['b'] }),
      ],
      [
        contains('class:a.ts:Svc', 'function:a.ts:readA'),
        contains('class:a.ts:Svc', 'function:a.ts:writeA'),
        contains('class:a.ts:Svc', 'function:a.ts:readB'),
      ],
    );
    const [result] = computeLcom4(g);
    expect(result?.lcom4).toBe(2);
    expect(result?.clusters).toEqual([['readA', 'writeA'], ['readB']]);
    expect(result?.className).toBe('Svc');
  });

  it('joins otherwise-disjoint clusters through a sibling call (transitively)', () => {
    // A naive "share a field?" pairwise check reports 3; LCOM4 must follow the
    // call edge from `glue` and collapse everything into one component.
    const g = graph(
      [
        klass('a.ts', 'Svc'),
        fn('a.ts', 'readA', { fieldsAccessed: ['a'] }),
        fn('a.ts', 'readB', { fieldsAccessed: ['b'] }),
        fn('a.ts', 'glue', { callsWithinClass: ['readA', 'readB'] }),
      ],
      [
        contains('class:a.ts:Svc', 'function:a.ts:readA'),
        contains('class:a.ts:Svc', 'function:a.ts:readB'),
        contains('class:a.ts:Svc', 'function:a.ts:glue'),
      ],
    );
    const [result] = computeLcom4(g);
    expect(result?.lcom4).toBe(1);
    expect(result?.clusters).toEqual([['glue', 'readA', 'readB']]);
  });

  it('ignores calls to names that are not methods of the class, and self-calls', () => {
    const g = graph(
      [
        klass('a.ts', 'Svc'),
        fn('a.ts', 'one', { fieldsAccessed: ['a'], callsWithinClass: ['one', 'helperOutside'] }),
        fn('a.ts', 'two', { fieldsAccessed: ['b'] }),
      ],
      [contains('class:a.ts:Svc', 'function:a.ts:one'), contains('class:a.ts:Svc', 'function:a.ts:two')],
    );
    expect(computeLcom4(g)[0]?.lcom4).toBe(2);
  });

  it('ignores dangling contains edges and non class→function pairs', () => {
    const g = graph(
      [klass('a.ts', 'Svc'), fn('a.ts', 'one', { fieldsAccessed: ['a'] })],
      [
        contains('class:a.ts:Svc', 'function:a.ts:missing'),
        contains('class:a.ts:Ghost', 'function:a.ts:one'),
        contains('class:a.ts:Svc', 'class:a.ts:Svc'),
        contains('file:a.ts', 'function:a.ts:one'),
        contains('class:a.ts:Svc', 'function:a.ts:one'),
      ],
    );
    const results = computeLcom4(g);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ classId: 'class:a.ts:Svc', lcom4: 1, methods: ['one'] });
  });

  it('skips classes with no methods at all', () => {
    const g = graph([klass('a.ts', 'Empty')], []);
    expect(computeLcom4(g)).toEqual([]);
  });
});
