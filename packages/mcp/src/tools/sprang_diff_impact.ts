import type { GraphLoader } from '../graph-loader.js';
import type { SprangNode, RiskFactor } from '@sprang/core';

export interface SprangDiffImpactInput {
  files: string[];
}

export interface ImpactEntry {
  node_id: string;
  label: string;
  type: string;
  risk_score?: number;
  risk_factors?: RiskFactor[];
  path_from_changed: string[];
}

export interface SprangDiffImpactResult {
  changed_nodes: ImpactEntry[];
  impact_nodes: ImpactEntry[];
  total_impact: number;
  high_risk_count: number;
}

export async function sprangDiffImpact(
  loader: GraphLoader,
  input: SprangDiffImpactInput
): Promise<SprangDiffImpactResult | { error: string; code: string }> {
  const graph = await loader.getGraph();
  if (!graph) {
    return { error: 'Knowledge graph not found', code: 'GRAPH_NOT_FOUND' };
  }

  if (!Array.isArray(input.files) || input.files.length === 0) {
    return { error: 'files must be a non-empty array', code: 'INVALID_INPUT' };
  }
  if (input.files.length > 500) {
    return { error: 'files array exceeds maximum of 500 entries', code: 'INVALID_INPUT' };
  }
  const files = input.files
    .filter((f): f is string => typeof f === 'string' && f.length > 0 && f.length <= 500)
    .map((f) => f.replace(/\\/g, '/'));

  // Find all nodes corresponding to the changed files
  const changedNodeIds = new Set<string>();

  for (const node of graph.nodes) {
    const matchesFile =
      (node.location?.file && files.some((f) => node.location!.file === f || node.location!.file.endsWith(f))) ||
      files.some((f) => node.id === f || node.id.endsWith(f));

    if (matchesFile) {
      changedNodeIds.add(node.id);
    }
  }

  const nodeMap = new Map<string, SprangNode>(graph.nodes.map((n) => [n.id, n]));

  function toEntry(node: SprangNode, pathFromChanged: string[]): ImpactEntry {
    return {
      node_id: node.id,
      label: node.label,
      type: node.type,
      risk_score: node.risk_score,
      risk_factors: node.risk_factors,
      path_from_changed: pathFromChanged,
    };
  }

  const changedNodes: ImpactEntry[] = [];
  for (const nodeId of changedNodeIds) {
    const node = nodeMap.get(nodeId);
    if (node) changedNodes.push(toEntry(node, []));
  }

  // BFS following INCOMING edges (find dependents — who depends on the changed nodes)
  // path tracking: nodeId -> path from its changed source
  const visited = new Map<string, string[]>(); // nodeId -> shortest path from changed node
  const queue: Array<{ nodeId: string; path: string[] }> = [];

  for (const nodeId of changedNodeIds) {
    queue.push({ nodeId, path: [nodeId] });
  }

  while (queue.length > 0) {
    const item = queue.shift();
    if (!item) break;
    const { nodeId, path } = item;

    if (visited.has(nodeId)) continue;
    visited.set(nodeId, path);

    // Find nodes that have edges pointing TO nodeId (dependents)
    for (const edge of graph.edges) {
      if (edge.target === nodeId) {
        const dependent = edge.source;
        if (!visited.has(dependent)) {
          queue.push({ nodeId: dependent, path: [...path, dependent] });
        }
      }
    }
  }

  // Collect impact nodes (exclude the changed nodes themselves)
  const impactNodes: ImpactEntry[] = [];
  for (const [nodeId, path] of visited.entries()) {
    if (changedNodeIds.has(nodeId)) continue;
    const node = nodeMap.get(nodeId);
    if (node) {
      impactNodes.push(toEntry(node, path));
    }
  }

  // Sort by risk_score descending
  impactNodes.sort((a, b) => (b.risk_score ?? 0) - (a.risk_score ?? 0));

  const highRiskCount = impactNodes.filter((n) => (n.risk_score ?? 0) >= 0.7).length;

  return {
    changed_nodes: changedNodes,
    impact_nodes: impactNodes,
    total_impact: impactNodes.length,
    high_risk_count: highRiskCount,
  };
}
