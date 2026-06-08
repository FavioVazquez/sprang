import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Edge,
  type NodeTypes,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Layers, Terminal, X, AlertTriangle, File } from 'lucide-react';
import { useDashboardStore } from '../store';
import LayerCardNode, { LAYER_COLORS, type LayerCardNodeData } from '../components/LayerCardNode';
import { aggregateLayerEdges } from '../utils/edge-aggregation';
import { computeLayerLayout } from '../utils/elk-layout';
import type { KnowledgeGraph, SprangNode } from '../types';

// ─── Node types ───────────────────────────────────────────────────────────────

const NODE_TYPES: NodeTypes = {
  layerCard: LayerCardNode,
};

// ─── Constants ────────────────────────────────────────────────────────────────

const CARD_WIDTH = 280;
const CARD_HEIGHT = 180; // approximate for ELK

// ─── Helpers ──────────────────────────────────────────────────────────────────

const COMPLEXITY_ORDER = { simple: 0, moderate: 1, complex: 2 } as const;

function maxComplexity(
  nodeIds: string[],
  nodes: SprangNode[],
): 'simple' | 'moderate' | 'complex' {
  let max: 'simple' | 'moderate' | 'complex' = 'simple';
  for (const id of nodeIds) {
    const node = nodes.find((n) => n.id === id);
    if (node?.complexity && COMPLEXITY_ORDER[node.complexity] > COMPLEXITY_ORDER[max]) {
      max = node.complexity;
    }
  }
  return max;
}

function buildFlowElements(
  graph: KnowledgeGraph,
  positions: Map<string, { x: number; y: number }>,
  selectedLayerId: string | null,
  onSelect: (layerId: string) => void,
): { nodes: Node[]; edges: Edge[] } {
  const layerEdges = aggregateLayerEdges(graph);

  const rfNodes: Node[] = graph.layers.map((layer, idx) => {
    const pos = positions.get(layer.id) ?? { x: idx * 360, y: 0 };
    const data: LayerCardNodeData = {
      layerId: layer.id,
      name: layer.name,
      description: layer.description,
      fileCount: layer.node_ids.length,
      complexity: maxComplexity(layer.node_ids, graph.nodes),
      colorIndex: idx,
      isSelected: layer.id === selectedLayerId,
      onSelect,
    };
    return {
      id: layer.id,
      type: 'layerCard',
      position: pos,
      data,
      draggable: true,
    };
  });

  const rfEdges: Edge[] = layerEdges.map((le) => {
    const strokeWidth = Math.min(1 + Math.log2(le.count + 1), 5);
    const sourceIdx = graph.layers.findIndex((l) => l.id === le.sourceLayerId);
    const color = LAYER_COLORS[sourceIdx % LAYER_COLORS.length];
    return {
      id: `${le.sourceLayerId}--${le.targetLayerId}`,
      source: le.sourceLayerId,
      target: le.targetLayerId,
      label: String(le.count),
      style: {
        strokeWidth,
        stroke: color + '90',
      },
      labelStyle: {
        fill: '#a1a1aa',
        fontSize: 10,
        fontWeight: 600,
      },
      labelBgStyle: {
        fill: '#18181b',
        fillOpacity: 0.85,
      },
    };
  });

  return { nodes: rfNodes, edges: rfEdges };
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex-1 flex items-center justify-center bg-surface-950">
      <div className="text-center space-y-4 max-w-sm px-6">
        <div className="mx-auto w-14 h-14 rounded-2xl bg-surface-800 border border-surface-700 flex items-center justify-center">
          <Layers className="w-7 h-7 text-surface-600" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-surface-300">No architecture map yet</h2>
          <p className="text-sm text-surface-500 mt-1 leading-relaxed">
            Run the analyzer to build the architecture map with layer information.
          </p>
        </div>
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-900 border border-surface-800 text-left">
          <Terminal className="w-4 h-4 text-sprang-400 flex-shrink-0" />
          <code className="text-xs text-surface-300 font-mono">/sprang-analyze</code>
        </div>
      </div>
    </div>
  );
}

// ─── Loading state ────────────────────────────────────────────────────────────

function LoadingLayout() {
  return (
    <div className="flex-1 flex items-center justify-center bg-surface-950">
      <div className="flex flex-col items-center gap-3">
        <div className="flex items-center gap-1.5">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="w-2 h-2 rounded-full bg-sprang-500 animate-pulse"
              style={{ animationDelay: `${i * 150}ms` }}
            />
          ))}
        </div>
        <p className="text-xs text-surface-500">Computing layout…</p>
      </div>
    </div>
  );
}

// ─── Layer detail panel ──────────────────────────────────────────────────────

function getRiskColor(score: number): string {
  if (score >= 0.7) return 'text-rose-400';
  if (score >= 0.4) return 'text-amber-400';
  return 'text-emerald-400';
}

interface LayerPanelProps {
  graph: KnowledgeGraph;
  layerId: string;
  colorIndex: number;
  onClose: () => void;
}

function LayerPanel({ graph, layerId, colorIndex, onClose }: LayerPanelProps) {
  const layer = graph.layers.find((l) => l.id === layerId);
  if (!layer) return null;

  const color = LAYER_COLORS[colorIndex % LAYER_COLORS.length];
  const layerNodes = graph.nodes
    .filter((n) => layer.node_ids.includes(n.id))
    .sort((a, b) => (b.risk_score ?? 0) - (a.risk_score ?? 0));

  return (
    <div
      className="flex flex-col w-72 shrink-0 border-l border-surface-800 bg-surface-900 overflow-hidden"
      data-testid="layer-panel"
    >
      {/* Panel header */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b border-surface-800"
        style={{ borderLeftColor: color, borderLeftWidth: 3 }}
      >
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color }}>
            Layer
          </p>
          <h3 className="text-sm font-semibold text-surface-100 truncate">{layer.name}</h3>
          {layer.description && (
            <p className="text-[11px] text-surface-500 mt-0.5 leading-snug line-clamp-2">
              {layer.description}
            </p>
          )}
        </div>
        <button
          onClick={onClose}
          className="ml-2 shrink-0 p-1 rounded hover:bg-surface-800 text-surface-500 hover:text-surface-300 transition-colors"
          aria-label="Close panel"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Stats row */}
      <div className="flex gap-4 px-4 py-2 border-b border-surface-800 bg-surface-950/40">
        <div className="text-center">
          <p className="text-[18px] font-bold text-surface-100">{layerNodes.length}</p>
          <p className="text-[10px] text-surface-500 uppercase tracking-wide">files</p>
        </div>
        <div className="text-center">
          <p className="text-[18px] font-bold text-rose-400">
            {layerNodes.filter((n) => (n.risk_score ?? 0) >= 0.7).length}
          </p>
          <p className="text-[10px] text-surface-500 uppercase tracking-wide">high risk</p>
        </div>
        <div className="text-center">
          <p className="text-[18px] font-bold text-surface-100">
            {layerNodes.filter((n) => n.structural_warnings && n.structural_warnings.length > 0).length}
          </p>
          <p className="text-[10px] text-surface-500 uppercase tracking-wide">smells</p>
        </div>
      </div>

      {/* Node list */}
      <div className="flex-1 overflow-y-auto">
        {layerNodes.length === 0 ? (
          <p className="px-4 py-6 text-xs text-surface-600 text-center">No files in this layer</p>
        ) : (
          <ul className="divide-y divide-surface-800/60">
            {layerNodes.map((node) => {
              const risk = node.risk_score ?? 0;
              const hasSmells = node.structural_warnings && node.structural_warnings.length > 0;
              const label = node.label ?? node.id;
              const shortLabel = label.includes('/') ? label.split('/').pop()! : label;
              return (
                <li
                  key={node.id}
                  className="flex items-start gap-2.5 px-4 py-2.5 hover:bg-surface-800/40 transition-colors"
                >
                  <File className="w-3.5 h-3.5 mt-0.5 shrink-0 text-surface-600" />
                  <div className="min-w-0 flex-1">
                    <p
                      className="text-[12px] font-medium text-surface-200 truncate"
                      title={label}
                    >
                      {shortLabel}
                    </p>
                    {node.summary && (
                      <p className="text-[11px] text-surface-500 line-clamp-1 leading-snug">
                        {node.summary}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {hasSmells && (
                      <AlertTriangle className="w-3 h-3 text-amber-500" />
                    )}
                    <span className={`text-[11px] font-semibold tabular-nums ${getRiskColor(risk)}`}>
                      {risk.toFixed(2)}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ArchitectureView() {
  const { graph, setFilters } = useDashboardStore();
  const [positions, setPositions] = useState<Map<string, { x: number; y: number }> | null>(null);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);

  const hasLayers = Boolean(graph && graph.layers && graph.layers.length > 0);

  const allLayerEdges = useMemo(
    () => (graph ? aggregateLayerEdges(graph) : []),
    [graph],
  );

  // Run ELK layout whenever graph layers change
  useEffect(() => {
    if (!graph || !hasLayers) {
      setPositions(null);
      return;
    }

    setPositions(null); // show loading while computing

    const elkNodes = graph.layers.map((layer) => ({
      id: layer.id,
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
    }));

    const elkEdges = allLayerEdges.map((le) => ({
      id: `${le.sourceLayerId}--${le.targetLayerId}`,
      sources: [le.sourceLayerId],
      targets: [le.targetLayerId],
    }));

    computeLayerLayout(elkNodes, elkEdges)
      .then((result) => {
        setPositions(result.nodes);
      })
      .catch(() => {
        // Fallback: simple grid layout
        const fallback = new Map<string, { x: number; y: number }>();
        graph.layers.forEach((layer, idx) => {
          fallback.set(layer.id, { x: (idx % 3) * 360, y: Math.floor(idx / 3) * 260 });
        });
        setPositions(fallback);
      });
  }, [graph, hasLayers, allLayerEdges]);

  const handleSelect = useCallback(
    (layerId: string) => {
      if (selectedLayerId === layerId) {
        setSelectedLayerId(null);
        setFilters({ layerIds: new Set<string>() });
      } else {
        setSelectedLayerId(layerId);
        setFilters({ layerIds: new Set([layerId]) });
      }
    },
    [selectedLayerId, setFilters],
  );

  const { nodes, edges } = useMemo(() => {
    if (!graph || !positions) return { nodes: [], edges: [] };
    return buildFlowElements(graph, positions, selectedLayerId, handleSelect);
  }, [graph, positions, selectedLayerId, handleSelect]);


  if (!graph || !hasLayers) {
    return <EmptyState />;
  }

  const crossLayerCount = allLayerEdges.length;

  const selectedLayer = graph.layers.find((l) => l.id === selectedLayerId);
  const selectedColorIndex = selectedLayer ? graph.layers.indexOf(selectedLayer) : 0;

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-surface-950">
      {/* Info bar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-surface-800 bg-surface-900/60 shrink-0">
        <Layers className="w-3.5 h-3.5 text-sprang-400 flex-shrink-0" />
        <p className="text-xs text-surface-400">
          <span className="text-surface-200 font-semibold">{graph.layers.length}</span>{' '}
          layer{graph.layers.length !== 1 ? 's' : ''}
          {' · '}
          <span className="text-surface-200 font-semibold">{crossLayerCount}</span>{' '}
          cross-layer connection{crossLayerCount !== 1 ? 's' : ''}
          {selectedLayerId && (
            <>
              {' · '}
              <button
                onClick={() => {
                  setSelectedLayerId(null);
                  setFilters({ layerIds: new Set<string>() });
                }}
                className="text-sprang-400 hover:text-sprang-300 underline underline-offset-2"
              >
                clear selection
              </button>
            </>
          )}
        </p>
        {!selectedLayerId && (
          <span className="text-[11px] text-surface-600 ml-auto">
            click a layer to explore
          </span>
        )}
      </div>

      {/* Canvas + optional detail panel */}
      <div className="flex-1 flex min-h-0">
        {/* Canvas or loading */}
        {positions === null ? (
          <LoadingLayout />
        ) : (
          <motion.div
            className="flex-1 min-h-0"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          >
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={NODE_TYPES}
              fitView
              fitViewOptions={{ padding: 0.15 }}
              colorMode="dark"
              proOptions={{ hideAttribution: true }}
              style={{ background: '#09090b' }}
            >
              <Background color="#27272a" gap={24} size={1} />
              <Controls
                style={{
                  background: '#18181b',
                  border: '1px solid #3f3f46',
                  color: '#a1a1aa',
                }}
              />
              <MiniMap
                style={{ background: '#18181b', border: '1px solid #3f3f46' }}
                nodeColor="#3f3f46"
                maskColor="rgba(0,0,0,0.7)"
              />
            </ReactFlow>
          </motion.div>
        )}

        {/* Layer detail panel */}
        {selectedLayerId && (
          <LayerPanel
            graph={graph}
            layerId={selectedLayerId}
            colorIndex={selectedColorIndex}
            onClose={() => {
              setSelectedLayerId(null);
              setFilters({ layerIds: new Set<string>() });
            }}
          />
        )}
      </div>
    </div>
  );
}
