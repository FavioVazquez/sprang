import ELK from 'elkjs/lib/elk.bundled.js';

export interface ElkNode {
  id: string;
  width: number;
  height: number;
}

export interface ElkEdge {
  id: string;
  sources: string[];
  targets: string[];
}

export interface LayoutResult {
  nodes: Map<string, { x: number; y: number }>;
}

const elk = new ELK();

export async function computeLayerLayout(
  nodes: ElkNode[],
  edges: ElkEdge[],
): Promise<LayoutResult> {
  const graph = {
    id: 'root',
    layoutOptions: {
      algorithm: 'layered',
      'elk.direction': 'DOWN',
      'elk.layered.spacing.nodeNodeBetweenLayers': '100',
      'elk.spacing.nodeNode': '80',
      'elk.edgeRouting': 'ORTHOGONAL',
    },
    children: nodes.map((n) => ({
      id: n.id,
      width: n.width,
      height: n.height,
    })),
    edges: edges.map((e) => ({
      id: e.id,
      sources: e.sources,
      targets: e.targets,
    })),
  };

  const result = await elk.layout(graph);

  const positions = new Map<string, { x: number; y: number }>();
  for (const child of result.children ?? []) {
    positions.set(child.id, {
      x: child.x ?? 0,
      y: child.y ?? 0,
    });
  }

  return { nodes: positions };
}
