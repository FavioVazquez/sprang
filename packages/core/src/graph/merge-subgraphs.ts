import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { readJsonFileOrNull } from '../utils/fs.js';
import type { KnowledgeGraph, SprangNode, SprangEdge, Layer, Tour, Domain } from '../schema/types.js';
import { SPRANG_DIR, GRAPH_FILE } from '../schema/constants.js';

export interface MergeResult {
  mergedPackages: string[];   // package names/paths that were merged
  addedNodes: number;
  addedEdges: number;
}

// ── Workspace config helpers ─────────────────────────────────────────────────

interface PnpmWorkspaceYaml {
  packages?: string[];
}

interface PackageJson {
  workspaces?: string[] | { packages: string[] };
}

/**
 * Resolve workspace package paths from either pnpm-workspace.yaml or
 * package.json#workspaces. Returns a list of relative package paths
 * (e.g. ["packages/core", "packages/cli"]).
 */
async function resolveWorkspacePackages(projectRoot: string): Promise<string[]> {
  // 1. Try pnpm-workspace.yaml
  const pnpmWorkspacePath = join(projectRoot, 'pnpm-workspace.yaml');
  try {
    const raw = await readFile(pnpmWorkspacePath, 'utf-8');
    const parsed = parseSimpleYaml(raw) as PnpmWorkspaceYaml;
    if (parsed.packages && Array.isArray(parsed.packages)) {
      return expandGlobPatterns(parsed.packages, projectRoot);
    }
  } catch {
    // File not found or parse error — fall through
  }

  // 2. Try package.json#workspaces
  const pkgJsonPath = join(projectRoot, 'package.json');
  try {
    const raw = await readFile(pkgJsonPath, 'utf-8');
    const pkg = JSON.parse(raw) as PackageJson;
    if (pkg.workspaces) {
      const patterns = Array.isArray(pkg.workspaces)
        ? pkg.workspaces
        : pkg.workspaces.packages ?? [];
      return expandGlobPatterns(patterns, projectRoot);
    }
  } catch {
    // File not found or parse error — fall through
  }

  return [];
}

/**
 * Minimal YAML parser for the simple `packages:` list in pnpm-workspace.yaml.
 * Only handles the subset we care about (top-level key: list of strings).
 */
function parseSimpleYaml(content: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  let currentKey: string | null = null;
  const currentList: string[] = [];

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trimEnd();
    if (!line || line.startsWith('#')) continue;

    // List item
    if (line.match(/^\s+-\s+/)) {
      const value = line.replace(/^\s+-\s+/, '').replace(/^['"]|['"]$/g, '');
      currentList.push(value);
      if (currentKey) {
        result[currentKey] = [...currentList];
      }
      continue;
    }

    // Top-level key
    const keyMatch = line.match(/^(\w+):\s*(.*)$/);
    if (keyMatch && keyMatch[1] != null && keyMatch[2] != null) {
      currentKey = keyMatch[1];
      currentList.length = 0;
      const inlineVal = keyMatch[2].trim();
      if (inlineVal) {
        result[currentKey] = inlineVal;
      } else {
        result[currentKey] = [];
      }
    }
  }

  return result;
}

/**
 * Expand workspace glob patterns (e.g. "packages/*") into concrete paths
 * that exist on disk. We only handle the common `prefix/*` glob form.
 */
async function expandGlobPatterns(
  patterns: string[],
  projectRoot: string
): Promise<string[]> {
  const { readdir } = await import('node:fs/promises');
  const results: string[] = [];

  for (const pattern of patterns) {
    if (pattern.endsWith('/*')) {
      // e.g. "packages/*"
      const prefix = pattern.slice(0, -2);
      const parentDir = join(projectRoot, prefix);
      try {
        const entries = await readdir(parentDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            results.push(`${prefix}/${entry.name}`);
          }
        }
      } catch {
        // Directory doesn't exist — skip
      }
    } else {
      // Literal path — include as-is
      results.push(pattern);
    }
  }

  return results;
}

// ── Layer/tour/domain merging helpers ───────────────────────────────────────

/**
 * Merge layers from subgraph into the accumulator map.
 * When the same layer id appears in multiple subgraphs, merge their node_ids.
 */
function mergeLayers(
  acc: Map<string, Layer>,
  layers: Layer[],
  prefix: string
): void {
  for (const layer of layers) {
    // Prefix node_ids to match prefixed node IDs
    const prefixedNodeIds = layer.node_ids.map((nid) => prefixNodeId(prefix, nid));
    const existing = acc.get(layer.id);
    if (existing) {
      // Merge node_ids, deduplicate
      const merged = Array.from(new Set([...existing.node_ids, ...prefixedNodeIds]));
      acc.set(layer.id, { ...existing, node_ids: merged });
    } else {
      acc.set(layer.id, { ...layer, node_ids: prefixedNodeIds });
    }
  }
}

/**
 * Merge tours from subgraph into the accumulator map, deduplicating by id.
 */
function mergeTours(acc: Map<string, Tour>, tours: Tour[]): void {
  for (const tour of tours) {
    if (!acc.has(tour.id)) {
      acc.set(tour.id, tour);
    }
  }
}

/**
 * Merge domains from subgraph into the accumulator map, deduplicating by id.
 */
function mergeDomains(acc: Map<string, Domain>, domains: Domain[]): void {
  for (const domain of domains) {
    if (!acc.has(domain.id)) {
      acc.set(domain.id, domain);
    }
  }
}

// ── Node/edge prefixing ──────────────────────────────────────────────────────

function prefixNodeId(packagePath: string, nodeId: string): string {
  return `${packagePath}:${nodeId}`;
}

function prefixNode(packagePath: string, node: SprangNode): SprangNode {
  return { ...node, id: prefixNodeId(packagePath, node.id) };
}

function prefixEdge(packagePath: string, edge: SprangEdge): SprangEdge {
  return {
    ...edge,
    source: prefixNodeId(packagePath, edge.source),
    target: prefixNodeId(packagePath, edge.target),
  };
}

// ── Main export ──────────────────────────────────────────────────────────────

export async function mergeSubgraphs(
  rootGraph: KnowledgeGraph,
  sprangDir: string,
  projectRoot: string
): Promise<{ graph: KnowledgeGraph; result: MergeResult }> {
  const mergeResult: MergeResult = {
    mergedPackages: [],
    addedNodes: 0,
    addedEdges: 0,
  };

  // Detect workspace packages
  const workspacePackages = await resolveWorkspacePackages(projectRoot);
  if (workspacePackages.length === 0) {
    return { graph: rootGraph, result: mergeResult };
  }

  // Build set of existing root node IDs to avoid duplicates
  const existingNodeIds = new Set<string>(rootGraph.nodes.map((n) => n.id));
  const existingEdgeKeys = new Set<string>(
    rootGraph.edges.map((e) => `${e.source}:${e.target}:${e.type}`)
  );

  // Seed layer/tour/domain accumulators from root graph
  const layerAcc = new Map<string, Layer>(rootGraph.layers.map((l) => [l.id, l]));
  const tourAcc = new Map<string, Tour>(rootGraph.tours.map((t) => [t.id, t]));
  const domainAcc = new Map<string, Domain>(rootGraph.domains.map((d) => [d.id, d]));

  const newNodes: SprangNode[] = [];
  const newEdges: SprangEdge[] = [];

  for (const pkgPath of workspacePackages) {
    const subgraphPath = join(projectRoot, pkgPath, SPRANG_DIR, GRAPH_FILE);
    const subgraph = await readJsonFileOrNull<KnowledgeGraph>(subgraphPath);
    if (!subgraph) continue;

    // Use the package path as the prefix
    const prefix = pkgPath;

    for (const node of subgraph.nodes) {
      const prefixed = prefixNode(prefix, node);
      if (!existingNodeIds.has(prefixed.id)) {
        existingNodeIds.add(prefixed.id);
        newNodes.push(prefixed);
        mergeResult.addedNodes++;
      }
    }

    for (const edge of subgraph.edges) {
      const prefixed = prefixEdge(prefix, edge);
      const key = `${prefixed.source}:${prefixed.target}:${prefixed.type}`;
      if (!existingEdgeKeys.has(key)) {
        existingEdgeKeys.add(key);
        newEdges.push(prefixed);
        mergeResult.addedEdges++;
      }
    }

    // Merge layers, tours, and domains from subgraph
    mergeLayers(layerAcc, subgraph.layers ?? [], prefix);
    mergeTours(tourAcc, subgraph.tours ?? []);
    mergeDomains(domainAcc, subgraph.domains ?? []);

    mergeResult.mergedPackages.push(pkgPath);
  }

  if (mergeResult.mergedPackages.length === 0) {
    return { graph: rootGraph, result: mergeResult };
  }

  const mergedNodes = [...rootGraph.nodes, ...newNodes];
  const mergedEdges = [...rootGraph.edges, ...newEdges];

  const mergedGraph: KnowledgeGraph = {
    ...rootGraph,
    nodes: mergedNodes,
    edges: mergedEdges,
    layers: Array.from(layerAcc.values()),
    tours: Array.from(tourAcc.values()),
    domains: Array.from(domainAcc.values()),
    stats: {
      ...rootGraph.stats,
      node_count: mergedNodes.length,
      edge_count: mergedEdges.length,
    },
  };

  return { graph: mergedGraph, result: mergeResult };
}
