import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { GraphLoader } from '../graph-loader.js';
import type { DecisionContext, SprangNode } from '@sprang/core';

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
  phase_note?: string;
}

function sanitizeNodeId(nodeId: string): string {
  const sanitized = nodeId
    .replace(/[:/\\<>"|?*\x00-\x1f]/g, '-')
    .replace(/\.{2,}/g, '-');
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

export async function sprangWhy(
  loader: GraphLoader,
  input: SprangWhyInput,
  sprangRoot: string
): Promise<SprangWhyResult | { error: string; code: string }> {
  const graph = await loader.getGraph();
  if (!graph) {
    return { error: 'Knowledge graph not found', code: 'GRAPH_NOT_FOUND' };
  }

  const node = resolveNode(graph.nodes, input.node_id);
  if (!node) {
    return { error: 'Node not found', code: 'NODE_NOT_FOUND' };
  }

  const sanitizedId = sanitizeNodeId(node.id);
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
    phase_note: (!node.decision_context && !node.summary)
      ? 'decision_context and summary require Phase 2 enrichment — run /sprang-analyze to populate'
      : undefined,
  };
}
