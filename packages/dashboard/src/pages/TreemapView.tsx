import React, { useMemo, useRef, useEffect, useState, useCallback } from 'react';
import { hierarchy, treemap as d3Treemap, type HierarchyRectangularNode } from 'd3-hierarchy';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { Grid3x3, ZoomIn, ZoomOut } from 'lucide-react';
import { useDashboardStore } from '../store';
import { getRiskColor } from '../api/graphApi';
import { toHierarchyData, type TreeNode } from '../utils/graphTransform';
import type { KnowledgeGraph } from '../types';

interface TreemapViewProps {
  graph: KnowledgeGraph;
  onNodeSelect: (nodeId: string) => void;
}

const LAYER_ACCENT: Record<string, string> = {
  infrastructure: '#3b82f6', infra: '#3b82f6',
  config: '#d97706',
  schema: '#84cc16',
  data: '#06b6d4',
  domain: '#22c55e',
  api: '#8b5cf6',
  ui: '#ec4899', view: '#ec4899',
};

function getLinesLabel(lines?: number): string {
  if (!lines) return '';
  if (lines < 50) return `${lines}L`;
  if (lines < 1000) return `${lines}L`;
  return `${(lines / 1000).toFixed(1)}kL`;
}

type LayoutNode = HierarchyRectangularNode<TreeNode>;

export function TreemapView({ graph, onNodeSelect }: TreemapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ width: 900, height: 600 });
  const [hovered, setHovered] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const { selectedNodeId } = useDashboardStore();
  const shouldReduce = useReducedMotion();

  const hierarchyData = useMemo(() => toHierarchyData(graph), [graph]);

  // Track container size
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const e = entries[0];
      if (e) setDims({ width: e.contentRect.width, height: e.contentRect.height });
    });
    ro.observe(el);
    const rect = el.getBoundingClientRect();
    if (rect.width > 0) setDims({ width: rect.width, height: rect.height });
    return () => ro.disconnect();
  }, []);

  const layoutNodes = useMemo<LayoutNode[]>(() => {
    if (dims.width < 10 || dims.height < 10) return [];
    const root = hierarchy<TreeNode>(hierarchyData)
      .sum((d) => (!d.children || d.children.length === 0 ? d.lines ?? 50 : 0))
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

    d3Treemap<TreeNode>()
      .size([dims.width, dims.height])
      .paddingOuter(4)
      .paddingTop(18)
      .paddingInner(2)
      .round(true)(root);

    // Collect leaf nodes only (files)
    const leaves: LayoutNode[] = [];
    root.each((node) => {
      if (!node.children) leaves.push(node as LayoutNode);
    });
    return leaves;
  }, [hierarchyData, dims]);

  // Only count actual file nodes (have nodeId); the d3 hierarchy root node with empty
  // children: [] is treated as a leaf by d3 but has no nodeId.
  const fileCount = layoutNodes.filter((n) => n.data.nodeId).length;

  const handleKeyZoom = useCallback((e: React.KeyboardEvent) => {
    if (e.key === '+' || e.key === '=') setZoom((z) => Math.min(z + 0.25, 3));
    if (e.key === '-') setZoom((z) => Math.max(z - 0.25, 0.5));
  }, []);

  if (fileCount === 0) {
    return (
      <div className="flex-1 flex items-center justify-center bg-surface-950 text-surface-500 text-sm">
        <div className="text-center space-y-2">
          <Grid3x3 className="w-8 h-8 mx-auto text-surface-700" />
          <p>No file nodes found.</p>
          <p className="text-xs text-surface-600">Run analysis to see the treemap.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-surface-950 overflow-hidden">
      {/* Toolbar */}
      <header className="flex items-center gap-3 px-4 py-2 bg-surface-900/80 border-b border-surface-800 flex-shrink-0 z-10">
        <Grid3x3 className="w-4 h-4 text-sprang-400" />
        <span className="text-sm font-semibold text-surface-100">Treemap</span>
        <span className="text-xs text-surface-500">{fileCount} files</span>
        <div className="flex-1" />
        <span className="text-xs text-surface-600 hidden sm:block">
          Tile size = lines of code · Color = risk
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setZoom((z) => Math.max(z - 0.25, 0.5))}
            className="p-1.5 rounded text-surface-500 hover:text-surface-200 hover:bg-surface-800 transition-colors"
            title="Zoom out"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <span className="text-xs text-surface-500 w-8 text-center">{Math.round(zoom * 100)}%</span>
          <button
            onClick={() => setZoom((z) => Math.min(z + 0.25, 3))}
            className="p-1.5 rounded text-surface-500 hover:text-surface-200 hover:bg-surface-800 transition-colors"
            title="Zoom in"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      {/* Canvas */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto relative"
        onKeyDown={handleKeyZoom}
        tabIndex={0}
        role="region"
        aria-label="Treemap visualization"
      >
        <div
          style={{
            width: dims.width * zoom,
            height: dims.height * zoom,
            position: 'relative',
            transformOrigin: 'top left',
          }}
        >
          <svg width={dims.width * zoom} height={dims.height * zoom}>
            <g transform={`scale(${zoom})`}>
              <AnimatePresence>
                {layoutNodes.map((node, idx) => {
                  const w = node.x1 - node.x0;
                  const h = node.y1 - node.y0;
                  if (w < 4 || h < 4) return null;

                  const d = node.data;
                  const risk = d.riskScore ?? 0;
                  const isSelected = d.nodeId === selectedNodeId;
                  const isHovered = d.nodeId === hovered;
                  const fillColor = getRiskColor(risk);
                  const layerAccent = LAYER_ACCENT[d.layer ?? ''];
                  const showLabel = w > 48 && h > 18;
                  const showSubLabel = w > 72 && h > 30;

                  return (
                    <motion.g
                      key={d.path}
                      initial={shouldReduce ? {} : { opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{
                        delay: shouldReduce ? 0 : Math.min(idx * 0.008, 0.4),
                        duration: 0.22,
                        ease: [0.22, 1, 0.36, 1],
                      }}
                      style={{ transformOrigin: `${node.x0 + w / 2}px ${node.y0 + h / 2}px` }}
                      onClick={() => d.nodeId && onNodeSelect(d.nodeId)}
                      onMouseEnter={() => d.nodeId && setHovered(d.nodeId)}
                      onMouseLeave={() => setHovered(null)}
                      cursor={d.nodeId ? 'pointer' : 'default'}
                      role={d.nodeId ? 'button' : undefined}
                      aria-label={d.nodeId ? `${d.name} — ${getLinesLabel(d.lines)} — risk ${Math.round(risk * 100)}%` : undefined}
                      aria-pressed={isSelected}
                    >
                      {/* Background fill */}
                      <rect
                        x={node.x0 + 1}
                        y={node.y0 + 1}
                        width={w - 2}
                        height={h - 2}
                        fill={fillColor}
                        fillOpacity={isHovered || isSelected ? 0.45 : 0.22}
                        rx={3}
                      />

                      {/* Layer accent top border */}
                      {layerAccent && (
                        <rect
                          x={node.x0 + 1}
                          y={node.y0 + 1}
                          width={w - 2}
                          height={3}
                          fill={layerAccent}
                          fillOpacity={0.8}
                          rx={3}
                        />
                      )}

                      {/* Selection / hover ring */}
                      <rect
                        x={node.x0 + 0.5}
                        y={node.y0 + 0.5}
                        width={w - 1}
                        height={h - 1}
                        fill="none"
                        stroke={isSelected ? '#d946ef' : isHovered ? fillColor : 'rgba(255,255,255,0.08)'}
                        strokeWidth={isSelected ? 2 : isHovered ? 1.5 : 1}
                        rx={3}
                      />

                      {/* Label */}
                      {showLabel && (
                        <text
                          x={node.x0 + 6}
                          y={node.y0 + (showSubLabel ? 16 : h / 2 + 4)}
                          fontSize={10}
                          fontFamily="JetBrains Mono, monospace"
                          fill="rgba(255,255,255,0.85)"
                          style={{ userSelect: 'none', pointerEvents: 'none' }}
                        >
                          <tspan>{d.name.length > 22 ? d.name.slice(0, 20) + '…' : d.name}</tspan>
                        </text>
                      )}
                      {showSubLabel && (
                        <text
                          x={node.x0 + 6}
                          y={node.y0 + 28}
                          fontSize={9}
                          fontFamily="JetBrains Mono, monospace"
                          fill="rgba(255,255,255,0.4)"
                          style={{ userSelect: 'none', pointerEvents: 'none' }}
                        >
                          {getLinesLabel(d.lines)}
                        </text>
                      )}
                    </motion.g>
                  );
                })}
              </AnimatePresence>
            </g>
          </svg>
        </div>
      </div>
    </div>
  );
}
