import React, { useMemo, useRef, useState, useCallback, useEffect } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { LayoutGrid } from 'lucide-react';
import { useDashboardStore } from '../store';
import { getRiskColor } from '../api/graphApi';
import { toMatrixData } from '../utils/graphTransform';
import type { KnowledgeGraph } from '../types';

interface MatrixViewProps {
  graph: KnowledgeGraph;
  onNodeSelect: (nodeId: string) => void;
}

const LABEL_MARGIN = 110; // px for row labels
const TOP_MARGIN = 110; // px for rotated col labels
const CELL = 10; // px per cell
const GAP = 1;

export function MatrixView({ graph, onNodeSelect }: MatrixViewProps) {
  const { selectedNodeId } = useDashboardStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoveredRow, setHoveredRow] = useState<number | null>(null);
  const [hoveredCol, setHoveredCol] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);
  const shouldReduce = useReducedMotion();

  const { nodes, cells } = useMemo(() => toMatrixData(graph, 120), [graph]);
  const n = nodes.length;

  const selectedRows = useMemo(() => {
    if (!selectedNodeId) return new Set<number>();
    const s = new Set<number>();
    nodes.forEach((nd, i) => { if (nd.id === selectedNodeId) s.add(i); });
    return s;
  }, [selectedNodeId, nodes]);

  const maxWeight = useMemo(() => Math.max(...cells.map((c) => c.weight), 1), [cells]);

  const gridW = n * (CELL + GAP);
  const gridH = n * (CELL + GAP);
  const svgW = LABEL_MARGIN + gridW;
  const svgH = TOP_MARGIN + gridH;

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGElement>) => {
    const svg = e.currentTarget.closest('svg');
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const x = (e.clientX - rect.left) / zoom - LABEL_MARGIN;
    const y = (e.clientY - rect.top) / zoom - TOP_MARGIN;
    const col = Math.floor(x / (CELL + GAP));
    const row = Math.floor(y / (CELL + GAP));
    setHoveredCol(col >= 0 && col < n ? col : null);
    setHoveredRow(row >= 0 && row < n ? row : null);
  }, [n, zoom]);

  const handleClick = useCallback((e: React.MouseEvent<SVGElement>) => {
    const svg = e.currentTarget.closest('svg');
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const x = (e.clientX - rect.left) / zoom - LABEL_MARGIN;
    const y = (e.clientY - rect.top) / zoom - TOP_MARGIN;
    const col = Math.floor(x / (CELL + GAP));
    const row = Math.floor(y / (CELL + GAP));
    // Click row label area → select that node
    if (x < 0 && row >= 0 && row < n) {
      const nd = nodes[row];
      if (nd) onNodeSelect(nd.id);
    }
    // Click cell → select source node
    if (col >= 0 && col < n && row >= 0 && row < n) {
      const nd = nodes[row];
      if (nd) onNodeSelect(nd.id);
    }
  }, [n, nodes, onNodeSelect, zoom]);

  const handleMouseLeave = useCallback(() => {
    setHoveredRow(null);
    setHoveredCol(null);
  }, []);

  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.1 : -0.1;
    setZoom((z) => Math.max(0.4, Math.min(3, z + delta)));
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  if (n === 0) {
    return (
      <div className="flex-1 flex items-center justify-center bg-surface-950 text-surface-500 text-sm">
        <div className="text-center space-y-2">
          <LayoutGrid className="w-8 h-8 mx-auto text-surface-700" />
          <p>No import edges found.</p>
          <p className="text-xs text-surface-600">Run analysis to see the dependency matrix.</p>
        </div>
      </div>
    );
  }

  const hoveredNode = hoveredRow !== null ? nodes[hoveredRow] : hoveredCol !== null ? nodes[hoveredCol] : null;

  return (
    <div className="flex-1 flex flex-col bg-surface-950 overflow-hidden">
      {/* Toolbar */}
      <header className="flex items-center gap-3 px-4 py-2 bg-surface-900/80 border-b border-surface-800 flex-shrink-0">
        <LayoutGrid className="w-4 h-4 text-sprang-400" />
        <span className="text-sm font-semibold text-surface-100">Dependency Matrix</span>
        <span className="text-xs text-surface-500">{n} files × {cells.length} edges</span>
        <div className="flex-1" />
        {hoveredNode && (
          <span className="text-xs text-surface-400 font-mono hidden md:block">{hoveredNode.label}</span>
        )}
        <span className="text-xs text-surface-600 hidden sm:block">Scroll to zoom · Click row to select</span>
        <span className="text-xs text-surface-500">{Math.round(zoom * 100)}%</span>
      </header>

      <div ref={containerRef} className="flex-1 overflow-auto">
        <div style={{ width: svgW * zoom, height: svgH * zoom }}>
          <svg
            width={svgW * zoom}
            height={svgH * zoom}
            onMouseMove={handleMouseMove}
            onClick={handleClick}
            onMouseLeave={handleMouseLeave}
            style={{ display: 'block' }}
            role="grid"
            aria-label="Dependency matrix"
          >
            <g transform={`scale(${zoom})`}>
              {/* Background */}
              <rect width={svgW} height={svgH} fill="#09090b" />

              {/* Row labels */}
              {nodes.map((nd, i) => {
                const y = TOP_MARGIN + i * (CELL + GAP) + CELL / 2 + 3;
                const isHovered = hoveredRow === i;
                const isSelected = selectedRows.has(i);
                return (
                  <motion.text
                    key={`row-${nd.id}`}
                    x={LABEL_MARGIN - 6}
                    y={y}
                    textAnchor="end"
                    fontSize={8}
                    fontFamily="JetBrains Mono, monospace"
                    fill={isSelected ? '#d946ef' : isHovered ? '#e4e4e7' : '#52525b'}
                    initial={shouldReduce ? {} : { opacity: 0, x: LABEL_MARGIN - 6 + 10 }}
                    animate={{ opacity: 1, x: LABEL_MARGIN - 6 }}
                    transition={{ delay: shouldReduce ? 0 : Math.min(i * 0.005, 0.3), duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                    style={{ userSelect: 'none', cursor: 'pointer' }}
                  >
                    {nd.label.length > 18 ? nd.label.slice(0, 16) + '…' : nd.label}
                  </motion.text>
                );
              })}

              {/* Col labels (rotated 45°) */}
              {nodes.map((nd, i) => {
                const x = LABEL_MARGIN + i * (CELL + GAP) + CELL / 2;
                const isHovered = hoveredCol === i;
                const isSelected = selectedRows.has(i);
                return (
                  <text
                    key={`col-${nd.id}`}
                    x={x}
                    y={TOP_MARGIN - 4}
                    textAnchor="start"
                    fontSize={8}
                    fontFamily="JetBrains Mono, monospace"
                    fill={isSelected ? '#d946ef' : isHovered ? '#e4e4e7' : '#3f3f46'}
                    transform={`rotate(-45, ${x}, ${TOP_MARGIN - 4})`}
                    style={{ userSelect: 'none' }}
                  >
                    {nd.label.length > 14 ? nd.label.slice(0, 12) + '…' : nd.label}
                  </text>
                );
              })}

              {/* Row highlight */}
              {hoveredRow !== null && (
                <rect
                  x={LABEL_MARGIN}
                  y={TOP_MARGIN + hoveredRow * (CELL + GAP)}
                  width={gridW}
                  height={CELL}
                  fill="rgba(217,70,239,0.08)"
                  pointerEvents="none"
                />
              )}
              {/* Col highlight */}
              {hoveredCol !== null && (
                <rect
                  x={LABEL_MARGIN + hoveredCol * (CELL + GAP)}
                  y={TOP_MARGIN}
                  width={CELL}
                  height={gridH}
                  fill="rgba(217,70,239,0.08)"
                  pointerEvents="none"
                />
              )}

              {/* Empty grid cells */}
              {nodes.map((_, row) =>
                nodes.map((_, col) => (
                  <rect
                    key={`empty-${row}-${col}`}
                    x={LABEL_MARGIN + col * (CELL + GAP)}
                    y={TOP_MARGIN + row * (CELL + GAP)}
                    width={CELL}
                    height={CELL}
                    fill="#18181b"
                    rx={1}
                  />
                ))
              )}

              {/* Filled cells (edges) */}
              {cells.map(({ row, col, weight }) => {
                const opacity = 0.3 + (weight / maxWeight) * 0.7;
                const nd = nodes[row];
                const riskColor = nd ? getRiskColor(nd.risk_score ?? 0) : '#d946ef';
                const isRowHovered = hoveredRow === row;
                const isColHovered = hoveredCol === col;
                return (
                  <rect
                    key={`cell-${row}-${col}`}
                    x={LABEL_MARGIN + col * (CELL + GAP)}
                    y={TOP_MARGIN + row * (CELL + GAP)}
                    width={CELL}
                    height={CELL}
                    fill={riskColor}
                    fillOpacity={isRowHovered || isColHovered ? Math.min(opacity + 0.3, 1) : opacity}
                    rx={1}
                  />
                );
              })}

              {/* Diagonal (self) marker */}
              {nodes.map((_, i) => (
                <rect
                  key={`diag-${i}`}
                  x={LABEL_MARGIN + i * (CELL + GAP)}
                  y={TOP_MARGIN + i * (CELL + GAP)}
                  width={CELL}
                  height={CELL}
                  fill="#3f3f46"
                  rx={1}
                />
              ))}
            </g>
          </svg>
        </div>
      </div>
    </div>
  );
}
