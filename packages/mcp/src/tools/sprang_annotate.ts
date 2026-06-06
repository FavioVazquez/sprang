import { mkdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { GraphLoader } from '../graph-loader.js';
import type { SprangNode } from '@sprang/core';

export interface SprangAnnotateInput {
  node_id: string;
  content: string;
  tags?: string[];
}

export interface SprangAnnotateResult {
  success: true;
  path: string;
  node_id: string;
  node_label: string;
}

function sanitizeNodeId(nodeId: string): string {
  // Replace all path-unsafe and shell-special chars; then strip to basename to prevent traversal
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

export async function sprangAnnotate(
  loader: GraphLoader,
  input: SprangAnnotateInput,
  sprangRoot: string
): Promise<SprangAnnotateResult | { error: string; code: string }> {
  const graph = await loader.getGraph();
  if (!graph) {
    return { error: 'Knowledge graph not found', code: 'GRAPH_NOT_FOUND' };
  }

  const node = resolveNode(graph.nodes, input.node_id);
  if (!node) {
    return { error: 'Node not found', code: 'NODE_NOT_FOUND' };
  }

  const sanitizedId = sanitizeNodeId(node.id);
  const annotationsDir = join(sprangRoot, '.sprang', 'annotations');
  const filename = `${sanitizedId}.md`;
  const filePath = join(annotationsDir, filename);
  const relativePath = `.sprang/annotations/${filename}`;

  const tags = input.tags ?? [];
  const tagsYaml =
    tags.length > 0
      ? `[${tags.map((t) => JSON.stringify(t)).join(', ')}]`
      : '[]';

  const frontmatter = [
    '---',
    `node_id: ${JSON.stringify(input.node_id)}`,
    `node_label: ${JSON.stringify(node.label)}`,
    `annotated_at: "${new Date().toISOString()}"`,
    `tags: ${tagsYaml}`,
    '---',
    '',
    input.content,
  ].join('\n');

  await mkdir(annotationsDir, { recursive: true });
  await writeFile(filePath, frontmatter, 'utf-8');

  return {
    success: true,
    path: relativePath,
    node_id: node.id,
    node_label: node.label,
  };
}
