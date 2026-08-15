/**
 * Shared fixtures for the behavioural views (Hotspot, Knowledge, Coupling).
 */
import type { KnowledgeGraph, SprangEdge, SprangNode } from '../../types';
import type { BehavioralMetrics } from '../../utils/behavioral';

export function makeGraph(overrides: Partial<KnowledgeGraph> = {}): KnowledgeGraph {
  const now = new Date().toISOString();
  return {
    version: '1.0.0',
    generated_at: now,
    project_root: '/tmp',
    project_name: 'test',
    phase: 'complete',
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
    ...overrides,
  };
}

export interface FileNodeSpec {
  path: string;
  lines?: number;
  behavioral?: BehavioralMetrics | null;
}

export function makeFileNode(spec: FileNodeSpec): SprangNode {
  const { path, lines = 100, behavioral } = spec;
  return {
    id: `file:${path}`,
    type: 'file',
    label: path.split('/').pop() ?? path,
    filePath: path,
    location: { file: path },
    metadata: {
      sizeLines: lines,
      ...(behavioral === null || behavioral === undefined ? {} : { behavioral }),
    },
    risk_score: 0.2,
  };
}

export function makeEdge(from: string, to: string, type: SprangEdge['type'] = 'imports'): SprangEdge {
  return { source: `file:${from}`, target: `file:${to}`, type };
}

/** Full behavioural block with sensible defaults, overridable field by field. */
export function behavioral(over: Partial<BehavioralMetrics> = {}): BehavioralMetrics {
  return {
    revisions: 3,
    lines_added: 40,
    lines_deleted: 10,
    bug_fixes: 0,
    age_months: 6,
    last_change: '2026-01-01',
    hotspot_score: 0.3,
    main_developer: 'Ada Lovelace',
    top_share: 0.5,
    bus_factor: 2,
    knowledge_diffusion: 0.4,
    minor_contributors: 1,
    ...over,
  };
}

/** A graph with behavioural data on every file — the happy path. */
export function graphWithBehavioral(): KnowledgeGraph {
  return makeGraph({
    nodes: [
      makeFileNode({
        path: 'src/hot.ts',
        lines: 800,
        behavioral: behavioral({ hotspot_score: 0.95, revisions: 40, bus_factor: 1, top_share: 1 }),
      }),
      makeFileNode({
        path: 'src/warm.ts',
        lines: 300,
        behavioral: behavioral({ hotspot_score: 0.4, revisions: 8, bus_factor: 3, top_share: 0.5 }),
      }),
      makeFileNode({
        path: 'lib/cold.ts',
        lines: 60,
        behavioral: behavioral({ hotspot_score: 0, revisions: 1, bus_factor: 1, top_share: 1 }),
      }),
    ],
    edges: [makeEdge('src/hot.ts', 'src/warm.ts')],
  });
}

/** An older graph: file nodes, but no `metadata.behavioral` anywhere. */
export function graphWithoutBehavioral(): KnowledgeGraph {
  return makeGraph({
    nodes: [
      makeFileNode({ path: 'src/a.ts', lines: 100 }),
      makeFileNode({ path: 'src/b.ts', lines: 200 }),
    ],
    edges: [makeEdge('src/a.ts', 'src/b.ts')],
  });
}
