import React, { useEffect, useRef, useCallback } from 'react';
import Graph from 'graphology';
import { Sigma } from 'sigma';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import type { KnowledgeGraph, NodeType } from '../types';
import { getRiskColor } from '../api/graphApi';

interface GraphCanvasProps {
  graph: KnowledgeGraph;
  selectedNodeId?: string;
  onNodeSelect: (nodeId: string) => void;
  showRiskOverlay: boolean;
  hoveredLayerId?: string;
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
}: GraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const graphologyRef = useRef<Graph | null>(null);
  const showRiskRef = useRef(showRiskOverlay);
  const hoveredLayerRef = useRef(hoveredLayerId);

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
    if (g.order > 0 && g.order < 2000) {
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
      labelFont: 'Inter Variable, Inter, system-ui, sans-serif',
      labelWeight: '500',
      edgeLabelSize: 9,
      minCameraRatio: 0.05,
      maxCameraRatio: 10,
      nodeProgramClasses: {},
      edgeProgramClasses: {},
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    sigmaRef.current = renderer;

    // Node click handler
    renderer.on('clickNode', ({ node }) => {
      onNodeSelect(node);
    });

    // Background click deselects
    renderer.on('clickStage', () => {
      // Allow parent to handle deselection through its own state
    });

    return () => {
      renderer.kill();
      sigmaRef.current = null;
      graphologyRef.current = null;
    };
    // We intentionally only rebuild when graph data changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph]);

  // Update colors when risk overlay or hovered layer changes
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
      if (showRiskOverlay) {
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
  }, [showRiskOverlay, hoveredLayerId, graph]);

  // Highlight selected node
  useEffect(() => {
    const g = graphologyRef.current;
    const renderer = sigmaRef.current;
    if (!g || !renderer) return;

    if (selectedNodeId && g.hasNode(selectedNodeId)) {
      const camera = renderer.getCamera();
      const nodeAttrs = g.getNodeAttributes(selectedNodeId);
      camera.animate(
        { x: nodeAttrs.x, y: nodeAttrs.y, ratio: 0.3 },
        { duration: 500, easing: 'cubicInOut' },
      );
    }
  }, [selectedNodeId]);

  return (
    <div
      ref={containerRef}
      className="sigma-container w-full h-full"
      style={{ background: '#09090b' }}
    />
  );
}
