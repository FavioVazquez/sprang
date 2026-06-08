import React, { useState, useRef, useEffect, lazy, Suspense } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Search,
  Network,
  Activity,
  Layers,
  ChevronDown,
  Play,
  BookOpen,
  X,
  Keyboard,
  PanelLeft,
  FolderTree,
  FileCode,
  Route,
} from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Tooltip } from '../components/ui/Tooltip';
import { GraphCanvas } from '../components/GraphCanvas';
const Graph3DCanvas = lazy(() =>
  import('../components/Graph3DCanvas').then((m) => ({ default: m.Graph3DCanvas })),
);
import { NodePanel } from '../components/NodePanel';
import { RiskOverlay } from '../components/RiskOverlay';
import { TourPlayer } from '../components/TourPlayer';
import { SearchBar } from '../components/SearchBar';
import { useDashboardStore } from '../store';
import { CodeViewer } from '../components/CodeViewer';
import { FileExplorer } from '../components/FileExplorer';
import { FilterPanel } from '../components/FilterPanel';
import { DiffToggle } from '../components/DiffToggle';
import { ExportMenu } from '../components/ExportMenu';
import { PathFinderModal } from '../components/PathFinderModal';
import { KnowledgeInfo } from '../components/KnowledgeInfo';
import { ReadingPanel } from '../components/ReadingPanel';
import { LayerLegend } from '../components/LayerLegend';
import { NodeTooltip } from '../components/NodeTooltip';
import type { KnowledgeGraph } from '../types';

interface GraphViewProps {
  graph: KnowledgeGraph;
  selectedNodeId?: string;
  onNodeSelect: (nodeId: string) => void;
  showRiskOverlay: boolean;
  onToggleRisk: () => void;
  /** Kept for compatibility — tour state now driven by store. */
  activeTour?: unknown;
  onStartTour?: () => void;
  onEndTour?: () => void;
}

export function GraphView({
  graph,
  selectedNodeId,
  onNodeSelect,
  showRiskOverlay,
  onToggleRisk,
}: GraphViewProps) {
  const {
    tourActive,
    currentTourStep,
    startTour,
    stopTour,
    setTourStep,
    codeViewerOpen,
    openCodeViewer,
    diffMode,
    changedNodeIds,
    affectedNodeIds,
    graphViewMode,
    setGraphViewMode,
  } = useDashboardStore();
  const [showSearch, setShowSearch] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<'files' | 'source'>('files');
  const [hoveredLayerId, setHoveredLayerId] = useState<string | undefined>();
  const [tooltipNodeId, setTooltipNodeId] = useState<string | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [showLayerMenu, setShowLayerMenu] = useState(false);
  const [showTourMenu, setShowTourMenu] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(() => {
    try { return !localStorage.getItem('sprang:onboarded'); } catch { return false; }
  });
  const tourMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (tourMenuRef.current && !tourMenuRef.current.contains(e.target as Node)) {
        setShowTourMenu(false);
      }
    };
    if (showTourMenu) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showTourMenu]);

  const selectedNode = selectedNodeId
    ? graph.nodes.find((n) => n.id === selectedNodeId) ?? null
    : null;

  const handleNodeSelect = (nodeId: string) => {
    onNodeSelect(nodeId);
  };

  const handleTourStart = () => {
    startTour();
    // Navigate to first step's node
    const firstStep = graph.tours?.[0]?.steps?.[0];
    const firstNodeId = firstStep?.node_ids?.[0] ?? firstStep?.node_id;
    if (firstNodeId) onNodeSelect(firstNodeId);
  };

  const handleTourStep = (step: number) => {
    setTourStep(step);
    const s = graph.tours?.[0]?.steps?.[step];
    const nodeId = s?.node_ids?.[0] ?? s?.node_id;
    if (nodeId) onNodeSelect(nodeId);
  };

  const activeTour = tourActive ? (graph.tours?.[0] ?? null) : null;
  const tourStep = currentTourStep;

  return (
    <div className="flex-1 flex flex-col overflow-hidden relative">
      {/* Top bar */}
      <header className="flex items-center gap-3 px-4 py-2.5 bg-surface-900/80 backdrop-blur-sm border-b border-surface-800 z-20 flex-shrink-0">
        {/* Project name */}
        <div className="flex items-center gap-2 mr-2">
          <Network className="w-4 h-4 text-sprang-400" />
          <span className="text-sm font-semibold text-surface-100 truncate max-w-[200px]">
            {graph.project_name}
          </span>
          <Badge variant="outline" className="text-[10px]">
            {graph.phase}
          </Badge>
        </div>

        {/* Separator */}
        <div className="w-px h-5 bg-surface-800" />

        {/* Stats */}
        <div className="hidden sm:flex items-center gap-3 text-xs text-surface-500">
          <span className="flex items-center gap-1">
            <Activity className="w-3 h-3" />
            {graph.stats.node_count} nodes
          </span>
          <span>{graph.stats.edge_count} edges</span>
        </div>

        {/* Sidebar toggle */}
        <button
          onClick={() => setSidebarOpen((v) => !v)}
          className={`p-1.5 rounded transition-colors ${
            sidebarOpen
              ? 'text-sprang-400 bg-sprang-500/10'
              : 'text-surface-500 hover:text-surface-300 hover:bg-surface-800'
          }`}
          title="Toggle file explorer"
        >
          <PanelLeft className="w-3.5 h-3.5" />
        </button>

        {/* Spacer */}
        <div className="flex-1" />

        {/* 2D / 3D toggle */}
        <div className="flex items-center rounded-md overflow-hidden border border-surface-700 text-xs font-medium">
          {(['2d', '3d'] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setGraphViewMode(mode)}
              className={`px-2.5 py-1 transition-colors ${
                graphViewMode === mode
                  ? 'bg-surface-700 text-surface-50'
                  : 'text-surface-500 hover:text-surface-300 hover:bg-surface-800/50'
              }`}
              title={`Switch to ${mode.toUpperCase()} graph`}
            >
              {mode.toUpperCase()}
            </button>
          ))}
        </div>

        {/* Risk overlay toggle */}
        <RiskOverlay
          enabled={showRiskOverlay}
          onToggle={onToggleRisk}
          stats={graph.stats}
        />

        {/* Layers menu */}
        {graph.layers.length > 0 && (
          <div className="relative">
            <Tooltip
              content="Filter the graph by architectural layer. Click to highlight all nodes in that layer."
              side="bottom"
            >
              <Button
                variant={hoveredLayerId ? 'default' : 'outline'}
                size="sm"
                onClick={() => setShowLayerMenu((v) => !v)}
                className={hoveredLayerId ? 'bg-surface-700 border-0' : ''}
              >
                <Layers className="w-3.5 h-3.5" />
                Layers
                <ChevronDown className="w-3 h-3 opacity-60" />
              </Button>
            </Tooltip>

            <AnimatePresence>
              {showLayerMenu && (
                <div
                  className="absolute right-0 top-full mt-1 w-52 bg-surface-800 border border-surface-700 rounded-lg shadow-xl shadow-black/50 z-30 py-1 overflow-hidden"
                  onMouseLeave={() => {
                    setShowLayerMenu(false);
                    setHoveredLayerId(undefined);
                  }}
                >
                  <button
                    className={`w-full flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors ${
                      !hoveredLayerId
                        ? 'bg-surface-700 text-surface-50'
                        : 'text-surface-300 hover:bg-surface-700/50'
                    }`}
                    onClick={() => {
                      setHoveredLayerId(undefined);
                      setShowLayerMenu(false);
                    }}
                  >
                    <span className="w-2 h-2 rounded-full bg-surface-500" />
                    All layers
                  </button>
                  {graph.layers.map((layer, idx) => {
                    const colors = [
                      '#d946ef', '#3b82f6', '#22c55e', '#f59e0b',
                      '#ec4899', '#06b6d4', '#84cc16', '#f97316',
                    ];
                    const color = colors[idx % colors.length];
                    return (
                      <button
                        key={layer.id}
                        className={`w-full flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors ${
                          hoveredLayerId === layer.id
                            ? 'bg-surface-700 text-surface-50'
                            : 'text-surface-300 hover:bg-surface-700/50'
                        }`}
                        onClick={() => {
                          setHoveredLayerId(
                            hoveredLayerId === layer.id ? undefined : layer.id,
                          );
                          setShowLayerMenu(false);
                        }}
                      >
                        <span
                          className="w-2 h-2 rounded-full flex-shrink-0"
                          style={{ backgroundColor: color }}
                        />
                        <span className="truncate">{layer.name}</span>
                        <span className="ml-auto text-surface-600">
                          {layer.node_ids.length}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* Tours */}
        {graph.tours.length > 0 && !activeTour && (
          <div ref={tourMenuRef} className="relative">
            <Tooltip
              content={`${graph.tours.length} guided tour${graph.tours.length !== 1 ? 's' : ''} — step-by-step walkthroughs of key areas in this codebase.`}
              side="bottom"
            >
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowTourMenu((v) => !v)}
                aria-expanded={showTourMenu}
                aria-haspopup="menu"
                className="relative"
              >
                <BookOpen className="w-3.5 h-3.5" />
                Tours
                <ChevronDown className="w-3 h-3 opacity-60" />
                {/* Subtle indicator dot when tours are available */}
                <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-sprang-500" />
              </Button>
            </Tooltip>
            {showTourMenu && (
              <div
                role="menu"
                className="absolute right-0 top-full mt-1 w-60 bg-surface-800 border border-surface-700 rounded-lg shadow-xl shadow-black/50 z-30 py-1 overflow-hidden"
              >
                {graph.tours.map((tour) => (
                  <button
                    key={tour.id}
                    role="menuitem"
                    className="w-full flex items-start gap-2 px-3 py-2.5 text-left hover:bg-surface-700/50 transition-colors focus-visible:outline-none focus-visible:bg-surface-700/50"
                    onClick={() => { handleTourStart(); setShowTourMenu(false); }}
                  >
                    <Play className="w-3 h-3 text-sprang-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-medium text-surface-200">{tour.title}</p>
                      <p className="text-[10px] text-surface-500 mt-0.5 line-clamp-2">
                        {tour.description}
                      </p>
                      <p className="text-[10px] text-surface-600 mt-0.5">
                        {tour.steps.length} steps
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Path finder */}
        <div className="relative">
          <button
            type="button"
            onClick={() => useDashboardStore.getState().togglePathFinder()}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium border border-surface-700 text-surface-500 hover:text-surface-300 hover:border-surface-600 transition-colors"
            title="Find shortest path between two nodes"
          >
            <Route className="w-3.5 h-3.5" />
            Path
          </button>
        </div>

        {/* Diff toggle */}
        <div className="relative">
          <DiffToggle />
        </div>

        {/* Filters */}
        <div className="relative">
          <FilterPanel />
        </div>

        {/* Export */}
        <ExportMenu />

        {/* Search trigger */}
        <Tooltip
          content={
            <div className="space-y-1.5">
              <p>Fuzzy-search all nodes by name or summary.</p>
              <div className="pt-1 border-t border-surface-700 space-y-0.5 text-surface-400">
                <p><kbd className="font-mono text-surface-300">⌘K</kbd> — open search</p>
                <p><kbd className="font-mono text-surface-300">g</kbd> / <kbd className="font-mono text-surface-300">h</kbd> / <kbd className="font-mono text-surface-300">d</kbd> — switch views</p>
                <p><kbd className="font-mono text-surface-300">r</kbd> — toggle risk heatmap</p>
                <p><kbd className="font-mono text-surface-300">Esc</kbd> — close panel</p>
              </div>
            </div>
          }
          side="bottom"
          align="end"
        >
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowSearch(true)}
            className="gap-2"
            aria-label="Search nodes (⌘K)"
          >
            <Search className="w-3.5 h-3.5" />
            <span className="hidden sm:inline text-surface-400 text-xs">
              Search
            </span>
            <kbd className="hidden sm:inline text-[10px] font-mono text-surface-600 bg-surface-800 border border-surface-700 px-1 rounded">
              ⌘K
            </kbd>
          </Button>
        </Tooltip>
      </header>

      {/* Path finder modal — rendered outside header so it overlays the whole view */}
      <PathFinderModal />

      {/* Phase banners */}
      {graph.phase === 'skeleton' && (
        <div className="flex items-center gap-2 px-4 py-1.5 bg-sprang-500/10 border-b border-sprang-500/20 text-xs text-sprang-300 flex-shrink-0">
          <span className="relative flex h-2 w-2 flex-shrink-0">
            <span className="relative inline-flex h-2 w-2 rounded-full bg-sprang-500" />
          </span>
          Skeleton graph ready — run <code className="mx-1 px-1 py-0.5 rounded bg-surface-800 text-sprang-200 font-mono">/sprang-analyze</code> to enrich with architecture layers, guided tour, and risk scores.
        </div>
      )}
      {/* Main content */}
      <div className="flex-1 relative overflow-hidden">
        {/* Left sidebar: FileExplorer + CodeViewer */}
        <AnimatePresence>
          {sidebarOpen && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: codeViewerOpen ? 560 : 240, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              className="relative h-full flex-shrink-0 border-r border-surface-800 bg-surface-950 z-10 overflow-hidden flex"
            >
              {/* File tree pane */}
              <div className="w-60 shrink-0 h-full flex flex-col border-r border-surface-800">
                {/* Pane tabs */}
                <div className="flex items-center border-b border-surface-800 bg-surface-900 shrink-0">
                  <button
                    onClick={() => setSidebarTab('files')}
                    className={`flex items-center gap-1 px-3 py-2 text-[11px] font-medium transition-colors ${
                      sidebarTab === 'files'
                        ? 'text-surface-200 border-b-2 border-sprang-400 -mb-px'
                        : 'text-surface-500 hover:text-surface-300'
                    }`}
                  >
                    <FolderTree className="w-3 h-3" />
                    Files
                  </button>
                  <button
                    onClick={() => { setSidebarTab('source'); if (!codeViewerOpen && selectedNodeId) openCodeViewer(selectedNodeId); }}
                    className={`flex items-center gap-1 px-3 py-2 text-[11px] font-medium transition-colors ${
                      sidebarTab === 'source'
                        ? 'text-surface-200 border-b-2 border-sprang-400 -mb-px'
                        : 'text-surface-500 hover:text-surface-300'
                    }`}
                  >
                    <FileCode className="w-3 h-3" />
                    Source
                  </button>
                </div>
                <div className="flex-1 min-h-0">
                  {sidebarTab === 'files' ? <FileExplorer /> : (
                    <CodeViewer
                      presentation="sidebar"
                      onClose={() => setSidebarTab('files')}
                      onExpand={() => setSidebarOpen(false)}
                    />
                  )}
                </div>
              </div>

              {/* Expanded code viewer pane (shows alongside file tree) */}
              {codeViewerOpen && sidebarTab === 'files' && (
                <div className="flex-1 min-w-0 h-full">
                  <CodeViewer
                    presentation="sidebar"
                    onClose={() => useDashboardStore.getState().closeCodeViewer()}
                  />
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Graph canvas — always fills full width */}
        <div
          className="absolute inset-0"
          style={{ left: sidebarOpen ? (codeViewerOpen ? 560 : 240) : 0 }}
          onMouseMove={(e) => setTooltipPos({ x: e.clientX, y: e.clientY })}
        >
          <AnimatePresence mode="wait">
            {graphViewMode === '3d' ? (
              <motion.div
                key="3d"
                className="absolute inset-0"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25 }}
              >
                <Suspense fallback={<div className="absolute inset-0 bg-surface-950" />}>
                  <Graph3DCanvas
                    graph={graph}
                    selectedNodeId={selectedNodeId}
                    onNodeSelect={handleNodeSelect}
                    showRiskOverlay={showRiskOverlay}
                  />
                </Suspense>
              </motion.div>
            ) : (
              <motion.div
                key="2d"
                className="absolute inset-0"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25 }}
              >
                <GraphCanvas
                  graph={graph}
                  selectedNodeId={selectedNodeId}
                  onNodeSelect={handleNodeSelect}
                  showRiskOverlay={showRiskOverlay}
                  hoveredLayerId={hoveredLayerId}
                  diffMode={diffMode}
                  changedNodeIds={changedNodeIds}
                  affectedNodeIds={affectedNodeIds}
                />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Layer legend — bottom-left of canvas */}
          {graph.kind !== 'knowledge' && (
            <LayerLegend
              hoveredLayerId={hoveredLayerId ?? null}
              onHover={(id) => setHoveredLayerId(id ?? undefined)}
            />
          )}

          {/* Node tooltip — follows mouse */}
          <NodeTooltip nodeId={tooltipNodeId} x={tooltipPos.x} y={tooltipPos.y} />

          {/* Empty state overlay if no nodes */}
          {graph.nodes.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center space-y-2">
                <Network className="w-12 h-12 text-surface-700 mx-auto" />
                <p className="text-surface-500 text-sm">No nodes in graph</p>
              </div>
            </div>
          )}

          {/* First-run discovery callout */}
          <AnimatePresence>
            {showOnboarding && graph.nodes.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ delay: 0.6, duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                className="absolute bottom-16 left-1/2 -translate-x-1/2 z-20 w-full max-w-md px-4"
              >
                <div className="bg-surface-800/95 backdrop-blur-sm border border-surface-700 rounded-xl px-5 py-4 shadow-xl shadow-black/50">
                  <div className="flex items-start gap-3">
                    <Keyboard className="w-4 h-4 text-sprang-400 flex-shrink-0 mt-0.5" />
                    <div className="flex-1 space-y-2.5">
                      <p className="text-sm font-semibold text-surface-100">Explore your codebase</p>
                      <div className="space-y-1.5 text-xs text-surface-400">
                        <p><span className="text-surface-200 font-medium">Click any node</span> to inspect its risk score, git history, and structural warnings.</p>
                        <p><span className="text-surface-200 font-medium">⌘K</span> to search — fuzzy-match nodes by name or summary.</p>
                        {graph.tours.length > 0 && (
                          <p><span className="text-surface-200 font-medium">Tours</span> (top-right) — guided walkthroughs of key areas.</p>
                        )}
                        <p className="text-surface-500"><span className="text-surface-300 font-medium">r</span> risk heatmap · <span className="text-surface-300 font-medium">h</span> health report · <span className="text-surface-300 font-medium">d</span> domains</p>
                      </div>
                    </div>
                    <button
                      className="flex-shrink-0 -mt-0.5 p-1 rounded text-surface-500 hover:text-surface-300 hover:bg-surface-700 transition-colors"
                      onClick={() => {
                        setShowOnboarding(false);
                        try { localStorage.setItem('sprang:onboarded', '1'); } catch { /* ignore */ }
                      }}
                      aria-label="Dismiss"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <button
                    className="mt-3 w-full text-xs text-center text-sprang-400 hover:text-sprang-300 transition-colors"
                    onClick={() => {
                      setShowOnboarding(false);
                      try { localStorage.setItem('sprang:onboarded', '1'); } catch { /* ignore */ }
                    }}
                  >
                    Got it
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Node panel / Knowledge info — absolute overlay on the right */}
        <div className="absolute top-0 right-0 h-full z-20 pointer-events-none">
          <div className="pointer-events-auto h-full">
            {graph.kind === 'knowledge' ? (
              <KnowledgeInfo />
            ) : (
              <NodePanel
                node={selectedNode}
                graph={graph}
                onClose={() => onNodeSelect('')}
              />
            )}
          </div>
        </div>

        {/* Reading panel — slides up from bottom for knowledge article nodes */}
        <ReadingPanel />
      </div>

      {/* Tour player */}
      <AnimatePresence>
        {activeTour && (
          <TourPlayer
            tour={activeTour}
            currentStep={tourStep}
            onStepChange={handleTourStep}
            onClose={stopTour}
            graph={graph}
          />
        )}
      </AnimatePresence>

      {/* Search overlay */}
      <AnimatePresence>
        {showSearch && (
          <SearchBar
            graph={graph}
            onSelect={(nodeId) => {
              onNodeSelect(nodeId);
              setShowSearch(false);
            }}
            onClose={() => setShowSearch(false)}
          />
        )}
      </AnimatePresence>

      {/* Cmd+K shortcut */}
      <KeyboardShortcut onSearch={() => setShowSearch(true)} />
    </div>
  );
}

function KeyboardShortcut({ onSearch }: { onSearch: () => void }) {
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        onSearch();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onSearch]);
  return null;
}
