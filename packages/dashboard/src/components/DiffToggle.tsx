import { useEffect } from 'react';
import { GitCompare, X, AlertTriangle } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { useDashboardStore } from '../store';
import type { DiffOverlay } from '../types';

// ─── Loader ───────────────────────────────────────────────────────────────────

async function fetchDiffOverlay(): Promise<DiffOverlay | null> {
  try {
    const res = await fetch('/diff-overlay.json');
    if (!res.ok) return null;
    return (await res.json()) as DiffOverlay;
  } catch {
    return null;
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export function DiffToggle() {
  const { diffMode, diffOverlay, setDiffOverlay, toggleDiffMode, clearDiffOverlay } =
    useDashboardStore();

  // Auto-load overlay on mount if available
  useEffect(() => {
    if (diffOverlay) return;
    fetchDiffOverlay().then((overlay) => {
      if (overlay) setDiffOverlay(overlay);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const hasOverlay = diffOverlay !== null;

  if (!hasOverlay) {
    return (
      <button
        type="button"
        disabled
        title="No diff-overlay.json found — run /sprang-diff in your AI agent to generate one"
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs border border-surface-800 text-surface-700 cursor-not-allowed opacity-60"
      >
        <GitCompare className="w-3.5 h-3.5" />
        Diff
      </button>
    );
  }

  return (
    <div className="relative flex items-center gap-1">
      {/* Toggle */}
      <button
        type="button"
        onClick={toggleDiffMode}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium border transition-colors ${
          diffMode
            ? 'bg-amber-500/10 border-amber-500/40 text-amber-300'
            : 'bg-transparent border-surface-700 text-surface-500 hover:text-surface-300 hover:border-surface-600'
        }`}
        title={diffMode ? 'Exit diff view' : 'Show changed nodes'}
      >
        <GitCompare className="w-3.5 h-3.5" />
        Diff
        {diffMode && diffOverlay && (
          <span className="text-[10px] bg-amber-500/20 text-amber-300 px-1 rounded">
            {diffOverlay.changedNodeIds.length}
          </span>
        )}
      </button>

      {/* Clear button */}
      {hasOverlay && (
        <button
          type="button"
          onClick={clearDiffOverlay}
          className="p-1 rounded text-surface-600 hover:text-surface-400 hover:bg-surface-800 transition-colors"
          title="Clear diff overlay"
        >
          <X className="w-3 h-3" />
        </button>
      )}

      {/* Active diff info banner */}
      <AnimatePresence>
        {diffMode && diffOverlay && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="absolute top-full left-0 mt-2 z-50 w-72 bg-surface-900 border border-amber-500/30 rounded-xl shadow-xl shadow-black/50 p-3 text-xs"
          >
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
              <div className="space-y-1.5 flex-1">
                <p className="font-medium text-surface-200">
                  Diff vs <span className="font-mono text-amber-300">{diffOverlay.baseBranch}</span>
                </p>
                <div className="flex gap-3 text-[10px] text-surface-400">
                  <span>
                    <span className="text-amber-300 font-semibold">{diffOverlay.changedNodeIds.length}</span> changed
                  </span>
                  <span>
                    <span className="text-surface-300 font-semibold">{diffOverlay.affectedNodeIds.length}</span> affected
                  </span>
                  {diffOverlay.blastRadius !== undefined && (
                    <span>
                      blast radius <span className="text-surface-300 font-semibold">{(diffOverlay.blastRadius * 100).toFixed(0)}%</span>
                    </span>
                  )}
                </div>
                <p className="text-[10px] text-surface-500">
                  Generated {new Date(diffOverlay.generatedAt).toLocaleString()}
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Diff overlay applied to graph canvas nodes ───────────────────────────────

/** Returns the visual state of a node ID under diff mode */
export function getDiffNodeState(
  nodeId: string,
  diffMode: boolean,
  changedNodeIds: Set<string>,
  affectedNodeIds: Set<string>,
): 'changed' | 'affected' | 'unchanged' | null {
  if (!diffMode) return null;
  if (changedNodeIds.has(nodeId)) return 'changed';
  if (affectedNodeIds.has(nodeId)) return 'affected';
  return 'unchanged';
}
