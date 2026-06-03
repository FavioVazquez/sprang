import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Activity,
  Globe,
  Network,
  RefreshCw,
  Terminal,
  Loader2,
  Sparkles,
} from 'lucide-react';
import { TooltipProvider } from './components/ui/Tooltip';
import { Button } from './components/ui/Button';
import { Badge } from './components/ui/Badge';
import { GraphView } from './pages/GraphView';
import { HealthView } from './pages/HealthView';
import { DomainView } from './pages/DomainView';
import { loadGraph } from './api/graphApi';
import type { KnowledgeGraph, Tour } from './types';

type View = 'graph' | 'health' | 'domain';

const NAV_ITEMS: Array<{
  id: View;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'graph', label: 'Graph', icon: Network },
  { id: 'health', label: 'Health', icon: Activity },
  { id: 'domain', label: 'Domains', icon: Globe },
];

function LoadingScreen() {
  return (
    <div className="fixed inset-0 bg-surface-950 flex items-center justify-center z-50">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        className="text-center space-y-5"
      >
        <div className="relative mx-auto w-14 h-14">
          <div className="absolute inset-0 rounded-2xl bg-sprang-500/20 animate-ping" />
          <div className="relative w-14 h-14 rounded-2xl bg-surface-800 border border-surface-700 flex items-center justify-center shadow-xl">
            <Network className="w-7 h-7 text-sprang-400" />
          </div>
        </div>
        <div className="space-y-1">
          <p className="text-sm font-semibold text-surface-200">Loading knowledge graph</p>
          <p className="text-xs text-surface-500">Parsing graph structure…</p>
        </div>
        <div className="flex items-center gap-1.5 justify-center">
          {[0, 1, 2].map((i) => (
            <motion.div
              key={i}
              className="w-1.5 h-1.5 rounded-full bg-sprang-500"
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
            />
          ))}
        </div>
      </motion.div>
    </div>
  );
}

function ErrorScreen({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="fixed inset-0 bg-surface-950 flex items-center justify-center z-50">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        className="text-center space-y-5 max-w-sm px-6"
      >
        <div className="mx-auto w-14 h-14 rounded-2xl bg-surface-800 border border-surface-700 flex items-center justify-center">
          <Terminal className="w-7 h-7 text-surface-500" />
        </div>
        <div className="space-y-2">
          <h2 className="text-base font-bold text-surface-200">
            No knowledge graph found
          </h2>
          <p className="text-sm text-surface-500 leading-relaxed">
            Run the sprang scanner in your project root to generate a knowledge graph.
          </p>
        </div>
        <div className="px-4 py-3 rounded-xl bg-surface-900 border border-surface-800 text-left space-y-1">
          <p className="text-[10px] uppercase tracking-widest text-surface-600 font-medium">
            Run in your project root
          </p>
          <code className="text-sm text-surface-300 font-mono">sprang scan</code>
        </div>
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw className="w-3.5 h-3.5" />
          Retry
        </Button>
      </motion.div>
    </div>
  );
}

export default function App() {
  const [graph, setGraph] = useState<KnowledgeGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [currentView, setCurrentView] = useState<View>('graph');
  const [selectedNodeId, setSelectedNodeId] = useState<string>('');
  const [showRiskOverlay, setShowRiskOverlay] = useState(false);
  const [activeTour, setActiveTour] = useState<Tour | null>(null);

  const fetchGraph = useCallback(async () => {
    setLoading(true);
    setHasError(false);
    try {
      const g = await loadGraph();
      if (g) {
        setGraph(g);
      } else {
        setHasError(true);
      }
    } catch {
      setHasError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchGraph();
  }, [fetchGraph]);

  // Poll while phase is 'skeleton'
  useEffect(() => {
    if (!graph || graph.phase === 'complete') return;
    const id = setInterval(() => void fetchGraph(), 5000);
    return () => clearInterval(id);
  }, [graph?.phase, fetchGraph]);

  const handleNodeSelect = useCallback(
    (nodeId: string) => {
      setSelectedNodeId(nodeId);
      if (nodeId && currentView !== 'graph') {
        setCurrentView('graph');
      }
    },
    [currentView],
  );

  if (loading) return <LoadingScreen />;
  if (hasError || !graph) return <ErrorScreen onRetry={fetchGraph} />;

  return (
    <TooltipProvider>
      <div className="h-screen flex flex-col bg-surface-950 overflow-hidden font-sans">
        {/* Global nav */}
        <nav className="flex items-center gap-1 px-3 py-2 bg-surface-900 border-b border-surface-800 flex-shrink-0 z-10">
          {/* Logo */}
          <div className="flex items-center gap-2 pr-3 mr-1 border-r border-surface-800">
            <div className="w-6 h-6 rounded-lg bg-sprang-500/20 flex items-center justify-center flex-shrink-0">
              <Sparkles className="w-3.5 h-3.5 text-sprang-400" />
            </div>
            <span className="text-xs font-bold text-surface-300 tracking-tight hidden sm:block">
              sprang
            </span>
          </div>

          {/* Nav tabs */}
          <div className="flex items-center gap-0.5">
            {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setCurrentView(id)}
                className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-150 ${
                  currentView === id
                    ? 'text-surface-50 bg-surface-800'
                    : 'text-surface-500 hover:text-surface-300 hover:bg-surface-800/50'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
                {id === 'health' && graph.stats.risk_summary.high > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-risk-high" />
                )}
              </button>
            ))}
          </div>

          <div className="flex-1" />

          {/* Phase + metadata */}
          <div className="hidden md:flex items-center gap-2 mr-2">
            {graph.phase === 'skeleton' && (
              <span className="flex items-center gap-1 text-xs text-sprang-400">
                <Loader2 className="w-3 h-3 animate-spin" />
                enriching…
              </span>
            )}
            {graph.languages && graph.languages.length > 0 && (
              <Badge variant="outline" className="text-[10px]">
                {graph.languages.slice(0, 2).join(', ')}
              </Badge>
            )}
            <span className="text-xs text-surface-600">v{graph.version}</span>
          </div>

          <button
            onClick={() => void fetchGraph()}
            className="p-1.5 rounded text-surface-600 hover:text-surface-300 hover:bg-surface-800 transition-colors"
            title="Refresh"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </nav>

        {/* View content */}
        <main className="flex-1 flex overflow-hidden">
          <AnimatePresence mode="wait">
            {currentView === 'graph' && (
              <motion.div
                key="graph"
                className="flex-1 flex overflow-hidden"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.12 }}
              >
                <GraphView
                  graph={graph}
                  selectedNodeId={selectedNodeId}
                  onNodeSelect={handleNodeSelect}
                  showRiskOverlay={showRiskOverlay}
                  onToggleRisk={() => setShowRiskOverlay((v) => !v)}
                  activeTour={activeTour}
                  onStartTour={(tour) => setActiveTour(tour)}
                  onEndTour={() => setActiveTour(null)}
                />
              </motion.div>
            )}

            {currentView === 'health' && (
              <motion.div
                key="health"
                className="flex-1 flex overflow-hidden"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.12 }}
              >
                <HealthView graph={graph} onNodeSelect={handleNodeSelect} />
              </motion.div>
            )}

            {currentView === 'domain' && (
              <motion.div
                key="domain"
                className="flex-1 flex overflow-hidden"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.12 }}
              >
                <DomainView graph={graph} onNodeSelect={handleNodeSelect} />
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>
    </TooltipProvider>
  );
}
