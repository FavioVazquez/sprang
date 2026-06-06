import { access } from 'node:fs/promises';
import { basename, join } from 'node:path';
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
  const sanitized = nodeId.replace(/[:/\\<>"\|?*\x00-\x1f]/g, '-').replace(/\.{2,}/g, '-');
  return basename(sanitized) || 'unknown-node';
}

function resolveNode(nodes: SprangNode[], nodeId: string): SprangNode | undefined {
  // Try exact match first
  let found = nodes.find((n) => n.id === nodeId);
  if (found) return found;
  // Try with file: prefix
  found = nodes.find((n) => n.id === `file:${nodeId}`);
  if (found) return found;
  // Try without file: prefix
  if (nodeId.startsWith('file:')) {
    found = nodes.find((n) => n.id === nodeId.slice(5));
    if (found) return found;
  }
  // Try suffix match (for cases where stored ID includes project root prefix)
  found = nodes.find((n) => n.id.endsWith(`/${nodeId}`) || n.id.endsWith(nodeId));
  return found;
}

export async function sprangNode(
  loader: GraphLoader,
  input: SprangNodeInput
): Promise<SprangNodeResult | SprangNodeError> {
  const graph = await loader.getGraph();
  if (!graph) {
    return { error: 'Knowledge graph not found', code: 'GRAPH_NOT_FOUND' };
  }

  const node = resolveNode(graph.nodes, input.node_id);
  if (!node) {
    return { error: 'Node not found', code: 'NODE_NOT_FOUND' };
  }

  const resolvedId = node.id;
  const nodeMap = new Map<string, SprangNode>(graph.nodes.map((n) => [n.id, n]));

  const neighbors: NeighborInfo[] = [];
  let inDegree = 0;
  let outDegree = 0;

  for (const edge of graph.edges) {
    if (edge.source === resolvedId) {
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
    } else if (edge.target === resolvedId) {
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
    if (nodeIds.includes(resolvedId)) {
      layer = { id: l.id, name: l.name };
      layerMateCount = nodeIds.length - 1;
      break;
    }
  }

  // Annotation presence check
  let hasAnnotation = false;
  let annotationPath: string | undefined;
  const sanitizedId = sanitizeNodeId(resolvedId);
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
