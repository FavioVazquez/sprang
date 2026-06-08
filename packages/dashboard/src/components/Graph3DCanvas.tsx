import React, { useRef, useEffect, useCallback } from 'react';
import { ForceGraph3D } from 'react-force-graph';
import type { KnowledgeGraph } from '../types';
import { toForceGraphData, type FGNode } from '../utils/graphTransform';

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
  const reducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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
        // Gentle auto-rotation
        let angle = 0;
        const id = setInterval(() => {
          angle += 0.003;
          fg.cameraPosition?.({
            x: Math.sin(angle) * 400,
            z: Math.cos(angle) * 400,
          });
        }, 16);
        // Stop rotation when user interacts
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
        nodeColor={(node) => (node as FGNode).color}
        nodeVal={(node) => (node as FGNode).val}
        linkColor={() => 'rgba(100,100,120,0.3)'}
        linkWidth={0.3}
        backgroundColor="#09090b"
        showNavInfo={false}
        enableNodeDrag
        onNodeClick={(node) => handleNodeClick(node as FGNode)}
        nodeThreeObjectExtend={false}
      />
    </div>
  );
}
