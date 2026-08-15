// @vitest-environment jsdom
/**
 * CouplingView — arc diagram of files that change together, with the pairs
 * that have no dependency edge between them called out as hidden couplings.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { CouplingView } from '../CouplingView';
import { useDashboardStore } from '../../store';
import {
  buildCouplingModel,
  buildDependencyPairs,
  deriveCouplingFromLastChange,
  hasDependencyEdge,
  arcStrokeWidth,
  pairKey,
  MAX_DERIVED_GROUP,
  type CouplingPayload,
} from '../../utils/coupling';
import {
  makeGraph,
  makeFileNode,
  makeEdge,
  behavioral,
  graphWithoutBehavioral,
} from './behavioral-fixtures';

function resetStore() {
  useDashboardStore.setState({ selectedNodeId: null, nodeHistory: [], focusNodeId: null });
}

beforeEach(resetStore);
afterEach(cleanup);

/** a↔b are joined by an import; a↔c are not — c is the hidden coupling. */
function couplingGraph() {
  return makeGraph({
    nodes: [
      makeFileNode({ path: 'src/a.ts', lines: 100, behavioral: behavioral() }),
      makeFileNode({ path: 'src/b.ts', lines: 100, behavioral: behavioral() }),
      makeFileNode({ path: 'src/c.ts', lines: 100, behavioral: behavioral() }),
    ],
    edges: [makeEdge('src/a.ts', 'src/b.ts')],
  });
}

const GIT_PAIRS: CouplingPayload = {
  available: true,
  source: 'behavioral',
  window_months: 12,
  pairs: [
    { a: 'src/a.ts', b: 'src/b.ts', degree: 90, support: 9 },
    { a: 'src/a.ts', b: 'src/c.ts', degree: 70, support: 7 },
  ],
};

const loadOk = () => Promise.resolve(GIT_PAIRS);
const loadMissing = () => Promise.resolve(null);

describe('CouplingView', () => {
  it('renders an arc for every co-change pair', async () => {
    render(<CouplingView graph={couplingGraph()} onNodeSelect={() => {}} loadPairs={loadOk} />);
    await waitFor(() => expect(screen.getByTestId('coupling-svg')).toBeTruthy());
    expect(screen.getByTestId('coupling-arc-src/a.ts|src/b.ts')).toBeTruthy();
    expect(screen.getByTestId('coupling-arc-src/a.ts|src/c.ts')).toBeTruthy();
  });

  it('highlights only pairs with no dependency edge as hidden', async () => {
    render(<CouplingView graph={couplingGraph()} onNodeSelect={() => {}} loadPairs={loadOk} />);
    await waitFor(() => expect(screen.getByTestId('coupling-svg')).toBeTruthy());
    const linked = screen.getByTestId('coupling-arc-src/a.ts|src/b.ts');
    const hidden = screen.getByTestId('coupling-arc-src/a.ts|src/c.ts');
    expect(linked.getAttribute('data-hidden-coupling')).toBe('false');
    expect(hidden.getAttribute('data-hidden-coupling')).toBe('true');
    // Hidden arcs are dashed as well as differently coloured.
    expect(hidden.getAttribute('stroke-dasharray')).toBeTruthy();
    expect(linked.getAttribute('stroke-dasharray')).toBeNull();
    expect(hidden.getAttribute('aria-label')).toContain('hidden coupling');
    expect(linked.getAttribute('aria-label')).not.toContain('hidden coupling');
  });

  it('does not flag a pair as hidden when an edge runs the other way', async () => {
    const graph = makeGraph({
      nodes: [
        makeFileNode({ path: 'src/a.ts', behavioral: behavioral() }),
        makeFileNode({ path: 'src/b.ts', behavioral: behavioral() }),
      ],
      // Edge b → a, while the coupling pair is listed a, b.
      edges: [makeEdge('src/b.ts', 'src/a.ts')],
    });
    render(
      <CouplingView
        graph={graph}
        onNodeSelect={() => {}}
        loadPairs={() =>
          Promise.resolve({ available: true, pairs: [{ a: 'src/a.ts', b: 'src/b.ts', degree: 50 }] })
        }
      />,
    );
    await waitFor(() => expect(screen.getByTestId('coupling-svg')).toBeTruthy());
    expect(
      screen.getByTestId('coupling-arc-src/a.ts|src/b.ts').getAttribute('data-hidden-coupling'),
    ).toBe('false');
    expect(screen.getByTestId('hidden-coupling-list').textContent).toMatch(
      /No hidden couplings/i,
    );
  });

  it('shows the empty state when there is no coupling data of any kind', async () => {
    render(
      <CouplingView graph={graphWithoutBehavioral()} onNodeSelect={() => {}} loadPairs={loadMissing} />,
    );
    await waitFor(() =>
      expect(screen.getByText(/No behavioural data in this graph/i)).toBeTruthy(),
    );
    expect(screen.queryByTestId('coupling-svg')).toBeNull();
    expect(screen.getByText('sprang scan')).toBeTruthy();
  });

  it('falls back to last_change proximity and says so in the UI', async () => {
    const graph = makeGraph({
      nodes: [
        makeFileNode({ path: 'src/a.ts', behavioral: behavioral({ last_change: '2026-02-02' }) }),
        makeFileNode({ path: 'src/c.ts', behavioral: behavioral({ last_change: '2026-02-02' }) }),
      ],
    });
    render(<CouplingView graph={graph} onNodeSelect={() => {}} loadPairs={loadMissing} />);
    await waitFor(() => expect(screen.getByTestId('coupling-svg')).toBeTruthy());
    const note = screen.getByTestId('coupling-provenance');
    expect(note.textContent).toMatch(/Approximated, not measured/i);
    expect(note.textContent).toMatch(/weaker signal/i);
    expect(screen.getByTestId('coupling-arc-src/a.ts|src/c.ts')).toBeTruthy();
  });

  it('labels measured data as measured when the endpoint answers', async () => {
    render(<CouplingView graph={couplingGraph()} onNodeSelect={() => {}} loadPairs={loadOk} />);
    await waitFor(() => expect(screen.getByTestId('coupling-svg')).toBeTruthy());
    const note = screen.getByTestId('coupling-provenance');
    expect(note.textContent).toMatch(/Measured co-change/i);
    expect(note.textContent).not.toMatch(/Approximated/i);
  });

  it('clicking an arc selects the node in the store', async () => {
    render(
      <CouplingView
        graph={couplingGraph()}
        onNodeSelect={(id) => useDashboardStore.getState().navigateToNode(id)}
        loadPairs={loadOk}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('coupling-svg')).toBeTruthy());
    fireEvent.click(screen.getByTestId('coupling-arc-src/a.ts|src/c.ts'));
    expect(useDashboardStore.getState().selectedNodeId).toBe('file:src/a.ts');
  });

  it('clicking a file tick selects that file, and ticks are keyboard reachable', async () => {
    render(
      <CouplingView
        graph={couplingGraph()}
        onNodeSelect={(id) => useDashboardStore.getState().navigateToNode(id)}
        loadPairs={loadOk}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('coupling-svg')).toBeTruthy());
    const tick = screen.getByTestId('coupling-file-src/c.ts');
    expect(tick.getAttribute('tabindex')).toBe('0');
    fireEvent.keyDown(tick, { key: 'Enter' });
    expect(useDashboardStore.getState().selectedNodeId).toBe('file:src/c.ts');
  });

  it('can filter down to hidden couplings only', async () => {
    render(<CouplingView graph={couplingGraph()} onNodeSelect={() => {}} loadPairs={loadOk} />);
    await waitFor(() => expect(screen.getByTestId('coupling-svg')).toBeTruthy());
    fireEvent.click(screen.getByLabelText('Show only hidden couplings'));
    expect(screen.queryByTestId('coupling-arc-src/a.ts|src/b.ts')).toBeNull();
    expect(screen.getByTestId('coupling-arc-src/a.ts|src/c.ts')).toBeTruthy();
  });

  it('lists hidden couplings in the sidebar and selects from there', async () => {
    render(
      <CouplingView
        graph={couplingGraph()}
        onNodeSelect={(id) => useDashboardStore.getState().navigateToNode(id)}
        loadPairs={loadOk}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('coupling-svg')).toBeTruthy());
    const list = screen.getByTestId('hidden-coupling-list');
    expect(list.querySelectorAll('button').length).toBe(1);
    fireEvent.click(list.querySelectorAll('button')[0]!);
    expect(useDashboardStore.getState().selectedNodeId).toBe('file:src/a.ts');
  });

  it('drops pairs whose files are not in the graph', async () => {
    render(
      <CouplingView
        graph={couplingGraph()}
        onNodeSelect={() => {}}
        loadPairs={() =>
          Promise.resolve({
            available: true,
            pairs: [
              { a: 'src/a.ts', b: 'src/c.ts', degree: 60 },
              { a: 'src/a.ts', b: 'vanished/gone.ts', degree: 99 },
            ],
          })
        }
      />,
    );
    await waitFor(() => expect(screen.getByTestId('coupling-svg')).toBeTruthy());
    expect(screen.getByTestId('coupling-arc-src/a.ts|src/c.ts')).toBeTruthy();
    expect(screen.queryByTestId('coupling-arc-src/a.ts|vanished/gone.ts')).toBeNull();
  });

  it('never calls the selection callback while merely rendering', async () => {
    const spy = vi.fn();
    render(<CouplingView graph={couplingGraph()} onNodeSelect={spy} loadPairs={loadOk} />);
    await waitFor(() => expect(screen.getByTestId('coupling-svg')).toBeTruthy());
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('coupling model', () => {
  it('flags hidden pairs only where no dependency edge exists', () => {
    const graph = couplingGraph();
    const deps = buildDependencyPairs(graph);
    expect(hasDependencyEdge(deps, 'src/a.ts', 'src/b.ts')).toBe(true);
    expect(hasDependencyEdge(deps, 'src/b.ts', 'src/a.ts')).toBe(true);
    expect(hasDependencyEdge(deps, 'src/a.ts', 'src/c.ts')).toBe(false);
    const model = buildCouplingModel(graph, GIT_PAIRS.pairs);
    expect(model.totalCount).toBe(2);
    expect(model.hiddenCount).toBe(1);
    expect(model.arcs.find((a) => a.b === 'src/c.ts')?.hidden).toBe(true);
  });

  it('de-duplicates mirrored pairs', () => {
    const model = buildCouplingModel(couplingGraph(), [
      { a: 'src/a.ts', b: 'src/c.ts', degree: 80 },
      { a: 'src/c.ts', b: 'src/a.ts', degree: 10 },
    ]);
    expect(model.totalCount).toBe(1);
    expect(model.arcs[0]?.degree).toBe(80);
    expect(pairKey('src/a.ts', 'src/c.ts')).toBe(pairKey('src/c.ts', 'src/a.ts'));
  });

  it('orders arcs by degree and honours the limit', () => {
    const model = buildCouplingModel(
      couplingGraph(),
      [
        { a: 'src/a.ts', b: 'src/c.ts', degree: 10 },
        { a: 'src/a.ts', b: 'src/b.ts', degree: 99 },
      ],
      1,
    );
    expect(model.totalCount).toBe(1);
    expect(model.arcs[0]?.b).toBe('src/b.ts');
  });

  it('scales stroke width with degree and clamps at the boundaries', () => {
    expect(arcStrokeWidth(0)).toBeCloseTo(0.6, 5);
    expect(arcStrokeWidth(100)).toBeCloseTo(4, 5);
    expect(arcStrokeWidth(-50)).toBeCloseTo(0.6, 5);
    expect(arcStrokeWidth(1000)).toBeCloseTo(4, 5);
    expect(arcStrokeWidth(50)).toBeGreaterThan(arcStrokeWidth(20));
  });

  it('derives weaker pairs from identical last_change dates', () => {
    const graph = makeGraph({
      nodes: [
        makeFileNode({ path: 'a.ts', behavioral: behavioral({ last_change: '2026-01-01' }) }),
        makeFileNode({ path: 'b.ts', behavioral: behavioral({ last_change: '2026-01-01' }) }),
        makeFileNode({ path: 'z.ts', behavioral: behavioral({ last_change: '2025-05-05' }) }),
      ],
    });
    const pairs = deriveCouplingFromLastChange(graph);
    expect(pairs).toEqual([{ a: 'a.ts', b: 'b.ts', degree: 100 }]);
  });

  it('ignores mass-edit days and files with no last_change', () => {
    const many = Array.from({ length: MAX_DERIVED_GROUP + 1 }, (_, i) =>
      makeFileNode({ path: `m${i}.ts`, behavioral: behavioral({ last_change: '2026-03-03' }) }),
    );
    expect(deriveCouplingFromLastChange(makeGraph({ nodes: many }))).toEqual([]);
    const noDates = makeGraph({
      nodes: [
        makeFileNode({ path: 'a.ts', behavioral: { revisions: 1 } }),
        makeFileNode({ path: 'b.ts' }),
      ],
    });
    expect(deriveCouplingFromLastChange(noDates)).toEqual([]);
    expect(deriveCouplingFromLastChange(null)).toEqual([]);
  });

  it('weakens the derived degree as the same-day group grows', () => {
    const group = (n: number) =>
      deriveCouplingFromLastChange(
        makeGraph({
          nodes: Array.from({ length: n }, (_, i) =>
            makeFileNode({ path: `g${i}.ts`, behavioral: behavioral({ last_change: '2026-04-04' }) }),
          ),
        }),
      );
    expect(group(2)[0]?.degree).toBe(100);
    expect(group(5)[0]?.degree).toBe(25);
    expect(group(5)[0]!.degree).toBeLessThan(group(2)[0]!.degree);
  });
});
