import React, { useMemo, useRef, useEffect, useState, useCallback } from 'react';
import { Users } from 'lucide-react';
import { useDashboardStore } from '../store';
import { NoBehavioralData } from '../components/NoBehavioralData';
import {
  behavioralFileNodes,
  layoutBehavioralTreemap,
  knowledgeRiskLevel,
  formatShare,
  formatLines,
  KNOWLEDGE_STYLES,
  type BehavioralCell,
  type KnowledgeRiskLevel,
} from '../utils/behavioral';
import type { KnowledgeGraph } from '../types';

interface KnowledgeMapViewProps {
  graph: KnowledgeGraph;
  onNodeSelect: (nodeId: string) => void;
}

const LEVEL_ORDER: KnowledgeRiskLevel[] = ['critical', 'concentrated', 'shared', 'unknown'];

function cellLabel(cell: BehavioralCell): string {
  const b = cell.behavioral;
  const level = knowledgeRiskLevel(b);
  return (
    `${cell.path} — ${KNOWLEDGE_STYLES[level].label}; ` +
    `main developer ${b.main_developer ?? 'unknown'} at ${formatShare(b.top_share)} of recent authorship; ` +
    `bus factor ${b.bus_factor ?? 'unknown'}; ${b.revisions ?? 0} revisions`
  );
}

/**
 * Where knowledge would be lost. Same treemap geometry as the hotspot map —
 * area is still lines of code — but coloured by concentration of authorship.
 *
 * The legend is not decoration: this is derived from git authorship over a
 * bounded window and says nothing about any individual's work.
 */
export function KnowledgeMapView({ graph, onNodeSelect }: KnowledgeMapViewProps) {
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

  const counts = useMemo(() => {
    const c: Record<KnowledgeRiskLevel, number> = {
      critical: 0, concentrated: 0, shared: 0, unknown: 0,
    };
    for (const cell of cells) c[knowledgeRiskLevel(cell.behavioral)] += 1;
    return c;
  }, [cells]);

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
    return <NoBehavioralData what="knowledge map" icon={Users} />;
  }

  const hoveredCell = cells.find((c) => c.nodeId === hovered) ?? null;

  return (
    <div className="flex-1 flex flex-col bg-surface-950 overflow-hidden">
      <header className="flex items-center gap-3 px-4 py-2 bg-surface-900/80 border-b border-surface-800 flex-shrink-0 z-10">
        <Users className="w-4 h-4 text-sprang-400" />
        <span className="text-sm font-semibold text-surface-100">Knowledge map</span>
        <span className="text-xs text-surface-500">{cells.length} files</span>
        <div className="flex-1" />
        <span className="text-xs text-surface-600 hidden sm:block">
          Area = lines of code · Colour = risk of knowledge loss
        </span>
      </header>

      <div className="flex-1 flex overflow-hidden">
        <div
          ref={containerRef}
          className="flex-1 relative overflow-hidden"
          role="group"
          aria-label="Knowledge map. Cell area is lines of code, colour is risk of knowledge loss."
        >
          <svg width={dims.width} height={dims.height} data-testid="knowledge-svg">
            <defs>
              {/* Redundant, non-colour encodings so the map survives
                  deuteranopia and greyscale printing. */}
              <pattern id="knowledge-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="6" height="6" fill="transparent" />
                <line x1="0" y1="0" x2="0" y2="6" stroke="rgba(255,255,255,0.55)" strokeWidth="2" />
              </pattern>
              <pattern id="knowledge-dots" width="6" height="6" patternUnits="userSpaceOnUse">
                <circle cx="1.5" cy="1.5" r="1" fill="rgba(0,0,0,0.4)" />
              </pattern>
            </defs>
            {cells.map((cell) => {
              const level = knowledgeRiskLevel(cell.behavioral);
              const style = KNOWLEDGE_STYLES[level];
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
                  data-testid={`knowledge-cell-${cell.nodeId}`}
                  data-knowledge-level={level}
                  data-fill={style.fill}
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
                    fill={style.fill}
                    fillOpacity={isHovered || isSelected ? 0.95 : 0.8}
                    rx={2}
                  />
                  {style.pattern !== 'none' && (
                    <rect
                      x={cell.x0}
                      y={cell.y0}
                      width={Math.max(0, cell.width - 1)}
                      height={Math.max(0, cell.height - 1)}
                      fill={`url(#knowledge-${style.pattern})`}
                      fillOpacity={0.35}
                      rx={2}
                      pointerEvents="none"
                    />
                  )}
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
                      fill={level === 'shared' ? 'rgba(0,0,0,0.8)' : 'rgba(255,255,255,0.92)'}
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
            <div
              className="absolute bottom-2 left-2 px-3 py-2 rounded-md bg-surface-900/95 border border-surface-700 text-xs pointer-events-none max-w-sm"
              data-testid="knowledge-tooltip"
            >
              <p className="font-mono text-surface-200 truncate">{hoveredCell.path}</p>
              <p className="text-surface-300 mt-0.5">
                Main developer:{' '}
                <span className="text-surface-100">
                  {hoveredCell.behavioral.main_developer ?? 'unknown'}
                </span>{' '}
                · {formatShare(hoveredCell.behavioral.top_share)} of recent commits
              </p>
              <p className="text-surface-500 mt-0.5">
                bus factor {hoveredCell.behavioral.bus_factor ?? '—'} ·{' '}
                {hoveredCell.behavioral.revisions ?? 0} revisions ·{' '}
                {formatLines(hoveredCell.lines)}
              </p>
            </div>
          )}
        </div>

        <aside className="w-72 flex-shrink-0 border-l border-surface-800 bg-surface-900/40 overflow-y-auto hidden lg:block">
          <h2 className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-surface-500 border-b border-surface-800">
            Legend
          </h2>
          <ul className="p-3 space-y-2.5" data-testid="knowledge-legend">
            {LEVEL_ORDER.map((level) => {
              const style = KNOWLEDGE_STYLES[level];
              return (
                <li key={level} className="flex gap-2.5">
                  <span
                    className="w-3 h-3 mt-0.5 rounded-sm flex-shrink-0 border border-black/40"
                    style={{ background: style.fill }}
                    aria-hidden="true"
                  />
                  <span className="min-w-0">
                    <span className="block text-xs text-surface-200">
                      {style.label}{' '}
                      <span className="text-surface-500">({counts[level]})</span>
                    </span>
                    <span className="block text-[10px] text-surface-500 leading-snug">
                      {style.description}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="px-3 pb-4 text-[10px] leading-relaxed text-surface-500 border-t border-surface-800 pt-3">
            These colours are derived from git authorship over a bounded window of
            history — nothing more. They measure how concentrated the recent commit
            record is, not anyone&rsquo;s contribution, competence or value. A file marked
            &ldquo;single author&rdquo; is a request to spread knowledge, never an assessment
            of the person who wrote it.
          </p>
        </aside>
      </div>
    </div>
  );
}
