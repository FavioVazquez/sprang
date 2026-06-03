import { useState, useMemo, useCallback } from 'react';
import { X, Route, ArrowRight, Search, AlertCircle } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import Fuse from 'fuse.js';
import { useDashboardStore } from '../store';
import type { SprangNode, KnowledgeGraph } from '../types';

// ─── BFS path finder ──────────────────────────────────────────────────────────

interface PathResult {
  path: string[];      // node IDs in order
  edgeTypes: string[]; // edge types along the path (length = path.length - 1)
}

function findShortestPath(
  graph: KnowledgeGraph,
  sourceId: string,
  targetId: string,
  maxDepth = 10,
): PathResult | null {
  if (sourceId === targetId) return { path: [sourceId], edgeTypes: [] };

  // Build adjacency: nodeId → [{neighbor, edgeType}]
  const adj = new Map<string, Array<{ id: string; type: string }>>();
  for (const node of graph.nodes) adj.set(node.id, []);
  for (const edge of graph.edges) {
    adj.get(edge.source)?.push({ id: edge.target, type: edge.type });
    adj.get(edge.target)?.push({ id: edge.source, type: edge.type });
  }

  // BFS
  const visited = new Set<string>([sourceId]);
  const queue: Array<{ id: string; path: string[]; edges: string[] }> = [
    { id: sourceId, path: [sourceId], edges: [] },
  ];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.path.length > maxDepth) continue;

    for (const neighbor of adj.get(current.id) ?? []) {
      if (visited.has(neighbor.id)) continue;
      visited.add(neighbor.id);
      const newPath = [...current.path, neighbor.id];
      const newEdges = [...current.edges, neighbor.type];
      if (neighbor.id === targetId) {
        return { path: newPath, edgeTypes: newEdges };
      }
      queue.push({ id: neighbor.id, path: newPath, edges: newEdges });
    }
  }

  return null;
}

// ─── Node search input ────────────────────────────────────────────────────────

function NodeSearchInput({
  label,
  value,
  onChange,
  nodes,
}: {
  label: string;
  value: SprangNode | null;
  onChange: (node: SprangNode | null) => void;
  nodes: SprangNode[];
}) {
  const [query, setQuery] = useState(value?.label ?? '');
  const [open, setOpen] = useState(false);

  const fuse = useMemo(
    () => new Fuse(nodes, { keys: ['label', 'name'], threshold: 0.35, includeScore: true }),
    [nodes],
  );

  const results = useMemo(
    () => query.trim() ? fuse.search(query).slice(0, 8).map((r) => r.item) : [],
    [fuse, query],
  );

  const select = (node: SprangNode) => {
    setQuery(node.label);
    setOpen(false);
    onChange(node);
  };

  return (
    <div className="relative flex-1">
      <label className="block text-[10px] font-semibold uppercase tracking-wider text-surface-500 mb-1">{label}</label>
      <input
        type="text"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); onChange(null); }}
        onFocus={() => setOpen(true)}
        placeholder="Search nodes…"
        className="w-full bg-surface-800 border border-surface-700 rounded-lg text-xs text-surface-200 placeholder-surface-600 px-3 py-2 focus:outline-none focus:border-sprang-500/60"
      />
      {open && results.length > 0 && (
        <div className="absolute top-full mt-1 left-0 right-0 z-50 bg-surface-800 border border-surface-700 rounded-lg shadow-xl overflow-hidden max-h-48 overflow-y-auto">
          {results.map((node) => (
            <button
              key={node.id}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); select(node); }}
              className="w-full text-left px-3 py-2 text-xs hover:bg-surface-700 transition-colors"
            >
              <span className="text-surface-200 font-medium">{node.label}</span>
              <span className="ml-2 text-[10px] text-surface-500">{node.type}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Modal ────────────────────────────────────────────────────────────────────

export function PathFinderModal() {
  const { pathFinderOpen, togglePathFinder, graph, nodesById, navigateToNode } = useDashboardStore();
  const [source, setSource] = useState<SprangNode | null>(null);
  const [target, setTarget] = useState<SprangNode | null>(null);
  const [result, setResult] = useState<PathResult | null | 'none'>('none');

  const nodes = graph?.nodes ?? [];

  const findPath = useCallback(() => {
    if (!graph || !source || !target) return;
    const found = findShortestPath(graph, source.id, target.id);
    setResult(found ?? null);
  }, [graph, source, target]);

  return (
    <AnimatePresence>
      {pathFinderOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
            onClick={togglePathFinder}
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 4 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-lg bg-surface-900 border border-surface-700 rounded-2xl shadow-2xl shadow-black/60 overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-surface-800">
              <div className="flex items-center gap-2">
                <Route className="w-4 h-4 text-sprang-400" />
                <span className="text-sm font-semibold text-surface-100">Path Finder</span>
              </div>
              <button
                type="button"
                onClick={togglePathFinder}
                className="p-1.5 rounded text-surface-500 hover:text-surface-300 hover:bg-surface-800 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            <div className="p-5 space-y-4">
              {/* Node pickers */}
              <div className="flex items-end gap-3">
                <NodeSearchInput label="From" value={source} onChange={setSource} nodes={nodes} />
                <ArrowRight className="w-4 h-4 text-surface-500 mb-2 shrink-0" />
                <NodeSearchInput label="To" value={target} onChange={setTarget} nodes={nodes} />
              </div>

              {/* Find button */}
              <button
                type="button"
                onClick={findPath}
                disabled={!source || !target}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-sprang-500/20 border border-sprang-500/40 text-sprang-300 text-sm font-medium hover:bg-sprang-500/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Search className="w-3.5 h-3.5" />
                Find shortest path
              </button>

              {/* Results */}
              {result !== 'none' && (
                <div className="mt-2">
                  {result === null ? (
                    <div className="flex items-center gap-2 text-xs text-surface-500 bg-surface-800 rounded-lg px-3 py-2.5">
                      <AlertCircle className="w-3.5 h-3.5 text-surface-600 shrink-0" />
                      No path found between these two nodes. They may be in disconnected components.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-surface-500">
                        Path — {result.path.length} node{result.path.length !== 1 ? 's' : ''}, {result.edgeTypes.length} hop{result.edgeTypes.length !== 1 ? 's' : ''}
                      </p>
                      <div className="bg-surface-800 rounded-xl border border-surface-700 p-3 space-y-1.5 max-h-60 overflow-y-auto">
                        {result.path.map((nodeId, i) => {
                          const node = nodesById.get(nodeId);
                          const edgeType = result.edgeTypes[i];
                          return (
                            <div key={nodeId}>
                              <button
                                type="button"
                                onClick={() => { navigateToNode(nodeId); togglePathFinder(); }}
                                className="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-surface-700 transition-colors group"
                              >
                                <span className="w-5 h-5 rounded-full bg-sprang-500/20 border border-sprang-500/40 text-sprang-300 text-[10px] flex items-center justify-center shrink-0 font-semibold">
                                  {i + 1}
                                </span>
                                <div className="min-w-0 flex-1">
                                  <span className="text-xs text-surface-200 group-hover:text-surface-100 truncate block font-medium">
                                    {node?.label ?? nodeId}
                                  </span>
                                  {node?.filePath && (
                                    <span className="text-[10px] text-surface-500 font-mono truncate block">
                                      {node.filePath}
                                    </span>
                                  )}
                                </div>
                                <span className="text-[10px] text-surface-600">{node?.type}</span>
                              </button>
                              {edgeType && (
                                <div className="flex items-center gap-1 pl-7 py-0.5">
                                  <div className="w-px h-3 bg-surface-700" />
                                  <span className="text-[10px] text-surface-600 font-mono bg-surface-800/60 px-1.5 py-0.5 rounded border border-surface-700">
                                    {edgeType}
                                  </span>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      <p className="text-[10px] text-surface-600">Click any node to navigate to it in the graph.</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
