import { join } from 'node:path';
import type { KnowledgeGraph } from '../schema/types.js';
import { knowledgeGraphSchema } from '../schema/validators.js';
import { writeFileAtomic, readJsonFile, readJsonFileOrNull } from '../utils/fs.js';
import {
  GRAPH_FILE,
  GRAPH_VERSION,
  INTERMEDIATE_DIR,
  CACHE_DIR,
  ANNOTATIONS_DIR,
} from '../schema/constants.js';

export async function loadGraph(sprangDir: string): Promise<KnowledgeGraph> {
  const filePath = join(sprangDir, GRAPH_FILE);
  const raw = await readJsonFile<unknown>(filePath);
  const result = knowledgeGraphSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(
      `Invalid knowledge graph at ${filePath}: ${result.error.message}`
    );
  }
  return result.data;
}

export async function loadGraphOrNull(sprangDir: string): Promise<KnowledgeGraph | null> {
  const filePath = join(sprangDir, GRAPH_FILE);
  const raw = await readJsonFileOrNull<unknown>(filePath);
  if (raw === null) return null;
  const result = knowledgeGraphSchema.safeParse(raw);
  if (!result.success) return null;
  return result.data;
}

export async function saveGraph(sprangDir: string, graph: KnowledgeGraph): Promise<void> {
  const filePath = join(sprangDir, GRAPH_FILE);
  await writeFileAtomic(filePath, JSON.stringify(graph, null, 2));
}

/**
 * Merge a freshly-scanned Phase 1 skeleton with an existing enriched graph,
 * preserving Phase 2 work (layers, domains, tours, risk/security stats, and
 * per-node enrichment) for nodes that still exist.
 *
 * Used by `--phase1-only` incremental scans (post-commit hook, watcher,
 * `--if-stale`) so a quick structural refresh never resets an enriched graph
 * back to a bare skeleton. The fresh skeleton wins for structural fields
 * (nodes/edges/location/metadata); the existing graph wins for enrichment.
 */
export function mergePhase1IntoEnriched(
  skeleton: KnowledgeGraph,
  existing: KnowledgeGraph,
): KnowledgeGraph {
  const prevById = new Map(existing.nodes.map((n) => [n.id, n]));

  const nodes = skeleton.nodes.map((fresh) => {
    const prev = prevById.get(fresh.id);
    if (!prev) return fresh;
    // Keep fresh structural fields; carry over enrichment from the prior graph.
    return {
      ...fresh,
      summary: prev.summary ?? fresh.summary,
      complexity: prev.complexity ?? fresh.complexity,
      layer: prev.layer ?? fresh.layer,
      tags: prev.tags ?? fresh.tags,
      languageNotes: prev.languageNotes ?? fresh.languageNotes,
      domainMeta: prev.domainMeta ?? fresh.domainMeta,
      knowledgeMeta: prev.knowledgeMeta ?? fresh.knowledgeMeta,
      decision_context: prev.decision_context ?? fresh.decision_context,
      structural_warnings: prev.structural_warnings ?? fresh.structural_warnings,
      security_warnings: prev.security_warnings ?? fresh.security_warnings,
      risk_score: prev.risk_score ?? fresh.risk_score,
      risk_factors: prev.risk_factors ?? fresh.risk_factors,
      annotations: prev.annotations ?? fresh.annotations,
    };
  });

  return {
    ...skeleton,
    nodes,
    layers: existing.layers.length > 0 ? existing.layers : skeleton.layers,
    tours: existing.tours.length > 0 ? existing.tours : skeleton.tours,
    domains: existing.domains.length > 0 ? existing.domains : skeleton.domains,
    // Keep the enriched phase marker so the dashboard/health don't downgrade.
    phase: existing.phase === 'skeleton' ? skeleton.phase : existing.phase,
    stats: {
      ...skeleton.stats,
      risk_summary: existing.stats.risk_summary ?? skeleton.stats.risk_summary,
      smell_summary: existing.stats.smell_summary ?? skeleton.stats.smell_summary,
      security_summary: existing.stats.security_summary,
      phase2_completed_at: existing.stats.phase2_completed_at,
    },
  };
}

export function createEmptyGraph(projectRoot: string, projectName: string): KnowledgeGraph {
  const now = new Date().toISOString();
  return {
    version: GRAPH_VERSION,
    generated_at: now,
    project_root: projectRoot,
    project_name: projectName,
    description: undefined,
    languages: [],
    frameworks: [],
    phase: 'skeleton',
    nodes: [],
    edges: [],
    layers: [],
    tours: [],
    domains: [],
    stats: {
      node_count: 0,
      edge_count: 0,
      risk_summary: { high: 0, medium: 0, low: 0 },
      smell_summary: {},
      generated_at: now,
    },
  };
}

// Re-export path helpers used by orchestrator
export { INTERMEDIATE_DIR, CACHE_DIR, ANNOTATIONS_DIR };
