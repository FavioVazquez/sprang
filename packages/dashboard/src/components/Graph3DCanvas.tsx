import React, { useRef, useEffect, useCallback, useMemo } from 'react';
import fromKapsule from 'react-kapsule';
import ForceGraph3DKapsule from '3d-force-graph';
import type { KnowledgeGraph } from '../types';
import { toForceGraphData, type FGNode } from '../utils/graphTransform';

// Build a React wrapper for the 3D force-graph kapsule (same as react-force-graph does
// internally, but without pulling in the 2D/VR/AR variants or aframe).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ForceGraph3D = fromKapsule(ForceGraph3DKapsule as any, {
  methodNames: [
    'emitParticle', 'd3Force', 'd3ReheatSimulation', 'stopAnimation', 'pauseAnimation',
    'resumeAnimation', 'cameraPosition', 'zoomToFit', 'getGraphBbox',
    'screen2GraphCoords', 'graph2ScreenCoords', 'postProcessingComposer',
    'lights', 'scene', 'camera', 'renderer', 'controls', 'refresh',
  ],
  initPropNames: ['controlType', 'rendererConfig', 'extraRenderers'],
}) as React.ComponentType<Record<string, unknown> & { ref?: React.MutableRefObject<FGRef> }>;

interface Graph3DCanvasProps {
  graph: KnowledgeGraph;
  selectedNodeId?: string;
  onNodeSelect: (nodeId: string) => void;
  showRiskOverlay?: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FGRef = any;

export function Graph3DCanvas({
  graph,
  selectedNodeId,
  onNodeSelect,
  showRiskOverlay = false,
}: Graph3DCanvasProps) {
  const fgRef = useRef<FGRef>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useMemo(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  );

  const data = toForceGraphData(graph, showRiskOverlay);

  const handleNodeClick = useCallback(
    (node: FGNode) => {
      onNodeSelect(node.id);
    },
    [onNodeSelect],
  );

  // After mount, zoom to fit and optionally start rotation
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    const t = setTimeout(() => {
      fg.zoomToFit?.(400, 80);
      if (!reducedMotion) {
        let angle = 0;
        const id = setInterval(() => {
          angle += 0.003;
          fg.cameraPosition?.({
            x: Math.sin(angle) * 400,
            z: Math.cos(angle) * 400,
          });
        }, 16);
        const stop = () => clearInterval(id);
        const el = containerRef.current;
        el?.addEventListener('mousedown', stop, { once: true });
        el?.addEventListener('touchstart', stop, { once: true });
        return () => {
          clearInterval(id);
          el?.removeEventListener('mousedown', stop);
          el?.removeEventListener('touchstart', stop);
        };
      }
    }, 500);
    return () => clearTimeout(t);
  }, [reducedMotion]);

  // Focus selected node
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg || !selectedNodeId) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const node = (data.nodes as any[]).find((n) => n.id === selectedNodeId);
    if (!node) return;
    const { x = 0, y = 0, z = 0 } = node as { x?: number; y?: number; z?: number };
    fg.cameraPosition?.({ x: x + 100, y: y + 50, z: z + 100 }, { x, y, z }, 800);
  }, [selectedNodeId, data.nodes]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full"
      style={{ background: '#09090b' }}
      role="img"
      aria-label={`3D knowledge graph: ${graph.nodes.length} nodes`}
    >
      <ForceGraph3D
        ref={fgRef}
        graphData={data}
        nodeId="id"
        nodeLabel="label"
        nodeColor={(node: FGNode) => node.color}
        nodeVal={(node: FGNode) => node.val}
        linkColor={() => 'rgba(100,100,120,0.3)'}
        linkWidth={0.3}
        backgroundColor="#09090b"
        showNavInfo={false}
        enableNodeDrag
        onNodeClick={(node: unknown) => handleNodeClick(node as FGNode)}
        nodeThreeObjectExtend={false}
      />
    </div>
  );
}
