import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Activity,
  Globe,
  Network,
  RefreshCw,
  Terminal,
  Sparkles,
  BookOpen,
  Layers,
} from 'lucide-react';
import { TooltipProvider } from './components/ui/Tooltip';
import { Button } from './components/ui/Button';
import { Badge } from './components/ui/Badge';
import { GraphView } from './pages/GraphView';
import { HealthView } from './pages/HealthView';
import { DomainView } from './pages/DomainView';
import { ArchitectureView } from './pages/ArchitectureView';
import { LearnPanel } from './components/LearnPanel';
import { KeyboardShortcutsHelp } from './components/KeyboardShortcutsHelp';
import { WarningBanner } from './components/WarningBanner';
import { ThemePicker, useTheme } from './components/ThemePicker';
import { OnboardingOverlay, useOnboarding } from './components/OnboardingOverlay';
import { MobileBottomNav, type MobileView } from './components/MobileLayout';
import { AskAgentPanel } from './components/AskCascadePanel';
import { loadGraph } from './api/graphApi';
import { useDashboardStore } from './store';
import type { KnowledgeGraph } from './types';

type View = MobileView;

const NAV_ITEMS: Array<{
  id: View;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'graph', label: 'Graph', icon: Network },
  { id: 'health', label: 'Health', icon: Activity },
  { id: 'domain', label: 'Domains', icon: Globe },
  { id: 'architecture', label: 'Architecture', icon: Layers },
  { id: 'learn', label: 'Learn', icon: BookOpen },
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
          <p className="text-[10px] text-surface-600 font-medium">
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
  const [loading, setLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [currentView, setCurrentView] = useState<View>('graph');
  const [showRiskOverlay, setShowRiskOverlay] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [schemaWarnings, setSchemaWarnings] = useState<string[]>([]);
  const [theme, setTheme] = useTheme();
  const [showOnboarding, dismissOnboarding] = useOnboarding();

  const { graph, setGraph, selectedNodeId, navigateToNode, selectNode, startTour, stopTour } =
    useDashboardStore();

  const fetchGraph = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setHasError(false);
    try {
      const g = await loadGraph();
      if (g) {
        setGraph(g as KnowledgeGraph);
        // Collect schema warnings from stats
        const warns: string[] = [];
        if ((g as KnowledgeGraph).stats.node_count !== (g as KnowledgeGraph).nodes.length) {
          warns.push(`stats.node_count (${(g as KnowledgeGraph).stats.node_count}) differs from actual node count (${(g as KnowledgeGraph).nodes.length})`);
        }
        setSchemaWarnings(warns);
      } else {
        if (!silent) setHasError(true);
      }
    } catch {
      if (!silent) setHasError(true);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [setGraph]);

  useEffect(() => {
    void fetchGraph(false);
  }, [fetchGraph]);

  // Poll while phase is 'skeleton'. Stop after 3 unchanged polls.
  const graphTsRef = React.useRef(graph?.generated_at ?? '');
  const unchangedPollsRef = React.useRef(0);
  useEffect(() => {
    graphTsRef.current = graph?.generated_at ?? '';
  }, [graph?.generated_at]);
  useEffect(() => {
    if (!graph || graph.phase === 'complete') return;
    unchangedPollsRef.current = 0;
    const id = setInterval(async () => {
      const tsBefore = graphTsRef.current;
      await fetchGraph(true);
      if (graphTsRef.current === tsBefore) {
        unchangedPollsRef.current += 1;
        if (unchangedPollsRef.current >= 3) clearInterval(id);
      } else {
        unchangedPollsRef.current = 0;
      }
    }, 5000);
    return () => clearInterval(id);
  }, [graph?.phase, fetchGraph]);

  const handleNodeSelect = useCallback(
    (nodeId: string) => {
      navigateToNode(nodeId);
      if (nodeId && currentView !== 'graph') setCurrentView('graph');
    },
    [navigateToNode, currentView],
  );

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      switch (e.key) {
        case 'Escape':
          if (selectedNodeId) selectNode(null);
          break;
        case 'g': case '1':
          setCurrentView('graph'); break;
        case 'h': case '2':
          setCurrentView('health'); break;
        case 'd': case '3':
          setCurrentView('domain'); break;
        case 'a': case '4':
          setCurrentView('architecture'); break;
        case 'l': case '5':
          setCurrentView('learn'); break;
        case 'r':
          setShowRiskOverlay((v) => !v); break;
        case '?':
          setShowShortcuts((v) => !v); break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedNodeId, selectNode]);

  if (loading) return <LoadingScreen />;
  if (hasError || !graph) return <ErrorScreen onRetry={fetchGraph} />;

  return (
    <TooltipProvider>
      <div className="h-full flex flex-col bg-surface-950 overflow-hidden font-sans">
        <WarningBanner errors={schemaWarnings} />
        {/* Global nav */}
        <nav className="relative flex items-center gap-1 px-3 py-2 bg-surface-900 border-b border-surface-800 flex-shrink-0 z-10">
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
                className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sprang-500 ${
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
            {graph.kind === 'knowledge' && (
              <Badge variant="outline" className="text-[10px] text-amber-400 border-amber-500/40">
                knowledge
              </Badge>
            )}
            {graph.phase === 'skeleton' && (
              <Badge variant="outline" className="text-[10px] text-sprang-400 border-sprang-500/40">
                skeleton
              </Badge>
            )}
            {graph.languages && graph.languages.length > 0 && (
              <Badge variant="outline" className="text-[10px]">
                {graph.languages.slice(0, 2).join(', ')}
              </Badge>
            )}
            <span className="text-xs text-surface-600">v{graph.version}</span>
          </div>

          {/* Ask Agent */}
          <AskAgentPanel />

          {/* Theme picker */}
          <ThemePicker theme={theme} onChange={setTheme} />

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
                  selectedNodeId={selectedNodeId ?? ''}
                  onNodeSelect={handleNodeSelect}
                  showRiskOverlay={showRiskOverlay}
                  onToggleRisk={() => setShowRiskOverlay((v) => !v)}
                  activeTour={graph.tours?.[0] ?? null}
                  onStartTour={startTour}
                  onEndTour={stopTour}
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

            {currentView === 'architecture' && (
              <motion.div
                key="architecture"
                className="flex-1 flex overflow-hidden"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.12 }}
              >
                <ArchitectureView />
              </motion.div>
            )}

            {currentView === 'learn' && (
              <motion.div
                key="learn"
                className="flex-1 flex overflow-hidden"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.12 }}
              >
                <div className="flex-1 max-w-xl mx-auto w-full h-full overflow-hidden border-x border-surface-800">
                  <LearnPanel />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </main>
        <KeyboardShortcutsHelp open={showShortcuts} onClose={() => setShowShortcuts(false)} />
        {/* Mobile bottom nav */}
        <MobileBottomNav activeView={currentView} onChange={setCurrentView} />
        {/* Onboarding overlay — first run only */}
        <AnimatePresence>
          {showOnboarding && <OnboardingOverlay onDone={dismissOnboarding} />}
        </AnimatePresence>
      </div>
    </TooltipProvider>
  );
}
