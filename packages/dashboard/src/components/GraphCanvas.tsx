import React, { useEffect, useRef, useCallback, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Graph from 'graphology';
import { Sigma } from 'sigma';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import { Plus, Minus, Maximize2 } from 'lucide-react';
import type { KnowledgeGraph, NodeType } from '../types';
import { getRiskColor } from '../api/graphApi';

interface GraphCanvasProps {
  graph: KnowledgeGraph;
  selectedNodeId?: string;
  onNodeSelect: (nodeId: string) => void;
  showRiskOverlay: boolean;
  hoveredLayerId?: string;
  diffMode?: boolean;
  changedNodeIds?: Set<string>;
  affectedNodeIds?: Set<string>;
}

const NODE_TYPE_COLORS: Record<NodeType | 'default', string> = {
  file: '#a1a1aa',
  function: '#d946ef',
  class: '#a21caf',
  config: '#d97706',
  service: '#3b82f6',
  domain: '#22c55e',
  module: '#8b5cf6',
  concept: '#06b6d4',
  document: '#64748b',
  table: '#f97316',
  endpoint: '#0ea5e9',
  pipeline: '#ec4899',
  schema: '#84cc16',
  resource: '#14b8a6',
  flow: '#6366f1',
  step: '#78716c',
  article: '#f59e0b',
  entity: '#10b981',
  topic: '#8b5cf6',
  claim: '#ef4444',
  source: '#06b6d4',
  default: '#71717a',
};

function getNodeTypeColor(type: NodeType): string {
  return NODE_TYPE_COLORS[type] ?? NODE_TYPE_COLORS.default;
}

function randomLayout(count: number): Array<{ x: number; y: number }> {
  const positions: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * 2 * Math.PI;
    const radius = 0.4 + Math.random() * 0.5;
    positions.push({
      x: Math.cos(angle) * radius + (Math.random() - 0.5) * 0.2,
      y: Math.sin(angle) * radius + (Math.random() - 0.5) * 0.2,
    });
  }
  return positions;
}

export function GraphCanvas({
  graph,
  selectedNodeId,
  onNodeSelect,
  showRiskOverlay,
  hoveredLayerId,
  diffMode = false,
  changedNodeIds = new Set(),
  affectedNodeIds = new Set(),
}: GraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const graphologyRef = useRef<Graph | null>(null);
  const showRiskRef = useRef(showRiskOverlay);
  const hoveredLayerRef = useRef(hoveredLayerId);
  const [pulsePos, setPulsePos] = useState<{ x: number; y: number; size: number } | null>(null);
  // Keep the latest selected node id readable from the Sigma event handlers
  // (the renderer is created once, on [graph], so it can't close over the prop).
  const selectedNodeIdRef = useRef(selectedNodeId);
  selectedNodeIdRef.current = selectedNodeId;

  // Build in-degree map
  const buildInDegreeMap = useCallback(() => {
    const inDegree: Record<string, number> = {};
    for (const node of graph.nodes) {
      inDegree[node.id] = 0;
    }
    for (const edge of graph.edges) {
      inDegree[edge.target] = (inDegree[edge.target] ?? 0) + 1;
    }
    return inDegree;
  }, [graph]);

  // Compute node size from in-degree (range 5–20)
  const computeNodeSize = useCallback(
    (inDegree: number, maxDegree: number): number => {
      if (maxDegree === 0) return 8;
      const normalized = inDegree / maxDegree;
      return 5 + normalized * 15;
    },
    [],
  );

  useEffect(() => {
    if (!containerRef.current) return;

    // Build graphology graph
    const g = new Graph({ multi: false, type: 'directed' });

    const inDegreeMap = buildInDegreeMap();
    const maxDegree = Math.max(...Object.values(inDegreeMap), 1);
    const positions = randomLayout(graph.nodes.length);

    // Layer color map
    const layerColors: Record<string, string> = {};
    const layerPalette = [
      '#d946ef', '#3b82f6', '#22c55e', '#f59e0b',
      '#ec4899', '#06b6d4', '#84cc16', '#f97316',
    ];
    graph.layers.forEach((layer, idx) => {
      layerColors[layer.id] = layerPalette[idx % layerPalette.length];
    });

    // Add nodes
    graph.nodes.forEach((node, idx) => {
      const deg = inDegreeMap[node.id] ?? 0;
      const size = computeNodeSize(deg, maxDegree);
      const riskScore = node.risk_score ?? 0;

      let color: string;
      if (showRiskOverlay) {
        color = getRiskColor(riskScore);
      } else if (node.layer && layerColors[node.layer]) {
        color = layerColors[node.layer];
      } else {
        color = getNodeTypeColor(node.type);
      }

      const hasWarnings = (node.structural_warnings?.length ?? 0) > 0;

      try {
        g.addNode(node.id, {
          label: node.label,
          size,
          color,
          x: positions[idx].x,
          y: positions[idx].y,
          nodeType: node.type,
          riskScore,
          hasWarnings,
          borderColor: hasWarnings ? '#f59e0b' : undefined,
          layer: node.layer,
        });
      } catch {
        // Skip duplicate nodes
      }
    });

    // Add edges (skip duplicates and self-loops)
    const edgeSet = new Set<string>();
    for (const edge of graph.edges) {
      if (edge.source === edge.target) continue;
      if (!g.hasNode(edge.source) || !g.hasNode(edge.target)) continue;
      const key = `${edge.source}→${edge.target}`;
      if (edgeSet.has(key)) continue;
      edgeSet.add(key);
      try {
        g.addDirectedEdge(edge.source, edge.target, {
          color: '#3f3f46',
          size: 0.5,
          type: 'arrow',
        });
      } catch {
        // Skip
      }
    }

    graphologyRef.current = g;

    // Run ForceAtlas2 for layout (synchronous, limited iterations)
    if (g.order > 0 && g.order < 3000) {
      try {
        forceAtlas2.assign(g, {
          iterations: 100,
          settings: {
            gravity: 1,
            scalingRatio: 2,
            strongGravityMode: false,
            barnesHutOptimize: g.order > 500,
            barnesHutTheta: 0.5,
            slowDown: 5,
          },
        });
      } catch {
        // Layout failed, use random positions
      }
    }

    // Create Sigma renderer
    const renderer = new Sigma(g, containerRef.current, {
      renderEdgeLabels: false,
      defaultEdgeColor: '#3f3f46',
      defaultNodeColor: '#71717a',
      labelColor: { color: '#a1a1aa' },
      labelSize: 11,
      labelFont: 'Outfit, system-ui, sans-serif',
      labelWeight: '500',
      edgeLabelSize: 9,
      minCameraRatio: 0.05,
      maxCameraRatio: 10,
      nodeProgramClasses: {},
      edgeProgramClasses: {},
      // Allow rendering even when container has no height (e.g. headless test environments)
      allowInvalidContainer: true,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    sigmaRef.current = renderer;

    // Re-measure container after first paint (handles iframe/proxy contexts where
    // h-full resolves to 0 at mount time)
    const rafId = requestAnimationFrame(() => {
      renderer.refresh();
    });

    // Re-render whenever the container is resized (panel open/close, proxy wrapping, etc.)
    const ro = new ResizeObserver(() => {
      renderer.refresh();
    });
    if (containerRef.current) ro.observe(containerRef.current);

    // Node click handler
    renderer.on('clickNode', ({ node }) => {
      onNodeSelect(node);
    });

    // Background click deselects
    renderer.on('clickStage', () => {
      // Allow parent to handle deselection through its own state
    });

    // Keep the pulse ring glued to the selected node on every render so it
    // tracks camera pan/zoom/animation instead of being frozen at stale
    // viewport coordinates (which left "orphaned" rings detached from nodes).
    renderer.on('afterRender', () => {
      const gg = graphologyRef.current;
      const sel = selectedNodeIdRef.current;
      if (!gg || !sel || !gg.hasNode(sel)) {
        setPulsePos((prev) => (prev === null ? prev : null));
        return;
      }
      const a = gg.getNodeAttributes(sel);
      try {
        const vp = renderer.graphToViewport({ x: a.x as number, y: a.y as number });
        const size = (a.size as number) ?? 8;
        setPulsePos((prev) =>
          prev && Math.abs(prev.x - vp.x) < 0.5 && Math.abs(prev.y - vp.y) < 0.5 && prev.size === size
            ? prev
            : { x: vp.x, y: vp.y, size },
        );
      } catch {
        /* viewport not ready */
      }
    });

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
      renderer.kill();
      sigmaRef.current = null;
      graphologyRef.current = null;
    };
    // We intentionally only rebuild when graph data changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph]);

  // Update colors when risk overlay, hovered layer, or diff mode changes
  useEffect(() => {
    showRiskRef.current = showRiskOverlay;
    hoveredLayerRef.current = hoveredLayerId;

    const g = graphologyRef.current;
    const renderer = sigmaRef.current;
    if (!g || !renderer) return;

    const layerColors: Record<string, string> = {};
    const layerPalette = [
      '#d946ef', '#3b82f6', '#22c55e', '#f59e0b',
      '#ec4899', '#06b6d4', '#84cc16', '#f97316',
    ];
    graph.layers.forEach((layer, idx) => {
      layerColors[layer.id] = layerPalette[idx % layerPalette.length];
    });

    g.forEachNode((nodeId, attrs) => {
      let color: string;
      // Diff mode takes priority
      if (diffMode) {
        if (changedNodeIds.has(nodeId)) {
          color = '#f59e0b'; // amber — directly changed
        } else if (affectedNodeIds.has(nodeId)) {
          color = '#78716c'; // warm gray — transitively affected
        } else {
          color = '#27272a'; // dimmed — unrelated
        }
      } else if (showRiskOverlay) {
        color = getRiskColor(attrs.riskScore ?? 0);
      } else if (hoveredLayerId && attrs.layer === hoveredLayerId) {
        color = '#d946ef';
      } else if (hoveredLayerId && attrs.layer !== hoveredLayerId) {
        color = '#27272a';
      } else if (attrs.layer && layerColors[attrs.layer]) {
        color = layerColors[attrs.layer];
      } else {
        color = getNodeTypeColor(attrs.nodeType as NodeType);
      }
      g.mergeNodeAttributes(nodeId, { color });
    });

    renderer.refresh();
  }, [showRiskOverlay, hoveredLayerId, diffMode, changedNodeIds, affectedNodeIds, graph]);

  // Highlight selected node by boosting its size slightly; no camera move
  // (camera animation in graph-space coords caused the graph to fly off-screen)
  useEffect(() => {
    const g = graphologyRef.current;
    const renderer = sigmaRef.current;
    if (!g || !renderer) return;

    g.forEachNode((nodeId, attrs) => {
      const isSelected = nodeId === selectedNodeId;
      g.mergeNodeAttributes(nodeId, {
        highlighted: isSelected,
        borderColor: isSelected ? '#d946ef' : (attrs.hasWarnings ? '#f59e0b' : undefined),
      });
    });
    renderer.refresh();

    // Compute pulse ring position from graph coords
    if (selectedNodeId && g.hasNode(selectedNodeId)) {
      const attrs = g.getNodeAttributes(selectedNodeId);
      try {
        const vp = renderer.graphToViewport({ x: attrs.x as number, y: attrs.y as number });
        const nodeSize = (attrs.size as number) ?? 8;
        setPulsePos({ x: vp.x, y: vp.y, size: nodeSize });
      } catch {
        setPulsePos(null);
      }
    } else {
      setPulsePos(null);
    }
  }, [selectedNodeId]);

  return (
    <div className="relative w-full h-full" style={{ background: '#09090b', minHeight: '400px' }}>
      <div
        ref={containerRef}
        className="sigma-container w-full h-full"
        style={{ minHeight: '400px' }}
        role="img"
        aria-label={`Knowledge graph: ${graph.nodes.length} nodes, ${graph.edges.length} edges. Click a node to inspect it.`}
      />

      {/* Selected node pulse ring */}
      <AnimatePresence>
        {pulsePos && (
          <motion.div
            key={selectedNodeId}
            style={{
              position: 'absolute',
              left: pulsePos.x - pulsePos.size * 2,
              top: pulsePos.y - pulsePos.size * 2,
              width: pulsePos.size * 4,
              height: pulsePos.size * 4,
              borderRadius: '50%',
              border: '2px solid #d946ef',
              pointerEvents: 'none',
            }}
            initial={{ scale: 0.5, opacity: 0.8 }}
            animate={{
              scale: [1, 1.6, 1],
              opacity: [0.8, 0.2, 0.6],
              transition: { duration: 1.2, repeat: Infinity, ease: 'easeInOut' },
            }}
            // Exit needs its own finite, non-repeating transition. Inheriting the
            // repeat:Infinity pulse transition meant the exit animation never
            // completed, so AnimatePresence never unmounted the old ring — leaving
            // "orphaned" rings frozen in empty space after switching selection.
            exit={{ scale: 0.5, opacity: 0, transition: { duration: 0.2, repeat: 0 } }}
          />
        )}
      </AnimatePresence>

      {/* Zoom controls */}
      <div className="absolute bottom-4 right-4 flex flex-col gap-1 z-10">
        <button
          className="w-8 h-8 flex items-center justify-center rounded-md bg-surface-800/90 border border-surface-700 text-surface-400 hover:text-surface-200 hover:bg-surface-700 transition-colors backdrop-blur-sm"
          onClick={() => sigmaRef.current?.getCamera().animatedZoom({ duration: 200 })}
          title="Zoom in"
          aria-label="Zoom in"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
        <button
          className="w-8 h-8 flex items-center justify-center rounded-md bg-surface-800/90 border border-surface-700 text-surface-400 hover:text-surface-200 hover:bg-surface-700 transition-colors backdrop-blur-sm"
          onClick={() => sigmaRef.current?.getCamera().animatedUnzoom({ duration: 200 })}
          title="Zoom out"
          aria-label="Zoom out"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>
        <button
          className="w-8 h-8 flex items-center justify-center rounded-md bg-surface-800/90 border border-surface-700 text-surface-400 hover:text-surface-200 hover:bg-surface-700 transition-colors backdrop-blur-sm"
          onClick={() => sigmaRef.current?.getCamera().animatedReset({ duration: 400 })}
          title="Reset view"
          aria-label="Reset zoom to fit graph"
        >
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
