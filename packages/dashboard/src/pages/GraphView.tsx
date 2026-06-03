import React, { useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import {
  Search,
  Network,
  Activity,
  Layers,
  ChevronDown,
  Play,
  BookOpen,
} from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
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
          <div className="relative group">
            <Button variant="outline" size="sm">
              <BookOpen className="w-3.5 h-3.5" />
              Tours
              <ChevronDown className="w-3 h-3 opacity-60" />
            </Button>
            <div className="absolute right-0 top-full mt-1 w-60 bg-surface-800 border border-surface-700 rounded-lg shadow-xl shadow-black/50 z-30 py-1 overflow-hidden invisible group-hover:visible opacity-0 group-hover:opacity-100 transition-all duration-150">
              {graph.tours.map((tour) => (
                <button
                  key={tour.id}
                  className="w-full flex items-start gap-2 px-3 py-2.5 text-left hover:bg-surface-700/50 transition-colors"
                  onClick={() => handleTourStart(tour)}
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
          </div>
        )}

        {/* Search trigger */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowSearch(true)}
          className="gap-2"
          aria-label="Search (Cmd+K)"
        >
          <Search className="w-3.5 h-3.5" />
          <span className="hidden sm:inline text-surface-400 text-xs">
            Search
          </span>
          <kbd className="hidden sm:inline text-[10px] font-mono text-surface-600 bg-surface-800 border border-surface-700 px-1 rounded">
            ⌘K
          </kbd>
        </Button>
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
