// @vitest-environment jsdom
/**
 * HotspotView — treemap where area is lines of code and colour is hotspot score.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { HotspotView } from '../HotspotView';
import { useDashboardStore } from '../../store';
import {
  hotspotColor,
  hotspotBand,
  layoutBehavioralTreemap,
  HOTSPOT_STOPS,
  behavioralFileNodes,
  getSizeLines,
} from '../../utils/behavioral';
import {
  graphWithBehavioral,
  graphWithoutBehavioral,
  makeGraph,
  makeFileNode,
  behavioral,
} from './behavioral-fixtures';

function resetStore() {
  useDashboardStore.setState({ selectedNodeId: null, nodeHistory: [], focusNodeId: null });
}

beforeEach(resetStore);
afterEach(cleanup);

describe('HotspotView', () => {
  it('renders one cell per file when behavioural data is present', () => {
    const graph = graphWithBehavioral();
    render(<HotspotView graph={graph} onNodeSelect={() => {}} />);
    expect(screen.getByTestId('hotspot-cell-file:src/hot.ts')).toBeTruthy();
    expect(screen.getByTestId('hotspot-cell-file:src/warm.ts')).toBeTruthy();
    expect(screen.getByTestId('hotspot-cell-file:lib/cold.ts')).toBeTruthy();
    expect(screen.getByTestId('hotspot-svg')).toBeTruthy();
  });

  it('shows the "run sprang scan" empty state for a graph with no behavioural data', () => {
    render(<HotspotView graph={graphWithoutBehavioral()} onNodeSelect={() => {}} />);
    expect(screen.queryByTestId('hotspot-svg')).toBeNull();
    expect(screen.getByText(/No behavioural data in this graph/i)).toBeTruthy();
    expect(screen.getByText('sprang scan')).toBeTruthy();
  });

  it('shows the empty state for a graph with no nodes at all', () => {
    render(<HotspotView graph={makeGraph()} onNodeSelect={() => {}} />);
    expect(screen.getByText(/No behavioural data in this graph/i)).toBeTruthy();
  });

  it('skips file nodes that have no behavioural block but keeps the rest', () => {
    const graph = makeGraph({
      nodes: [
        makeFileNode({ path: 'src/with.ts', lines: 200, behavioral: behavioral() }),
        makeFileNode({ path: 'src/without.ts', lines: 200 }),
      ],
    });
    render(<HotspotView graph={graph} onNodeSelect={() => {}} />);
    expect(screen.getByTestId('hotspot-cell-file:src/with.ts')).toBeTruthy();
    expect(screen.queryByTestId('hotspot-cell-file:src/without.ts')).toBeNull();
  });

  it('clicking a cell selects that node in the store', () => {
    const graph = graphWithBehavioral();
    render(
      <HotspotView
        graph={graph}
        onNodeSelect={(id) => useDashboardStore.getState().navigateToNode(id)}
      />,
    );
    fireEvent.click(screen.getByTestId('hotspot-cell-file:src/hot.ts'));
    expect(useDashboardStore.getState().selectedNodeId).toBe('file:src/hot.ts');
  });

  it('is keyboard navigable: cells are focusable and Enter selects', () => {
    const graph = graphWithBehavioral();
    render(
      <HotspotView
        graph={graph}
        onNodeSelect={(id) => useDashboardStore.getState().navigateToNode(id)}
      />,
    );
    const cell = screen.getByTestId('hotspot-cell-file:src/warm.ts');
    expect(cell.getAttribute('tabindex')).toBe('0');
    expect(cell.getAttribute('role')).toBe('button');
    fireEvent.keyDown(cell, { key: 'Enter' });
    expect(useDashboardStore.getState().selectedNodeId).toBe('file:src/warm.ts');
  });

  it('gives every cell an aria-label carrying path, size and hotspot score', () => {
    render(<HotspotView graph={graphWithBehavioral()} onNodeSelect={() => {}} />);
    const label = screen.getByTestId('hotspot-cell-file:src/hot.ts').getAttribute('aria-label');
    expect(label).toContain('src/hot.ts');
    expect(label).toContain('800L');
    expect(label).toContain('hotspot 95%');
    expect(label).toContain('critical');
  });

  it('maps colour from the hotspot score, not from risk', () => {
    render(<HotspotView graph={graphWithBehavioral()} onNodeSelect={() => {}} />);
    const hot = screen.getByTestId('hotspot-cell-file:src/hot.ts');
    const cold = screen.getByTestId('hotspot-cell-file:lib/cold.ts');
    expect(hot.getAttribute('data-fill')).toBe(hotspotColor(0.95));
    expect(cold.getAttribute('data-fill')).toBe(hotspotColor(0));
    expect(hot.getAttribute('data-fill')).not.toBe(cold.getAttribute('data-fill'));
  });

  it('renders a non-colour band attribute so the encoding is redundant', () => {
    render(<HotspotView graph={graphWithBehavioral()} onNodeSelect={() => {}} />);
    expect(
      screen.getByTestId('hotspot-cell-file:src/hot.ts').getAttribute('data-hotspot-band'),
    ).toBe('critical');
    expect(
      screen.getByTestId('hotspot-cell-file:lib/cold.ts').getAttribute('data-hotspot-band'),
    ).toBe('cold');
  });

  it('lists the hottest files, ordered hottest first', () => {
    render(<HotspotView graph={graphWithBehavioral()} onNodeSelect={() => {}} />);
    const items = screen.getAllByRole('button', { name: /hotspot \d+%/ });
    // Sidebar buttons come after the svg cells; the first sidebar entry is hottest.
    const sidebar = items.filter((el) => el.tagName.toLowerCase() === 'button');
    expect(sidebar[0]?.getAttribute('aria-label')).toContain('src/hot.ts');
  });

  it('clicking a sidebar entry also selects the node', () => {
    render(
      <HotspotView
        graph={graphWithBehavioral()}
        onNodeSelect={(id) => useDashboardStore.getState().navigateToNode(id)}
      />,
    );
    const sidebar = screen
      .getAllByRole('button', { name: /hotspot \d+%/ })
      .filter((el) => el.tagName.toLowerCase() === 'button');
    fireEvent.click(sidebar[0]!);
    expect(useDashboardStore.getState().selectedNodeId).toBe('file:src/hot.ts');
  });

  it('does not touch the store when nothing is clicked', () => {
    const spy = vi.fn();
    render(<HotspotView graph={graphWithBehavioral()} onNodeSelect={spy} />);
    expect(spy).not.toHaveBeenCalled();
    expect(useDashboardStore.getState().selectedNodeId).toBeNull();
  });
});

describe('hotspotColor boundaries', () => {
  it('clamps at both ends of the ramp', () => {
    expect(hotspotColor(0)).toBe(HOTSPOT_STOPS[0]!.color);
    expect(hotspotColor(-5)).toBe(HOTSPOT_STOPS[0]!.color);
    expect(hotspotColor(1)).toBe(HOTSPOT_STOPS[HOTSPOT_STOPS.length - 1]!.color);
    expect(hotspotColor(42)).toBe(HOTSPOT_STOPS[HOTSPOT_STOPS.length - 1]!.color);
  });

  it('returns exactly the stop colour at each stop', () => {
    for (const stop of HOTSPOT_STOPS) {
      expect(hotspotColor(stop.at)).toBe(stop.color);
    }
  });

  it('interpolates strictly between stops', () => {
    const mid = hotspotColor(0.125);
    expect(mid).not.toBe(HOTSPOT_STOPS[0]!.color);
    expect(mid).not.toBe(HOTSPOT_STOPS[1]!.color);
    expect(mid).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('treats NaN as the cold end rather than throwing', () => {
    expect(hotspotColor(Number.NaN)).toBe(HOTSPOT_STOPS[0]!.color);
  });

  it('bands at the documented boundaries', () => {
    expect(hotspotBand(0)).toBe('cold');
    expect(hotspotBand(0.2499)).toBe('cold');
    expect(hotspotBand(0.25)).toBe('warm');
    expect(hotspotBand(0.5)).toBe('hot');
    expect(hotspotBand(0.7499)).toBe('hot');
    expect(hotspotBand(0.75)).toBe('critical');
    expect(hotspotBand(1)).toBe('critical');
  });
});

describe('treemap size mapping', () => {
  it('gives a bigger file a strictly larger area', () => {
    const graph = graphWithBehavioral();
    const cells = layoutBehavioralTreemap(behavioralFileNodes(graph), 800, 600);
    const areaOf = (path: string) => {
      const c = cells.find((x) => x.path === path)!;
      return c.width * c.height;
    };
    expect(areaOf('src/hot.ts')).toBeGreaterThan(areaOf('src/warm.ts'));
    expect(areaOf('src/warm.ts')).toBeGreaterThan(areaOf('lib/cold.ts'));
  });

  it('area is proportional to sizeLines within a tolerance', () => {
    const graph = makeGraph({
      nodes: [
        makeFileNode({ path: 'src/big.ts', lines: 1000, behavioral: behavioral() }),
        makeFileNode({ path: 'src/small.ts', lines: 250, behavioral: behavioral() }),
      ],
    });
    const cells = layoutBehavioralTreemap(behavioralFileNodes(graph), 900, 600);
    const big = cells.find((c) => c.path === 'src/big.ts')!;
    const small = cells.find((c) => c.path === 'src/small.ts')!;
    const ratio = (big.width * big.height) / (small.width * small.height);
    expect(ratio).toBeGreaterThan(3);
    expect(ratio).toBeLessThan(5);
  });

  it('does not drop a zero-line file (minimum cell value)', () => {
    const graph = makeGraph({
      nodes: [
        makeFileNode({ path: 'src/empty.ts', lines: 0, behavioral: behavioral() }),
        makeFileNode({ path: 'src/normal.ts', lines: 500, behavioral: behavioral() }),
      ],
    });
    const cells = layoutBehavioralTreemap(behavioralFileNodes(graph), 900, 600);
    expect(cells.map((c) => c.path).sort()).toEqual(['src/empty.ts', 'src/normal.ts']);
    expect(getSizeLines(graph.nodes[0]!)).toBe(0);
  });

  it('returns nothing for degenerate dimensions', () => {
    const nodes = behavioralFileNodes(graphWithBehavioral());
    expect(layoutBehavioralTreemap(nodes, 0, 0)).toEqual([]);
    expect(layoutBehavioralTreemap([], 900, 600)).toEqual([]);
  });
});
