import React from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';

// ─── Layer color palette (indexed 0-8) ───────────────────────────────────────

export const LAYER_COLORS: string[] = [
  '#d946ef', // purple
  '#3b82f6', // blue
  '#22c55e', // green
  '#f59e0b', // amber
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#84cc16', // lime
  '#f97316', // orange
  '#a78bfa', // violet
];

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LayerCardNodeData {
  layerId: string;
  name: string;
  description?: string;
  fileCount: number;
  complexity: 'simple' | 'moderate' | 'complex';
  colorIndex: number;
  isSelected: boolean;
  onSelect: (layerId: string) => void;
  [key: string]: unknown; // React Flow requires index signature on node data
}

// ─── Complexity badge ─────────────────────────────────────────────────────────

function ComplexityBadge({ complexity }: { complexity: 'simple' | 'moderate' | 'complex' }) {
  const styles: Record<typeof complexity, string> = {
    simple: 'bg-surface-800 text-surface-400 border-surface-700',
    moderate: 'bg-amber-950/60 text-amber-400 border-amber-800/60',
    complex: 'bg-rose-950/60 text-rose-400 border-rose-800/60',
  };
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wide border ${styles[complexity]}`}
    >
      {complexity}
    </span>
  );
}

// ─── LayerCardNode ────────────────────────────────────────────────────────────

export default function LayerCardNode({ data }: NodeProps) {
  const d = data as LayerCardNodeData;
  const color = LAYER_COLORS[d.colorIndex % LAYER_COLORS.length];

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => d.onSelect(d.layerId)}
      onKeyDown={(e) => e.key === 'Enter' && d.onSelect(d.layerId)}
      style={{
        width: 280,
        minHeight: 160,
        borderColor: d.isSelected ? color : 'rgba(63, 63, 70, 0.8)',
        boxShadow: d.isSelected ? `0 0 0 1.5px ${color}` : undefined,
      }}
      className={`
        relative flex flex-row overflow-hidden rounded-xl
        bg-surface-900 border
        transition-all duration-150
        hover:brightness-110 hover:border-surface-600
        cursor-pointer select-none
      `}
    >
      {/* Left accent bar */}
      <div
        style={{ backgroundColor: color, width: 4, flexShrink: 0 }}
        className="self-stretch"
      />

      {/* Card content */}
      <div className="flex flex-col flex-1 min-w-0 px-4 py-3 gap-2">
        {/* Top row: LAYER chip + complexity badge */}
        <div className="flex items-center justify-between">
          <span
            style={{ color: color }}
            className="text-[10px] font-bold uppercase tracking-widest"
          >
            Layer
          </span>
          <ComplexityBadge complexity={d.complexity} />
        </div>

        {/* Layer name */}
        <h3 className="text-[18px] font-bold text-surface-50 leading-tight break-words">
          {d.name}
        </h3>

        {/* Description */}
        {d.description && (
          <p
            className="text-[12px] text-surface-500 leading-relaxed"
            style={{
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {d.description}
          </p>
        )}

        {/* Footer: file count */}
        <div className="mt-auto pt-2 border-t border-surface-800">
          <span className="text-[11px] text-surface-500 font-medium">
            {d.fileCount} {d.fileCount === 1 ? 'file' : 'files'}
          </span>
        </div>
      </div>

      {/* React Flow handles */}
      <Handle
        type="target"
        position={Position.Top}
        style={{ background: color, border: 'none', width: 8, height: 8 }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        style={{ background: color, border: 'none', width: 8, height: 8 }}
      />
    </div>
  );
}
