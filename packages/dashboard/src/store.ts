import { create } from 'zustand';
import Fuse from 'fuse.js';
import type {
  KnowledgeGraph,
  SprangNode,
  Layer,
  Tour,
  TourStep,
  Persona,
  ViewMode,
  NodeCategory,
  NodeType,
  Complexity,
  EdgeCategory,
  FilterState,
  DiffOverlay,
} from './types';
import { NODE_TYPE_TO_CATEGORY } from './types';

// ─── Search ──────────────────────────────────────────────────────────────────

export interface SearchResult {
  node: SprangNode;
  score: number;
}

function buildSearchIndex(nodes: SprangNode[]): Fuse<SprangNode> {
  return new Fuse(nodes, {
    keys: [
      { name: 'label', weight: 0.4 },
      { name: 'name', weight: 0.3 },
      { name: 'summary', weight: 0.2 },
      { name: 'tags', weight: 0.1 },
    ],
    threshold: 0.35,
    includeScore: true,
  });
}

// ─── Graph index helpers ──────────────────────────────────────────────────────

function buildGraphIndexes(graph: KnowledgeGraph): {
  nodesById: Map<string, SprangNode>;
  nodeIdToLayerId: Map<string, string>;
  nodeIdToLayerIds: Map<string, Set<string>>;
} {
  const nodesById = new Map<string, SprangNode>();
  for (const node of graph.nodes) nodesById.set(node.id, node);

  const nodeIdToLayerId = new Map<string, string>();
  const nodeIdToLayerIds = new Map<string, Set<string>>();
  for (const layer of graph.layers) {
    const nodeIds = Array.isArray(layer.node_ids) ? layer.node_ids : [];
    for (const nid of nodeIds) {
      if (!nodeIdToLayerId.has(nid)) nodeIdToLayerId.set(nid, layer.id);
      let set = nodeIdToLayerIds.get(nid);
      if (!set) { set = new Set<string>(); nodeIdToLayerIds.set(nid, set); }
      set.add(layer.id);
    }
  }
  return { nodesById, nodeIdToLayerId, nodeIdToLayerIds };
}

// ─── Default filters ─────────────────────────────────────────────────────────

function defaultFilters(): FilterState {
  return {
    nodeTypes: new Set<NodeType>([
      'file', 'function', 'class', 'module', 'concept',
      'config', 'document', 'service', 'table', 'endpoint',
      'pipeline', 'schema', 'resource',
      'domain', 'flow', 'step',
      'article', 'entity', 'topic', 'claim', 'source',
    ]),
    complexities: new Set<Complexity>(['simple', 'moderate', 'complex']),
    layerIds: new Set<string>(),
    edgeCategories: new Set<EdgeCategory>([
      'structural', 'behavioral', 'data-flow', 'dependencies',
      'semantic', 'infrastructure', 'domain', 'knowledge',
    ]),
    riskLevels: new Set(['high', 'medium', 'low'] as const),
  };
}

// ─── Store interface ──────────────────────────────────────────────────────────

export interface DashboardStore {
  // Graph data
  graph: KnowledgeGraph | null;
  nodesById: Map<string, SprangNode>;
  nodeIdToLayerId: Map<string, string>;
  nodeIdToLayerIds: Map<string, Set<string>>;

  // Selection & navigation
  selectedNodeId: string | null;
  focusNodeId: string | null;
  nodeHistory: string[];

  // Search
  searchQuery: string;
  searchResults: SearchResult[];
  searchIndex: Fuse<SprangNode> | null;

  // Code viewer
  codeViewerOpen: boolean;
  codeViewerNodeId: string | null;
  codeViewerExpanded: boolean;

  // Tour
  tourActive: boolean;
  currentTourStep: number;
  tourHighlightedNodeIds: string[];

  // Persona
  persona: Persona;

  // View mode
  viewMode: ViewMode;

  // Diff overlay
  diffMode: boolean;
  diffOverlay: DiffOverlay | null;
  changedNodeIds: Set<string>;
  affectedNodeIds: Set<string>;

  // Filters
  filters: FilterState;
  filterPanelOpen: boolean;

  // Node type category quick-toggles
  nodeTypeFilters: Record<NodeCategory, boolean>;

  // Graph view mode (2D Sigma vs 3D WebGL)
  graphViewMode: '2d' | '3d';

  // Toolbar panels
  exportMenuOpen: boolean;
  pathFinderOpen: boolean;

  // Actions — graph
  setGraph: (graph: KnowledgeGraph) => void;
  setGraphViewMode: (mode: '2d' | '3d') => void;

  // Actions — selection
  selectNode: (nodeId: string | null) => void;
  navigateToNode: (nodeId: string) => void;
  goBackNode: () => void;
  setFocusNode: (nodeId: string | null) => void;

  // Actions — search
  setSearchQuery: (query: string) => void;

  // Actions — code viewer
  openCodeViewer: (nodeId: string) => void;
  closeCodeViewer: () => void;
  toggleCodeViewerExpanded: () => void;

  // Actions — tour
  startTour: () => void;
  stopTour: () => void;
  nextTourStep: () => void;
  prevTourStep: () => void;
  setTourStep: (step: number) => void;

  // Actions — persona
  setPersona: (persona: Persona) => void;

  // Actions — view mode
  setViewMode: (mode: ViewMode) => void;

  // Actions — diff
  setDiffOverlay: (overlay: DiffOverlay) => void;
  toggleDiffMode: () => void;
  clearDiffOverlay: () => void;

  // Actions — filters
  setFilters: (filters: Partial<FilterState>) => void;
  resetFilters: () => void;
  hasActiveFilters: () => boolean;
  toggleNodeTypeFilter: (category: NodeCategory) => void;
  toggleFilterPanel: () => void;

  // Actions — toolbar
  toggleExportMenu: () => void;
  togglePathFinder: () => void;
}

// ─── Store implementation ─────────────────────────────────────────────────────

const MAX_HISTORY = 50;

function getTourHighlightedNodeIds(tour: Tour | null, step: number): string[] {
  if (!tour) return [];
  const s: TourStep | undefined = tour.steps[step];
  if (!s) return [];
  if (s.node_ids && s.node_ids.length > 0) return s.node_ids;
  if (s.node_id) return [s.node_id];
  return [];
}

export const useDashboardStore = create<DashboardStore>()((set, get) => ({
  graph: null,
  nodesById: new Map(),
  nodeIdToLayerId: new Map(),
  nodeIdToLayerIds: new Map(),

  selectedNodeId: null,
  focusNodeId: null,
  nodeHistory: [],

  searchQuery: '',
  searchResults: [],
  searchIndex: null,

  codeViewerOpen: false,
  codeViewerNodeId: null,
  codeViewerExpanded: false,

  tourActive: false,
  currentTourStep: 0,
  tourHighlightedNodeIds: [],

  persona: 'junior',
  viewMode: 'structural',

  diffMode: false,
  diffOverlay: null,
  changedNodeIds: new Set(),
  affectedNodeIds: new Set(),

  filters: defaultFilters(),
  filterPanelOpen: false,
  nodeTypeFilters: {
    code: true, config: true, docs: true, infra: true,
    data: true, domain: true, knowledge: true,
  },
  graphViewMode: '2d',
  exportMenuOpen: false,
  pathFinderOpen: false,

  // ─── setGraph ──────────────────────────────────────────────────────────────
  setGraph: (graph) => {
    const { nodesById, nodeIdToLayerId, nodeIdToLayerIds } = buildGraphIndexes(graph);
    const searchIndex = buildSearchIndex(graph.nodes);
    const query = get().searchQuery;
    const rawResults = query.trim() ? searchIndex.search(query) : [];
    const searchResults: SearchResult[] = rawResults.map((r) => ({
      node: r.item,
      score: r.score ?? 1,
    }));
    set({
      graph,
      nodesById,
      nodeIdToLayerId,
      nodeIdToLayerIds,
      searchIndex,
      searchResults,
      // Reset tour if graph replaced
      tourActive: false,
      currentTourStep: 0,
      tourHighlightedNodeIds: [],
      // Auto-switch view mode based on graph kind
      viewMode: graph.kind === 'knowledge' ? 'knowledge' : 'structural',
    });
  },

  // ─── Selection ─────────────────────────────────────────────────────────────
  selectNode: (nodeId) => set({ selectedNodeId: nodeId }),

  navigateToNode: (nodeId) => {
    set((state) => {
      const history = state.nodeHistory;
      const last = history[history.length - 1];
      if (last === nodeId) return { selectedNodeId: nodeId };
      const newHistory = [...history, nodeId].slice(-MAX_HISTORY);
      return { selectedNodeId: nodeId, nodeHistory: newHistory };
    });
  },

  goBackNode: () => {
    set((state) => {
      const history = [...state.nodeHistory];
      history.pop(); // remove current
      const prev = history[history.length - 1] ?? null;
      return { selectedNodeId: prev, nodeHistory: history };
    });
  },

  setFocusNode: (nodeId) => set({ focusNodeId: nodeId }),

  // ─── Search ────────────────────────────────────────────────────────────────
  setSearchQuery: (query) => {
    const { searchIndex } = get();
    const rawResults = query.trim() && searchIndex ? searchIndex.search(query) : [];
    const searchResults: SearchResult[] = rawResults.map((r) => ({
      node: r.item,
      score: r.score ?? 1,
    }));
    set({ searchQuery: query, searchResults });
  },

  // ─── Code viewer ───────────────────────────────────────────────────────────
  openCodeViewer: (nodeId) => set({ codeViewerOpen: true, codeViewerNodeId: nodeId }),
  closeCodeViewer: () => set({ codeViewerOpen: false, codeViewerNodeId: null, codeViewerExpanded: false }),
  toggleCodeViewerExpanded: () => set((s) => ({ codeViewerExpanded: !s.codeViewerExpanded })),

  // ─── Tour ──────────────────────────────────────────────────────────────────
  startTour: () => {
    const { graph } = get();
    const tour = graph?.tours?.[0] ?? null;
    const nodeIds = getTourHighlightedNodeIds(tour, 0);
    set({ tourActive: true, currentTourStep: 0, tourHighlightedNodeIds: nodeIds });
  },

  stopTour: () => set({ tourActive: false, tourHighlightedNodeIds: [] }),

  nextTourStep: () => {
    const { graph, currentTourStep } = get();
    const tour = graph?.tours?.[0] ?? null;
    if (!tour) return;
    const next = Math.min(currentTourStep + 1, tour.steps.length - 1);
    set({ currentTourStep: next, tourHighlightedNodeIds: getTourHighlightedNodeIds(tour, next) });
  },

  prevTourStep: () => {
    const { graph, currentTourStep } = get();
    const tour = graph?.tours?.[0] ?? null;
    if (!tour) return;
    const prev = Math.max(currentTourStep - 1, 0);
    set({ currentTourStep: prev, tourHighlightedNodeIds: getTourHighlightedNodeIds(tour, prev) });
  },

  setTourStep: (step) => {
    const { graph } = get();
    const tour = graph?.tours?.[0] ?? null;
    if (!tour) return;
    const clamped = Math.max(0, Math.min(step, tour.steps.length - 1));
    set({ currentTourStep: clamped, tourHighlightedNodeIds: getTourHighlightedNodeIds(tour, clamped) });
  },

  // ─── Persona ───────────────────────────────────────────────────────────────
  setPersona: (persona) => set({ persona }),

  // ─── View mode ─────────────────────────────────────────────────────────────
  setViewMode: (mode) => set({ viewMode: mode }),
  setGraphViewMode: (mode) => set({ graphViewMode: mode }),

  // ─── Diff ──────────────────────────────────────────────────────────────────
  setDiffOverlay: (overlay) => set({
    diffOverlay: overlay,
    changedNodeIds: new Set(overlay.changedNodeIds),
    affectedNodeIds: new Set(overlay.affectedNodeIds),
    diffMode: true,
  }),

  toggleDiffMode: () => set((s) => ({ diffMode: !s.diffMode })),

  clearDiffOverlay: () => set({
    diffOverlay: null,
    diffMode: false,
    changedNodeIds: new Set(),
    affectedNodeIds: new Set(),
  }),

  // ─── Filters ───────────────────────────────────────────────────────────────
  setFilters: (partial) => set((s) => ({ filters: { ...s.filters, ...partial } })),
  resetFilters: () => set({ filters: defaultFilters() }),
  hasActiveFilters: () => {
    const { filters } = get();
    const def = defaultFilters();
    return (
      filters.nodeTypes.size !== def.nodeTypes.size ||
      filters.complexities.size !== def.complexities.size ||
      filters.layerIds.size !== 0 ||
      filters.edgeCategories.size !== def.edgeCategories.size ||
      filters.riskLevels.size !== def.riskLevels.size
    );
  },

  toggleNodeTypeFilter: (category) => {
    set((s) => {
      const updated = { ...s.nodeTypeFilters, [category]: !s.nodeTypeFilters[category] };
      // Sync nodeTypes set from the category toggles
      const enabled = new Set<NodeType>();
      for (const [cat, on] of Object.entries(updated) as [NodeCategory, boolean][]) {
        if (on) {
          for (const [nodeType, nodeCategory] of Object.entries(NODE_TYPE_TO_CATEGORY) as [NodeType, NodeCategory][]) {
            if (nodeCategory === cat) enabled.add(nodeType);
          }
        }
      }
      return {
        nodeTypeFilters: updated,
        filters: { ...s.filters, nodeTypes: enabled },
      };
    });
  },

  toggleFilterPanel: () => set((s) => ({ filterPanelOpen: !s.filterPanelOpen })),

  // ─── Toolbar ───────────────────────────────────────────────────────────────
  toggleExportMenu: () => set((s) => ({ exportMenuOpen: !s.exportMenuOpen })),
  togglePathFinder: () => set((s) => ({ pathFinderOpen: !s.pathFinderOpen })),
}));
