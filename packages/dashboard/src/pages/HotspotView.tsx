import React, { useMemo, useRef, useEffect, useState, useCallback } from 'react';
import { Flame } from 'lucide-react';
import { useDashboardStore } from '../store';
import { NoBehavioralData } from '../components/NoBehavioralData';
import {
  behavioralFileNodes,
  layoutBehavioralTreemap,
  hotspotColor,
  hotspotBand,
  formatLines,
  HOTSPOT_STOPS,
  type BehavioralCell,
} from '../utils/behavioral';
import type { KnowledgeGraph } from '../types';

interface HotspotViewProps {
  graph: KnowledgeGraph;
  onNodeSelect: (nodeId: string) => void;
}

const BAND_LABEL: Record<ReturnType<typeof hotspotBand>, string> = {
  cold: 'cold',
  warm: 'warm',
  hot: 'hot',
  critical: 'critical',
};

function cellLabel(cell: BehavioralCell): string {
  const score = cell.behavioral.hotspot_score ?? 0;
  return (
    `${cell.path} — ${formatLines(cell.lines)}, ` +
    `hotspot ${Math.round(score * 100)}% (${BAND_LABEL[hotspotBand(score)]}), ` +
    `${cell.behavioral.revisions ?? 0} revisions`
  );
}

/**
 * Tornhill's hotspot map: **area is lines of code, colour is hotspot score**
 * (complexity percentile × churn percentile). Big and bright is where the pain
 * is concentrated, and it takes one glance rather than an afternoon.
 */
export function HotspotView({ graph, onNodeSelect }: HotspotViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ width: 900, height: 600 });
  const [hovered, setHovered] = useState<string | null>(null);
  const selectedNodeId = useDashboardStore((s) => s.selectedNodeId);

  const nodes = useMemo(() => behavioralFileNodes(graph), [graph]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const e = entries[0];
      if (e && e.contentRect.width > 0) {
        setDims({ width: e.contentRect.width, height: e.contentRect.height });
      }
    });
    ro.observe(el);
    const rect = el.getBoundingClientRect();
    if (rect.width > 0) setDims({ width: rect.width, height: rect.height });
    return () => ro.disconnect();
  }, []);

  const cells = useMemo(
    () => layoutBehavioralTreemap(nodes, dims.width, dims.height),
    [nodes, dims],
  );

  const hottest = useMemo(
    () =>
      [...cells]
        .sort(
          (a, b) => (b.behavioral.hotspot_score ?? 0) - (a.behavioral.hotspot_score ?? 0),
        )
        .slice(0, 5),
    [cells],
  );

  const activate = useCallback((nodeId: string) => onNodeSelect(nodeId), [onNodeSelect]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent, nodeId: string) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        activate(nodeId);
      }
    },
    [activate],
  );

  if (nodes.length === 0) {
    return <NoBehavioralData what="hotspot map" icon={Flame} />;
  }

  const hoveredCell = cells.find((c) => c.nodeId === hovered) ?? null;

  return (
    <div className="flex-1 flex flex-col bg-surface-950 overflow-hidden">
      <header className="flex items-center gap-3 px-4 py-2 bg-surface-900/80 border-b border-surface-800 flex-shrink-0 z-10">
        <Flame className="w-4 h-4 text-sprang-400" />
        <span className="text-sm font-semibold text-surface-100">Hotspots</span>
        <span className="text-xs text-surface-500">{cells.length} files</span>
        <div className="flex-1" />
        <span className="text-xs text-surface-600 hidden sm:block">
          Area = lines of code · Colour = complexity × churn
        </span>
        {/* Legend — a ramp that varies in lightness as well as hue */}
        <div className="flex items-center gap-1.5" aria-hidden="true">
          <span className="text-[10px] text-surface-500">cold</span>
          <div
            className="h-2 w-24 rounded-full"
            style={{
              background: `linear-gradient(to right, ${HOTSPOT_STOPS.map(
                (s) => `${s.color} ${s.at * 100}%`,
              ).join(', ')})`,
            }}
          />
          <span className="text-[10px] text-surface-500">hot</span>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        <div
          ref={containerRef}
          className="flex-1 relative overflow-hidden"
          role="group"
          aria-label="Hotspot map. Cell area is lines of code, colour is hotspot score."
        >
          <svg width={dims.width} height={dims.height} data-testid="hotspot-svg">
            {cells.map((cell) => {
              const score = cell.behavioral.hotspot_score ?? 0;
              const fill = hotspotColor(score);
              const isSelected = cell.nodeId === selectedNodeId;
              const isHovered = cell.nodeId === hovered;
              const showLabel = cell.width > 48 && cell.height > 16;
              return (
                <g
                  key={cell.nodeId}
                  role="button"
                  tabIndex={0}
                  aria-label={cellLabel(cell)}
                  aria-pressed={isSelected}
                  data-testid={`hotspot-cell-${cell.nodeId}`}
                  data-hotspot-band={hotspotBand(score)}
                  data-fill={fill}
                  cursor="pointer"
                  onClick={() => activate(cell.nodeId)}
                  onKeyDown={(e) => onKeyDown(e, cell.nodeId)}
                  onFocus={() => setHovered(cell.nodeId)}
                  onBlur={() => setHovered(null)}
                  onMouseEnter={() => setHovered(cell.nodeId)}
                  onMouseLeave={() => setHovered(null)}
                >
                  <rect
                    x={cell.x0}
                    y={cell.y0}
                    width={Math.max(0, cell.width - 1)}
                    height={Math.max(0, cell.height - 1)}
                    fill={fill}
                    fillOpacity={isHovered || isSelected ? 0.95 : 0.75}
                    rx={2}
                  />
                  <rect
                    x={cell.x0 + 0.5}
                    y={cell.y0 + 0.5}
                    width={Math.max(0, cell.width - 2)}
                    height={Math.max(0, cell.height - 2)}
                    fill="none"
                    stroke={isSelected ? '#d946ef' : 'rgba(0,0,0,0.35)'}
                    strokeWidth={isSelected ? 2 : 0.5}
                    rx={2}
                  />
                  {showLabel && (
                    <text
                      x={cell.x0 + 4}
                      y={cell.y0 + 11}
                      fontSize={9}
                      fontFamily="JetBrains Mono, monospace"
                      fill={score > 0.55 ? 'rgba(0,0,0,0.8)' : 'rgba(255,255,255,0.9)'}
                      style={{ userSelect: 'none', pointerEvents: 'none' }}
                    >
                      {cell.name.length > 20 ? `${cell.name.slice(0, 18)}…` : cell.name}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>

          {hoveredCell && (
            <div className="absolute bottom-2 left-2 px-3 py-2 rounded-md bg-surface-900/95 border border-surface-700 text-xs pointer-events-none max-w-sm">
              <p className="font-mono text-surface-200 truncate">{hoveredCell.path}</p>
              <p className="text-surface-400 mt-0.5">
                {formatLines(hoveredCell.lines)} ·{' '}
                {hoveredCell.behavioral.revisions ?? 0} revisions ·{' '}
                {hoveredCell.behavioral.bug_fixes ?? 0} bug fixes · hotspot{' '}
                {Math.round((hoveredCell.behavioral.hotspot_score ?? 0) * 100)}%{' '}
                <span className="text-surface-500">
                  ({BAND_LABEL[hotspotBand(hoveredCell.behavioral.hotspot_score ?? 0)]})
                </span>
              </p>
            </div>
          )}
        </div>

        {/* Top offenders — the same information as a list, for anyone who
            cannot read the picture. */}
        <aside className="w-64 flex-shrink-0 border-l border-surface-800 bg-surface-900/40 overflow-y-auto hidden lg:block">
          <h2 className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-surface-500 border-b border-surface-800">
            Hottest files
          </h2>
          <ul>
            {hottest.map((cell) => (
              <li key={cell.nodeId}>
                <button
                  type="button"
                  onClick={() => activate(cell.nodeId)}
                  className="w-full text-left px-3 py-2 border-b border-surface-800/60 hover:bg-surface-800/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sprang-500"
                  aria-label={cellLabel(cell)}
                >
                  <span className="flex items-center gap-2">
                    <span
                      className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                      style={{ background: hotspotColor(cell.behavioral.hotspot_score ?? 0) }}
                    />
                    <span className="text-xs font-mono text-surface-200 truncate">
                      {cell.name}
                    </span>
                  </span>
                  <span className="block mt-0.5 text-[10px] text-surface-500">
                    {Math.round((cell.behavioral.hotspot_score ?? 0) * 100)}% ·{' '}
                    {formatLines(cell.lines)} · {cell.behavioral.revisions ?? 0} revs
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  );
}
