import React, { useState, useRef, useEffect } from 'react';
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
} from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Tooltip } from '../components/ui/Tooltip';
import { GraphCanvas } from '../components/GraphCanvas';
import { NodePanel } from '../components/NodePanel';
import { RiskOverlay } from '../components/RiskOverlay';
import { TourPlayer } from '../components/TourPlayer';
import { SearchBar } from '../components/SearchBar';
import type { KnowledgeGraph, Tour } from '../types';

interface GraphViewProps {
  graph: KnowledgeGraph;
  selectedNodeId?: string;
  onNodeSelect: (nodeId: string) => void;
  showRiskOverlay: boolean;
  onToggleRisk: () => void;
  activeTour: Tour | null;
  onStartTour: (tour: Tour) => void;
  onEndTour: () => void;
}

export function GraphView({
  graph,
  selectedNodeId,
  onNodeSelect,
  showRiskOverlay,
  onToggleRisk,
  activeTour,
  onStartTour,
  onEndTour,
}: GraphViewProps) {
  const [showSearch, setShowSearch] = useState(false);
  const [tourStep, setTourStep] = useState(0);
  const [hoveredLayerId, setHoveredLayerId] = useState<string | undefined>();
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

  const handleTourStart = (tour: Tour) => {
    onStartTour(tour);
    setTourStep(0);
    // Navigate to first step's node
    if (tour.steps[0]) {
      onNodeSelect(tour.steps[0].node_id);
    }
  };

  const handleTourStep = (step: number) => {
    setTourStep(step);
    const tourNode = activeTour?.steps[step]?.node_id;
    if (tourNode) onNodeSelect(tourNode);
  };

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

        {/* Spacer */}
        <div className="flex-1" />

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
                    onClick={() => { handleTourStart(tour); setShowTourMenu(false); }}
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

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Graph canvas */}
        <div className="flex-1 relative overflow-hidden">
          <GraphCanvas
            graph={graph}
            selectedNodeId={selectedNodeId}
            onNodeSelect={handleNodeSelect}
            showRiskOverlay={showRiskOverlay}
            hoveredLayerId={hoveredLayerId}
          />

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

        {/* Node panel */}
        <NodePanel
          node={selectedNode}
          graph={graph}
          onClose={() => onNodeSelect('')}
        />
      </div>

      {/* Tour player */}
      <AnimatePresence>
        {activeTour && (
          <TourPlayer
            tour={activeTour}
            currentStep={tourStep}
            onStepChange={handleTourStep}
            onClose={onEndTour}
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
