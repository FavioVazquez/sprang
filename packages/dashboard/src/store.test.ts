import { describe, it, expect, beforeEach } from 'vitest';
import { useDashboardStore } from './store';
import type { KnowledgeGraph } from './types';

// ─── Fixture ─────────────────────────────────────────────────────────────────

function makeGraph(overrides: Partial<KnowledgeGraph> = {}): KnowledgeGraph {
  const now = new Date().toISOString();
  return {
    version: '1.0.0',
    generated_at: now,
    project_root: '/tmp/test',
    project_name: 'test-project',
    phase: 'skeleton',
    nodes: [
      { id: 'file:a.ts', type: 'file', label: 'a.ts', layer: 'layer-1' },
      { id: 'file:b.ts', type: 'file', label: 'b.ts', layer: 'layer-1' },
      { id: 'function:a:greet', type: 'function', label: 'greet', layer: 'layer-1' },
      { id: 'article:1', type: 'article', label: 'Intro', layer: 'layer-2' },
    ],
    edges: [
      { source: 'file:a.ts', target: 'file:b.ts', type: 'imports' },
      { source: 'file:a.ts', target: 'function:a:greet', type: 'contains' },
    ],
    layers: [
      { id: 'layer-1', name: 'Core', node_ids: ['file:a.ts', 'file:b.ts', 'function:a:greet'] },
      { id: 'layer-2', name: 'Docs', node_ids: ['article:1'] },
    ],
    tours: [{
      id: 'tour:main',
      title: 'Main Tour',
      description: 'Test',
      steps: [
        { node_id: 'file:a.ts', step_title: 'Step 1', explanation: 'Start here' },
        { node_ids: ['file:b.ts', 'function:a:greet'], step_title: 'Step 2', explanation: 'Continue' },
      ],
    }],
    domains: [],
    stats: {
      node_count: 4, edge_count: 2,
      risk_summary: { high: 1, medium: 0, low: 3 },
      smell_summary: {},
      generated_at: now,
    },
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('useDashboardStore — setGraph', () => {
  beforeEach(() => {
    useDashboardStore.setState({
      graph: null,
      nodesById: new Map(),
      nodeIdToLayerId: new Map(),
      nodeIdToLayerIds: new Map(),
      selectedNodeId: null,
      nodeHistory: [],
    });
  });

  it('populates nodesById index', () => {
    const graph = makeGraph();
    useDashboardStore.getState().setGraph(graph);
    const { nodesById } = useDashboardStore.getState();
    expect(nodesById.size).toBe(4);
    expect(nodesById.get('file:a.ts')?.label).toBe('a.ts');
    expect(nodesById.get('article:1')?.type).toBe('article');
  });

  it('populates nodeIdToLayerId correctly (first-wins)', () => {
    const graph = makeGraph();
    useDashboardStore.getState().setGraph(graph);
    const { nodeIdToLayerId } = useDashboardStore.getState();
    expect(nodeIdToLayerId.get('file:a.ts')).toBe('layer-1');
    expect(nodeIdToLayerId.get('article:1')).toBe('layer-2');
  });

  it('builds nodeIdToLayerIds with all memberships', () => {
    const graph = makeGraph();
    useDashboardStore.getState().setGraph(graph);
    const { nodeIdToLayerIds } = useDashboardStore.getState();
    expect(nodeIdToLayerIds.get('file:a.ts')?.has('layer-1')).toBe(true);
  });
});

describe('useDashboardStore — navigation', () => {
  beforeEach(() => {
    useDashboardStore.getState().setGraph(makeGraph());
    useDashboardStore.setState({ selectedNodeId: null, nodeHistory: [] });
  });

  it('navigateToNode sets selectedNodeId and history', () => {
    useDashboardStore.getState().navigateToNode('file:a.ts');
    const { selectedNodeId, nodeHistory } = useDashboardStore.getState();
    expect(selectedNodeId).toBe('file:a.ts');
    expect(nodeHistory).toContain('file:a.ts');
  });

  it('goBackNode navigates to previous node', () => {
    const { navigateToNode, goBackNode } = useDashboardStore.getState();
    navigateToNode('file:a.ts');
    navigateToNode('file:b.ts');
    goBackNode();
    expect(useDashboardStore.getState().selectedNodeId).toBe('file:a.ts');
  });

  it('selectNode(null) clears selection', () => {
    useDashboardStore.getState().navigateToNode('file:a.ts');
    useDashboardStore.getState().selectNode(null);
    expect(useDashboardStore.getState().selectedNodeId).toBeNull();
  });
});

describe('useDashboardStore — search', () => {
  beforeEach(() => {
    useDashboardStore.getState().setGraph(makeGraph());
  });

  it('setSearchQuery returns results matching label', () => {
    useDashboardStore.getState().setSearchQuery('greet');
    const { searchResults } = useDashboardStore.getState();
    expect(searchResults.length).toBeGreaterThan(0);
    expect(searchResults[0]!.node.id).toBe('function:a:greet');
  });

  it('empty query clears results', () => {
    useDashboardStore.getState().setSearchQuery('greet');
    useDashboardStore.getState().setSearchQuery('');
    expect(useDashboardStore.getState().searchResults).toHaveLength(0);
  });
});

describe('useDashboardStore — tour', () => {
  beforeEach(() => {
    useDashboardStore.getState().setGraph(makeGraph());
    useDashboardStore.setState({ tourActive: false, currentTourStep: 0, tourHighlightedNodeIds: [] });
  });

  it('startTour activates tour and highlights first step nodes', () => {
    useDashboardStore.getState().startTour();
    const { tourActive, tourHighlightedNodeIds } = useDashboardStore.getState();
    expect(tourActive).toBe(true);
    expect(tourHighlightedNodeIds).toContain('file:a.ts');
  });

  it('nextTourStep advances to step 2 with node_ids', () => {
    useDashboardStore.getState().startTour();
    useDashboardStore.getState().nextTourStep();
    const { currentTourStep, tourHighlightedNodeIds } = useDashboardStore.getState();
    expect(currentTourStep).toBe(1);
    expect(tourHighlightedNodeIds).toContain('file:b.ts');
    expect(tourHighlightedNodeIds).toContain('function:a:greet');
  });

  it('stopTour deactivates tour', () => {
    useDashboardStore.getState().startTour();
    useDashboardStore.getState().stopTour();
    expect(useDashboardStore.getState().tourActive).toBe(false);
    expect(useDashboardStore.getState().tourHighlightedNodeIds).toHaveLength(0);
  });
});

describe('useDashboardStore — diff overlay', () => {
  it('setDiffOverlay enables diffMode and populates sets', () => {
    useDashboardStore.getState().setDiffOverlay({
      version: '1.0', generatedAt: new Date().toISOString(),
      baseBranch: 'main',
      changedFiles: ['src/a.ts'],
      changedNodeIds: ['file:a.ts'],
      affectedNodeIds: ['file:b.ts'],
    });
    const { diffMode, changedNodeIds, affectedNodeIds } = useDashboardStore.getState();
    expect(diffMode).toBe(true);
    expect(changedNodeIds.has('file:a.ts')).toBe(true);
    expect(affectedNodeIds.has('file:b.ts')).toBe(true);
  });

  it('clearDiffOverlay resets everything', () => {
    useDashboardStore.getState().clearDiffOverlay();
    const { diffMode, changedNodeIds, affectedNodeIds } = useDashboardStore.getState();
    expect(diffMode).toBe(false);
    expect(changedNodeIds.size).toBe(0);
    expect(affectedNodeIds.size).toBe(0);
  });
});

describe('useDashboardStore — filters', () => {
  it('hasActiveFilters returns false by default', () => {
    useDashboardStore.getState().resetFilters();
    expect(useDashboardStore.getState().hasActiveFilters()).toBe(false);
  });

  it('toggleNodeTypeFilter disables knowledge category and syncs nodeTypes', () => {
    useDashboardStore.getState().resetFilters();
    useDashboardStore.getState().toggleNodeTypeFilter('knowledge');
    const { nodeTypeFilters, filters } = useDashboardStore.getState();
    expect(nodeTypeFilters.knowledge).toBe(false);
    expect(filters.nodeTypes.has('article')).toBe(false);
    expect(filters.nodeTypes.has('entity')).toBe(false);
    expect(filters.nodeTypes.has('file')).toBe(true);
  });

  it('resetFilters restores defaults', () => {
    useDashboardStore.getState().toggleNodeTypeFilter('knowledge');
    useDashboardStore.getState().resetFilters();
    expect(useDashboardStore.getState().nodeTypeFilters.knowledge).toBe(true);
    expect(useDashboardStore.getState().filters.nodeTypes.has('article')).toBe(true);
  });

  it('setFilters merges partial filter updates', () => {
    useDashboardStore.getState().resetFilters();
    const { riskLevels } = useDashboardStore.getState().filters;
    const narrowed = new Set(['high'] as const);
    useDashboardStore.getState().setFilters({ riskLevels: narrowed });
    expect(useDashboardStore.getState().filters.riskLevels.size).toBe(1);
    expect(useDashboardStore.getState().filters.riskLevels.has('high')).toBe(true);
    // other filter fields untouched
    expect(useDashboardStore.getState().filters.complexities.size).toBeGreaterThan(0);
  });
});

describe('useDashboardStore — persona', () => {
  it('default persona is junior', () => {
    expect(useDashboardStore.getState().persona).toBe('junior');
  });

  it('setPersona changes the persona', () => {
    useDashboardStore.getState().setPersona('experienced');
    expect(useDashboardStore.getState().persona).toBe('experienced');
    useDashboardStore.getState().setPersona('non-technical');
    expect(useDashboardStore.getState().persona).toBe('non-technical');
    useDashboardStore.getState().setPersona('junior');
  });
});

describe('useDashboardStore — code viewer', () => {
  beforeEach(() => {
    useDashboardStore.setState({ codeViewerOpen: false, codeViewerNodeId: null });
  });

  it('openCodeViewer sets nodeId and opens viewer', () => {
    useDashboardStore.getState().openCodeViewer('file:a.ts');
    const { codeViewerOpen, codeViewerNodeId } = useDashboardStore.getState();
    expect(codeViewerOpen).toBe(true);
    expect(codeViewerNodeId).toBe('file:a.ts');
  });

  it('closeCodeViewer clears nodeId and closes viewer', () => {
    useDashboardStore.getState().openCodeViewer('file:a.ts');
    useDashboardStore.getState().closeCodeViewer();
    const { codeViewerOpen, codeViewerNodeId } = useDashboardStore.getState();
    expect(codeViewerOpen).toBe(false);
    expect(codeViewerNodeId).toBeNull();
  });
});

describe('useDashboardStore — toolbar toggles', () => {
  beforeEach(() => {
    useDashboardStore.setState({
      exportMenuOpen: false,
      pathFinderOpen: false,
      filterPanelOpen: false,
    });
  });

  it('toggleExportMenu flips exportMenuOpen', () => {
    useDashboardStore.getState().toggleExportMenu();
    expect(useDashboardStore.getState().exportMenuOpen).toBe(true);
    useDashboardStore.getState().toggleExportMenu();
    expect(useDashboardStore.getState().exportMenuOpen).toBe(false);
  });

  it('togglePathFinder flips pathFinderOpen', () => {
    useDashboardStore.getState().togglePathFinder();
    expect(useDashboardStore.getState().pathFinderOpen).toBe(true);
  });

  it('toggleFilterPanel flips filterPanelOpen', () => {
    useDashboardStore.getState().toggleFilterPanel();
    expect(useDashboardStore.getState().filterPanelOpen).toBe(true);
  });
});

describe('useDashboardStore — viewMode', () => {
  it('default viewMode is structural', () => {
    expect(useDashboardStore.getState().viewMode).toBe('structural');
  });

  it('setViewMode changes the view mode', () => {
    useDashboardStore.getState().setViewMode('domain');
    expect(useDashboardStore.getState().viewMode).toBe('domain');
    useDashboardStore.getState().setViewMode('structural');
  });
});
