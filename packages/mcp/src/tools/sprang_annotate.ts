import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
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
  // Replace all path-unsafe and shell-special chars; preserve full path to prevent monorepo collisions
  const sanitized = nodeId
    .replace(/[:/\\<>"|?*\x00-\x1f]/g, '-')
    .replace(/\.{2,}/g, '-')
    .replace(/^-+|-+$/g, '');  // trim leading/trailing hyphens
  return sanitized || 'unknown-node';
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

  const node = graph.nodes.find((n: SprangNode) => n.id === input.node_id);
  if (!node) {
    return { error: 'Node not found', code: 'NODE_NOT_FOUND' };
  }

  const sanitizedId = sanitizeNodeId(input.node_id);
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
    node_id: input.node_id,
    node_label: node.label,
  };
}
