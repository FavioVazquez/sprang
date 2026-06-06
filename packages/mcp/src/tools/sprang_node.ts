import { access } from 'node:fs/promises';
import { join } from 'node:path';
import type { GraphLoader } from '../graph-loader.js';
import type { SprangNode } from '@sprang/core';

export interface SprangNodeInput {
  node_id: string;
}

export interface NeighborInfo {
  node_id: string;
  label: string;
  type: string;
  direction: 'incoming' | 'outgoing';
  edge_type: string;
}

export interface SprangNodeResult {
  node: SprangNode;
  neighbors: NeighborInfo[];
  layer?: { id: string; name: string };
  layer_mate_count?: number;
  in_degree: number;
  out_degree: number;
  has_annotation: boolean;
  annotation_path?: string;
}

export interface SprangNodeError {
  error: string;
  code: string;
}

function sanitizeNodeId(nodeId: string): string {
  // Preserve full path to prevent monorepo collisions; no basename() to avoid id conflicts
  const sanitized = nodeId
    .replace(/[:/\\<>"|?*\x00-\x1f]/g, '-')
    .replace(/\.{2,}/g, '-')
    .replace(/^-+|-+$/g, '');  // trim leading/trailing hyphens
  return sanitized || 'unknown-node';
}

export async function sprangNode(
  loader: GraphLoader,
  input: SprangNodeInput
): Promise<SprangNodeResult | SprangNodeError> {
  const graph = await loader.getGraph();
  if (!graph) {
    return { error: 'Knowledge graph not found', code: 'GRAPH_NOT_FOUND' };
  }

  const node = graph.nodes.find((n) => n.id === input.node_id);
  if (!node) {
    return { error: 'Node not found', code: 'NODE_NOT_FOUND' };
  }

  const nodeMap = new Map<string, SprangNode>(graph.nodes.map((n) => [n.id, n]));

  const neighbors: NeighborInfo[] = [];
  let inDegree = 0;
  let outDegree = 0;

  for (const edge of graph.edges) {
    if (edge.source === input.node_id) {
      outDegree++;
      const target = nodeMap.get(edge.target);
      if (target) {
        neighbors.push({
          node_id: target.id,
          label: target.label,
          type: target.type,
          direction: 'outgoing',
          edge_type: edge.type,
        });
      }
    } else if (edge.target === input.node_id) {
      inDegree++;
      const source = nodeMap.get(edge.source);
      if (source) {
        neighbors.push({
          node_id: source.id,
          label: source.label,
          type: source.type,
          direction: 'incoming',
          edge_type: edge.type,
        });
      }
    }
  }

  // Layer membership
  let layer: { id: string; name: string } | undefined;
  let layerMateCount: number | undefined;
  for (const l of graph.layers ?? []) {
    const nodeIds: string[] = (l as unknown as { node_ids?: string[] }).node_ids ?? [];
    if (nodeIds.includes(input.node_id)) {
      layer = { id: l.id, name: l.name };
      layerMateCount = nodeIds.length - 1;
      break;
    }
  }

  // Annotation presence check
  let hasAnnotation = false;
  let annotationPath: string | undefined;
  const sanitizedId = sanitizeNodeId(input.node_id);
  const annotationFile = join(loader.getRoot(), '.sprang', 'annotations', `${sanitizedId}.md`);
  try {
    await access(annotationFile);
    hasAnnotation = true;
    annotationPath = `.sprang/annotations/${sanitizedId}.md`;
  } catch {
    // No annotation — normal
  }

  return {
    node,
    neighbors,
    layer,
    layer_mate_count: layerMateCount,
    in_degree: inDegree,
    out_degree: outDegree,
    has_annotation: hasAnnotation,
    annotation_path: annotationPath,
  };
}
