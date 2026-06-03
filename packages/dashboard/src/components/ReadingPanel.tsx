import { useState } from 'react';
import { X, Maximize2, Minimize2, Link2, ExternalLink } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useDashboardStore } from '../store';

// ─── Component ────────────────────────────────────────────────────────────────

export function ReadingPanel() {
  const { graph, selectedNodeId, nodesById, selectNode, navigateToNode } = useDashboardStore();
  const [expanded, setExpanded] = useState(false);

  // Only show for knowledge graphs when an article node is selected
  if (graph?.kind !== 'knowledge' || !selectedNodeId) return null;

  const node = nodesById.get(selectedNodeId);
  if (!node || node.type !== 'article') return null;

  const meta = (node.knowledgeMeta ?? {}) as Record<string, unknown>;
  const frontmatter = (meta.frontmatter ?? {}) as Record<string, unknown>;
  const sourceUrl = meta.sourceUrl as string | undefined;

  // Backlinks: nodes that have an outgoing edge to this one
  const backlinks = graph?.edges
    .filter((e) => e.target === selectedNodeId)
    .map((e) => nodesById.get(e.source))
    .filter(Boolean) ?? [];

  // Outgoing wikilinks
  const outgoing = graph?.edges
    .filter((e) => e.source === selectedNodeId)
    .map((e) => ({ node: nodesById.get(e.target), type: e.type }))
    .filter((x) => x.node) ?? [];

  return (
    <AnimatePresence>
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
        className={`absolute bottom-0 left-0 right-0 z-30 bg-surface-900 border-t border-surface-700 shadow-2xl flex flex-col ${
          expanded ? 'h-[70vh]' : 'h-[45vh]'
        }`}
      >
        {/* Header bar */}
        <div className="flex items-center justify-between px-5 py-2.5 border-b border-surface-800 shrink-0 bg-surface-950/80 backdrop-blur-sm">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-sprang-400 shrink-0">
              Reading
            </span>
            <span className="text-sm font-semibold text-surface-100 truncate">{node.label}</span>
            {node.filePath && (
              <span className="text-[10px] text-surface-600 font-mono truncate hidden sm:block">
                {node.filePath}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="p-1.5 rounded text-surface-500 hover:text-surface-300 hover:bg-surface-800 transition-colors"
              title={expanded ? 'Collapse' : 'Expand'}
            >
              {expanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            </button>
            <button
              type="button"
              onClick={() => selectNode(null)}
              className="p-1.5 rounded text-surface-500 hover:text-surface-300 hover:bg-surface-800 transition-colors"
              title="Close"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 flex overflow-hidden">
          {/* Main content */}
          <div className="flex-1 overflow-y-auto p-6">
            <div className="max-w-2xl mx-auto space-y-5">
              {/* Title */}
              <h1 className="text-xl font-bold text-surface-50 leading-snug">{node.label}</h1>

              {/* Tags */}
              {node.tags && node.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {node.tags.map((tag) => (
                    <span
                      key={tag}
                      className="text-[10px] px-2 py-0.5 rounded-full bg-surface-800 border border-surface-700 text-surface-400"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              {/* Summary / content */}
              <div className="prose prose-sm prose-invert max-w-none">
                <p className="text-sm text-surface-300 leading-relaxed">{node.summary}</p>
                {node.languageNotes && (
                  <p className="text-xs text-surface-500 italic mt-3">{node.languageNotes}</p>
                )}
              </div>

              {/* Source URL */}
              {sourceUrl && (
                <a
                  href={sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-sprang-400 hover:text-sprang-300"
                >
                  <ExternalLink className="w-3 h-3" />
                  {sourceUrl}
                </a>
              )}

              {/* Frontmatter */}
              {Object.keys(frontmatter).length > 0 && (
                <div className="rounded-lg bg-surface-800/60 border border-surface-700 p-3 space-y-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-surface-500 mb-2">
                    Metadata
                  </p>
                  {Object.entries(frontmatter).map(([key, val]) => (
                    <div key={key} className="flex items-baseline gap-2 text-xs">
                      <span className="text-surface-600 w-24 shrink-0">{key}</span>
                      <span className="text-surface-400">{String(val)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Backlinks sidebar */}
          {(backlinks.length > 0 || outgoing.length > 0) && (
            <div className="w-56 shrink-0 border-l border-surface-800 overflow-y-auto bg-surface-950/50 p-3 space-y-4">
              {backlinks.length > 0 && (
                <div>
                  <div className="flex items-center gap-1 mb-2">
                    <Link2 className="w-3 h-3 text-surface-600" />
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-surface-500">
                      Backlinks ({backlinks.length})
                    </span>
                  </div>
                  <div className="space-y-0.5">
                    {backlinks.map((n) => n && (
                      <button
                        key={n.id}
                        type="button"
                        onClick={() => navigateToNode(n.id)}
                        className="w-full text-left text-xs text-surface-400 hover:text-surface-200 hover:bg-surface-800 rounded px-1.5 py-1 transition-colors truncate block"
                      >
                        {n.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {outgoing.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-surface-500 mb-2">
                    Links to ({outgoing.length})
                  </p>
                  <div className="space-y-0.5">
                    {outgoing.map(({ node: n, type }) => n && (
                      <button
                        key={n.id}
                        type="button"
                        onClick={() => navigateToNode(n.id)}
                        className="w-full text-left group"
                        title={type}
                      >
                        <span className="block text-xs text-surface-400 hover:text-surface-200 hover:bg-surface-800 rounded px-1.5 py-1 transition-colors truncate">
                          {n.label}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
