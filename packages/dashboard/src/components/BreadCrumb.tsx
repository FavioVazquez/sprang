import { ChevronRight, Layers } from 'lucide-react';
import { useDashboardStore } from '../store';

interface BreadCrumbProps {
  selectedLayerId?: string;
  selectedNodeId?: string;
  onSelectLayer?: (layerId: string | undefined) => void;
  onSelectNode?: (nodeId: string | undefined) => void;
}

export function BreadCrumb({ selectedLayerId, selectedNodeId, onSelectLayer, onSelectNode }: BreadCrumbProps) {
  const { graph, nodesById } = useDashboardStore();

  if (!graph) return null;

  const layer = selectedLayerId ? graph.layers.find((l) => l.id === selectedLayerId) : undefined;
  const node = selectedNodeId ? nodesById.get(selectedNodeId) : undefined;

  if (!layer && !node) return null;

  return (
    <div className="flex items-center gap-0.5 text-xs text-surface-500 px-3 py-1.5 border-b border-surface-800 bg-surface-950 min-h-[30px] flex-shrink-0">
      <button
        type="button"
        onClick={() => { onSelectLayer?.(undefined); onSelectNode?.(undefined); }}
        className="flex items-center gap-1 hover:text-surface-300 transition-colors"
      >
        <Layers className="w-3 h-3" />
        <span>All layers</span>
      </button>

      {layer && (
        <>
          <ChevronRight className="w-3 h-3 text-surface-700 shrink-0" />
          <button
            type="button"
            onClick={() => onSelectNode?.(undefined)}
            className={`hover:text-surface-300 transition-colors truncate max-w-[140px] ${
              !node ? 'text-surface-200 font-medium' : ''
            }`}
          >
            {layer.name}
          </button>
        </>
      )}

      {node && (
        <>
          <ChevronRight className="w-3 h-3 text-surface-700 shrink-0" />
          <span className="text-surface-200 font-medium truncate max-w-[180px]">
            {node.label}
          </span>
        </>
      )}
    </div>
  );
}
