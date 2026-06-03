import { ExternalLink, BookOpen, Tag, Link, Link2 } from 'lucide-react';
import { useDashboardStore } from '../store';

// ─── Node link button ─────────────────────────────────────────────────────────

function NodeLink({ nodeId }: { nodeId: string }) {
  const { nodesById, navigateToNode } = useDashboardStore();
  const node = nodesById.get(nodeId);
  return (
    <button
      type="button"
      onClick={() => navigateToNode(nodeId)}
      className="text-left w-full flex items-start gap-1.5 px-2 py-1.5 rounded-md hover:bg-surface-800 transition-colors group"
    >
      <span className="text-[10px] text-surface-600 font-mono mt-0.5 shrink-0 w-14 truncate">
        {node?.type ?? '?'}
      </span>
      <span className="text-xs text-surface-300 group-hover:text-surface-100 truncate">
        {node?.label ?? nodeId}
      </span>
    </button>
  );
}

// ─── Confidence bar ────────────────────────────────────────────────────────────

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = value >= 0.8 ? 'bg-green-500' : value >= 0.5 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-surface-800 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] text-surface-500">{pct}%</span>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function KnowledgeInfo() {
  const { graph, selectedNodeId, nodesById, navigateToNode } = useDashboardStore();

  if (!graph || !selectedNodeId) return null;
  const node = nodesById.get(selectedNodeId);
  if (!node) return null;

  const meta = (node.knowledgeMeta ?? {}) as Record<string, unknown>;
  const frontmatter = (meta.frontmatter ?? {}) as Record<string, unknown>;
  const sourceUrl = meta.sourceUrl as string | undefined;
  const confidence = meta.confidence as number | undefined;
  const wikilinks = (meta.wikilinks as string[] | undefined) ?? [];
  const backlinks = (meta.backlinks as string[] | undefined) ?? [];

  // Build outgoing and incoming edges from graph
  const outgoing = graph.edges.filter((e) => e.source === selectedNodeId);
  const incoming = graph.edges.filter((e) => e.target === selectedNodeId);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-surface-800 shrink-0">
        <div className="flex items-center gap-1.5 mb-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-sprang-400">
            {node.type}
          </span>
        </div>
        <h2 className="text-sm font-semibold text-surface-100 leading-snug">{node.label}</h2>
        {node.filePath && (
          <p className="text-[10px] text-surface-600 font-mono mt-1 truncate">{node.filePath}</p>
        )}
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {/* Summary */}
        <div className="px-4 py-3 border-b border-surface-800/60">
          <p className="text-xs text-surface-300 leading-relaxed">{node.summary}</p>
        </div>

        {/* Tags */}
        {node.tags && node.tags.length > 0 && (
          <div className="px-4 py-3 border-b border-surface-800/60">
            <div className="flex items-center gap-1 mb-2">
              <Tag className="w-3 h-3 text-surface-600" />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-surface-500">Tags</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {node.tags.map((tag) => (
                <span
                  key={tag}
                  className="text-[10px] px-1.5 py-0.5 rounded-full bg-surface-800 border border-surface-700 text-surface-400"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Source URL */}
        {sourceUrl && (
          <div className="px-4 py-3 border-b border-surface-800/60">
            <div className="flex items-center gap-1 mb-1">
              <ExternalLink className="w-3 h-3 text-surface-600" />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-surface-500">Source</span>
            </div>
            <a
              href={sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-sprang-400 hover:text-sprang-300 break-all"
            >
              {sourceUrl}
            </a>
          </div>
        )}

        {/* Confidence */}
        {confidence !== undefined && (
          <div className="px-4 py-3 border-b border-surface-800/60">
            <div className="flex items-center gap-1 mb-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-surface-500">Confidence</span>
            </div>
            <ConfidenceBar value={confidence} />
          </div>
        )}

        {/* Frontmatter */}
        {Object.keys(frontmatter).length > 0 && (
          <div className="px-4 py-3 border-b border-surface-800/60">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-surface-500 mb-2">Frontmatter</p>
            <div className="space-y-1">
              {Object.entries(frontmatter).map(([key, val]) => (
                <div key={key} className="flex items-baseline gap-1.5 text-xs">
                  <span className="text-surface-600 shrink-0">{key}:</span>
                  <span className="text-surface-400 truncate">{String(val)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Outgoing edges */}
        {outgoing.length > 0 && (
          <div className="px-4 py-3 border-b border-surface-800/60">
            <div className="flex items-center gap-1 mb-2">
              <Link className="w-3 h-3 text-surface-600" />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-surface-500">
                Links out ({outgoing.length})
              </span>
            </div>
            <div className="space-y-0.5">
              {outgoing.slice(0, 12).map((e) => (
                <div key={e.target} className="flex items-center gap-1">
                  <span className="text-[9px] text-surface-600 font-mono w-20 shrink-0 truncate">{e.type}</span>
                  <NodeLink nodeId={e.target} />
                </div>
              ))}
              {outgoing.length > 12 && (
                <p className="text-[10px] text-surface-600 pl-2">+{outgoing.length - 12} more</p>
              )}
            </div>
          </div>
        )}

        {/* Backlinks (incoming edges) */}
        {incoming.length > 0 && (
          <div className="px-4 py-3">
            <div className="flex items-center gap-1 mb-2">
              <Link2 className="w-3 h-3 text-surface-600" />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-surface-500">
                Backlinks ({incoming.length})
              </span>
            </div>
            <div className="space-y-0.5">
              {incoming.slice(0, 12).map((e) => (
                <div key={e.source} className="flex items-center gap-1">
                  <span className="text-[9px] text-surface-600 font-mono w-20 shrink-0 truncate">{e.type}</span>
                  <NodeLink nodeId={e.source} />
                </div>
              ))}
              {incoming.length > 12 && (
                <p className="text-[10px] text-surface-600 pl-2">+{incoming.length - 12} more</p>
              )}
            </div>
          </div>
        )}

        {/* Empty state */}
        {outgoing.length === 0 && incoming.length === 0 && (
          <div className="px-4 py-6 text-center">
            <BookOpen className="w-6 h-6 mx-auto text-surface-700 mb-2" />
            <p className="text-xs text-surface-600">No connections yet</p>
          </div>
        )}
      </div>
    </div>
  );
}
