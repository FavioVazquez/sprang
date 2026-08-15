// @vitest-environment jsdom
/**
 * KnowledgeMapView — same treemap geometry, coloured by risk of knowledge loss.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { KnowledgeMapView } from '../KnowledgeMapView';
import { useDashboardStore } from '../../store';
import {
  knowledgeRiskLevel,
  knowledgeColor,
  formatShare,
  KNOWLEDGE_STYLES,
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

/** critical / concentrated / shared / unknown, one file each. */
function graphWithEveryLevel() {
  return makeGraph({
    nodes: [
      makeFileNode({
        path: 'src/solo.ts',
        lines: 400,
        behavioral: behavioral({
          bus_factor: 1, revisions: 12, top_share: 1, main_developer: 'Grace Hopper',
        }),
      }),
      makeFileNode({
        path: 'src/mostly.ts',
        lines: 400,
        behavioral: behavioral({
          bus_factor: 2, revisions: 12, top_share: 0.9, main_developer: 'Ada Lovelace',
        }),
      }),
      makeFileNode({
        path: 'src/spread.ts',
        lines: 400,
        behavioral: behavioral({
          bus_factor: 4, revisions: 12, top_share: 0.4, main_developer: 'Alan Turing',
        }),
      }),
      makeFileNode({
        path: 'src/silent.ts',
        lines: 400,
        behavioral: { revisions: 3, hotspot_score: 0.1 },
      }),
    ],
  });
}

describe('KnowledgeMapView', () => {
  it('renders one cell per file with behavioural data', () => {
    render(<KnowledgeMapView graph={graphWithEveryLevel()} onNodeSelect={() => {}} />);
    expect(screen.getByTestId('knowledge-svg')).toBeTruthy();
    expect(screen.getByTestId('knowledge-cell-file:src/solo.ts')).toBeTruthy();
    expect(screen.getByTestId('knowledge-cell-file:src/spread.ts')).toBeTruthy();
  });

  it('shows the "run sprang scan" empty state on an older graph', () => {
    render(<KnowledgeMapView graph={graphWithoutBehavioral()} onNodeSelect={() => {}} />);
    expect(screen.queryByTestId('knowledge-svg')).toBeNull();
    expect(screen.getByText(/No behavioural data in this graph/i)).toBeTruthy();
    expect(screen.getByText('sprang scan')).toBeTruthy();
  });

  it('colours each cell by knowledge-loss level', () => {
    render(<KnowledgeMapView graph={graphWithEveryLevel()} onNodeSelect={() => {}} />);
    const level = (p: string) =>
      screen.getByTestId(`knowledge-cell-file:${p}`).getAttribute('data-knowledge-level');
    expect(level('src/solo.ts')).toBe('critical');
    expect(level('src/mostly.ts')).toBe('concentrated');
    expect(level('src/spread.ts')).toBe('shared');
    expect(level('src/silent.ts')).toBe('unknown');
    expect(
      screen.getByTestId('knowledge-cell-file:src/solo.ts').getAttribute('data-fill'),
    ).toBe(KNOWLEDGE_STYLES.critical.fill);
  });

  it('clicking a cell selects the node in the store', () => {
    render(
      <KnowledgeMapView
        graph={graphWithEveryLevel()}
        onNodeSelect={(id) => useDashboardStore.getState().navigateToNode(id)}
      />,
    );
    fireEvent.click(screen.getByTestId('knowledge-cell-file:src/mostly.ts'));
    expect(useDashboardStore.getState().selectedNodeId).toBe('file:src/mostly.ts');
  });

  it('cells are keyboard reachable and Space activates them', () => {
    render(
      <KnowledgeMapView
        graph={graphWithEveryLevel()}
        onNodeSelect={(id) => useDashboardStore.getState().navigateToNode(id)}
      />,
    );
    const cell = screen.getByTestId('knowledge-cell-file:src/spread.ts');
    expect(cell.getAttribute('tabindex')).toBe('0');
    fireEvent.keyDown(cell, { key: ' ' });
    expect(useDashboardStore.getState().selectedNodeId).toBe('file:src/spread.ts');
  });

  it('hovering shows the main developer and their share', () => {
    render(<KnowledgeMapView graph={graphWithEveryLevel()} onNodeSelect={() => {}} />);
    expect(screen.queryByTestId('knowledge-tooltip')).toBeNull();
    fireEvent.mouseEnter(screen.getByTestId('knowledge-cell-file:src/solo.ts'));
    const tooltip = screen.getByTestId('knowledge-tooltip');
    expect(tooltip.textContent).toContain('Grace Hopper');
    expect(tooltip.textContent).toContain('100%');
    fireEvent.mouseLeave(screen.getByTestId('knowledge-cell-file:src/solo.ts'));
    expect(screen.queryByTestId('knowledge-tooltip')).toBeNull();
  });

  it('puts the main developer and share in the aria-label too', () => {
    render(<KnowledgeMapView graph={graphWithEveryLevel()} onNodeSelect={() => {}} />);
    const label = screen
      .getByTestId('knowledge-cell-file:src/mostly.ts')
      .getAttribute('aria-label');
    expect(label).toContain('Ada Lovelace');
    expect(label).toContain('90%');
    expect(label).toContain('bus factor 2');
  });

  it('states plainly that the colours come from git authorship, not judgement', () => {
    render(<KnowledgeMapView graph={graphWithEveryLevel()} onNodeSelect={() => {}} />);
    const legend = screen.getByTestId('knowledge-legend').parentElement!;
    expect(legend.textContent).toMatch(/derived from git authorship over a bounded window/i);
    expect(legend.textContent).toMatch(/not anyone.s contribution, competence or value/i);
  });

  it('legend counts every level present in the map', () => {
    render(<KnowledgeMapView graph={graphWithEveryLevel()} onNodeSelect={() => {}} />);
    const legend = screen.getByTestId('knowledge-legend');
    expect(legend.textContent).toContain(KNOWLEDGE_STYLES.critical.label);
    expect(legend.textContent).toContain(KNOWLEDGE_STYLES.shared.label);
    // One file at each of the four levels.
    expect(legend.querySelectorAll('li').length).toBe(4);
    expect(legend.textContent).toMatch(/\(1\)/);
  });

  it('does not rely on colour alone — critical and concentrated carry patterns', () => {
    render(<KnowledgeMapView graph={graphWithEveryLevel()} onNodeSelect={() => {}} />);
    const solo = screen.getByTestId('knowledge-cell-file:src/solo.ts');
    const spread = screen.getByTestId('knowledge-cell-file:src/spread.ts');
    const fills = (el: Element) =>
      Array.from(el.querySelectorAll('rect')).map((r) => r.getAttribute('fill'));
    expect(fills(solo)).toContain('url(#knowledge-hatch)');
    expect(fills(spread)).not.toContain('url(#knowledge-hatch)');
    expect(fills(spread)).not.toContain('url(#knowledge-dots)');
  });
});

describe('knowledgeRiskLevel boundaries', () => {
  it('is critical only when bus_factor is 1 AND revisions >= 5', () => {
    expect(knowledgeRiskLevel({ bus_factor: 1, revisions: 5, top_share: 1 })).toBe('critical');
    expect(knowledgeRiskLevel({ bus_factor: 1, revisions: 4, top_share: 1 })).toBe('concentrated');
    expect(knowledgeRiskLevel({ bus_factor: 2, revisions: 50, top_share: 0.5 })).toBe('shared');
  });

  it('is concentrated strictly above a top_share of 0.8', () => {
    expect(knowledgeRiskLevel({ bus_factor: 3, revisions: 10, top_share: 0.81 })).toBe('concentrated');
    expect(knowledgeRiskLevel({ bus_factor: 3, revisions: 10, top_share: 0.8 })).toBe('shared');
    expect(knowledgeRiskLevel({ bus_factor: 3, revisions: 10, top_share: 0.8000001 })).toBe('concentrated');
  });

  it('is unknown when no authorship signal exists', () => {
    expect(knowledgeRiskLevel(null)).toBe('unknown');
    expect(knowledgeRiskLevel(undefined)).toBe('unknown');
    expect(knowledgeRiskLevel({ revisions: 10 })).toBe('unknown');
  });

  it('varies lightness as well as hue so deuteranopia is survivable', () => {
    // Rough relative luminance — critical must be darkest, shared lightest.
    const lum = (hex: string) => {
      const n = parseInt(hex.slice(1), 16);
      return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
    };
    const critical = lum(KNOWLEDGE_STYLES.critical.fill);
    const concentrated = lum(KNOWLEDGE_STYLES.concentrated.fill);
    const shared = lum(KNOWLEDGE_STYLES.shared.fill);
    expect(critical).toBeLessThan(concentrated);
    expect(concentrated).toBeLessThan(shared);
    expect(knowledgeColor({ bus_factor: 1, revisions: 9 })).toBe(KNOWLEDGE_STYLES.critical.fill);
  });

  it('formats shares defensively', () => {
    expect(formatShare(0.5)).toBe('50%');
    expect(formatShare(1)).toBe('100%');
    expect(formatShare(undefined)).toBe('—');
    expect(formatShare(Number.NaN)).toBe('—');
    expect(formatShare(2)).toBe('100%');
  });

  it('uses the real graph fixture end to end', () => {
    const graph = graphWithBehavioral();
    render(<KnowledgeMapView graph={graph} onNodeSelect={() => {}} />);
    expect(
      screen.getByTestId('knowledge-cell-file:src/hot.ts').getAttribute('data-knowledge-level'),
    ).toBe('critical');
    expect(
      screen.getByTestId('knowledge-cell-file:lib/cold.ts').getAttribute('data-knowledge-level'),
    ).toBe('concentrated');
  });
});
