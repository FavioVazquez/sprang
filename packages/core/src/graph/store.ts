import { join } from 'node:path';
import { basename } from 'node:path';
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
