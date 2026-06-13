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

  // Memoize so the graphData object identity is stable across re-renders.
  // Recomputing it every render hands react-kapsule a new graphData each time,
  // which re-ingests the nodes and re-heats the d3 physics simulation — making
  // the whole graph and camera churn erratically.
  const data = useMemo(
    () => toForceGraphData(graph, showRiskOverlay),
    [graph, showRiskOverlay],
  );

  const handleNodeClick = useCallback(
    (node: FGNode) => {
      onNodeSelect(node.id);
    },
    [onNodeSelect],
  );

  // After mount: zoom to fit, then optionally auto-rotate until the user
  // interacts. All timers/listeners are cleaned up from the effect itself so
  // nothing leaks across re-renders (previously the interval cleanup was
  // returned from the setTimeout callback and never ran, leaking intervals
  // that fought with the user's camera control).
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    const el = containerRef.current;

    let rotId: ReturnType<typeof setInterval> | null = null;
    const stopRotation = () => {
      if (rotId) { clearInterval(rotId); rotId = null; }
    };

    const fitTimer = setTimeout(() => {
      fg.zoomToFit?.(400, 80);
      if (!reducedMotion) {
        let angle = 0;
        rotId = setInterval(() => {
          angle += 0.003;
          fg.cameraPosition?.({
            x: Math.sin(angle) * 400,
            z: Math.cos(angle) * 400,
          });
        }, 30);
      }
    }, 500);

    // Any camera interaction (orbit drag, touch, or zoom) cancels auto-rotation.
    el?.addEventListener('pointerdown', stopRotation);
    el?.addEventListener('touchstart', stopRotation, { passive: true });
    el?.addEventListener('wheel', stopRotation, { passive: true });

    return () => {
      clearTimeout(fitTimer);
      stopRotation();
      el?.removeEventListener('pointerdown', stopRotation);
      el?.removeEventListener('touchstart', stopRotation);
      el?.removeEventListener('wheel', stopRotation);
    };
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
