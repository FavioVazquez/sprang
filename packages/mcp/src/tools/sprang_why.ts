import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { GraphLoader } from '../graph-loader.js';
import type { DecisionContext } from '@sprang/core';

export interface SprangWhyInput {
  node_id: string;
}

export interface SprangWhyResult {
  node_id: string;
  label: string;
  summary?: string;
  decision_context?: DecisionContext;
  annotation?: string;
  annotation_path?: string;
}

function sanitizeNodeId(nodeId: string): string {
  // Preserve full path to prevent monorepo collisions; no basename() to avoid id conflicts
  const sanitized = nodeId
    .replace(/[:/\\<>"|?*\x00-\x1f]/g, '-')
    .replace(/\.{2,}/g, '-')
    .replace(/^-+|-+$/g, '');  // trim leading/trailing hyphens
  return sanitized || 'unknown-node';
}

export async function sprangWhy(
  loader: GraphLoader,
  input: SprangWhyInput,
  sprangRoot: string
): Promise<SprangWhyResult | { error: string; code: string }> {
  const graph = await loader.getGraph();
  if (!graph) {
    return { error: 'Knowledge graph not found', code: 'GRAPH_NOT_FOUND' };
  }

  const node = graph.nodes.find((n) => n.id === input.node_id);
  if (!node) {
    return { error: 'Node not found', code: 'NODE_NOT_FOUND' };
  }

  const sanitizedId = sanitizeNodeId(input.node_id);
  const annotationPath = join(sprangRoot, '.sprang', 'annotations', `${sanitizedId}.md`);

  let annotation: string | undefined;
  let resolvedAnnotationPath: string | undefined;

  try {
    annotation = await readFile(annotationPath, 'utf-8');
    resolvedAnnotationPath = `.sprang/annotations/${sanitizedId}.md`;
  } catch {
    // No annotation file — that's fine
  }

  return {
    node_id: node.id,
    label: node.label,
    summary: node.summary,
    decision_context: node.decision_context,
    annotation,
    annotation_path: resolvedAnnotationPath,
  };
}
