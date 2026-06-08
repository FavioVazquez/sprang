import type { KnowledgeGraph } from '../schema/types.js';

/**
 * Generate a Mermaid flowchart TD from the knowledge graph's layer structure.
 * Groups nodes by layer, counts cross-layer edges, outputs embeddable Mermaid.
 */
export function generateMermaid(graph: KnowledgeGraph): string {
  if (graph.layers.length === 0) {
    return generateFlatMermaid(graph);
  }

  const nodeToLayer = new Map<string, string>();
  for (const layer of graph.layers) {
    for (const nodeId of layer.node_ids) {
      nodeToLayer.set(nodeId, layer.id);
    }
  }

  const edgeCounts = new Map<string, number>();
  for (const edge of graph.edges) {
    if (edge.type !== 'imports' && edge.type !== 'depends_on' && edge.type !== 'calls') continue;
    const fromLayer = nodeToLayer.get(edge.source);
    const toLayer = nodeToLayer.get(edge.target);
    if (!fromLayer || !toLayer || fromLayer === toLayer) continue;
    const key = `${fromLayer}→${toLayer}`;
    edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
  }

  const lines: string[] = ['flowchart TD'];
  for (const layer of graph.layers) {
    const safeId = layer.id.replace(/[^a-zA-Z0-9_]/g, '_');
    lines.push(`  ${safeId}["${layer.name}<br/>${layer.node_ids.length} nodes"]`);
  }
  lines.push('');
  for (const [key, count] of edgeCounts) {
    const [fromId, toId] = key.split('→');
    if (!fromId || !toId) continue;
    const from = fromId.replace(/[^a-zA-Z0-9_]/g, '_');
    const to = toId.replace(/[^a-zA-Z0-9_]/g, '_');
    lines.push(`  ${from} -->|${count}| ${to}`);
  }
  return lines.join('\n');
}

function generateFlatMermaid(graph: KnowledgeGraph): string {
  const MAX_NODES = 30;
  const allFileNodes = graph.nodes.filter((n) => n.type === 'file');

  // Count connections to prioritize highly-connected files
  const degree = new Map<string, number>();
  for (const edge of graph.edges) {
    if (edge.type !== 'imports' && edge.type !== 'depends_on') continue;
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
  }
  const sorted = allFileNodes.sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0));
  const fileNodes = sorted.slice(0, MAX_NODES);
  const nodeIds = new Set(fileNodes.map((n) => n.id));

  const lines: string[] = ['flowchart TD'];
  for (const node of fileNodes) {
    const safeId = node.id.replace(/[^a-zA-Z0-9_]/g, '_');
    const label = node.label.split('/').pop() ?? node.label;
    lines.push(`  ${safeId}["${label}"]`);
  }
  lines.push('');
  const seen = new Set<string>();
  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    if (edge.type !== 'imports' && edge.type !== 'depends_on') continue;
    const key = `${edge.source}→${edge.target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const from = edge.source.replace(/[^a-zA-Z0-9_]/g, '_');
    const to = edge.target.replace(/[^a-zA-Z0-9_]/g, '_');
    lines.push(`  ${from} --> ${to}`);
  }
  return lines.join('\n');
}
