import { describe, it, expect } from 'vitest';
import { GraphLoader } from '../src/graph-loader.js';
import { sprangHealth } from '../src/tools/sprang_health.js';
import { sprangTour } from '../src/tools/sprang_tour.js';
import { sprangQuery } from '../src/tools/sprang_query.js';
import { sprangDiffImpact } from '../src/tools/sprang_diff_impact.js';
import { sprangDomain } from '../src/tools/sprang_domain.js';
import { sprangWhy } from '../src/tools/sprang_why.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';

// ─── Shared helpers ────────────────────────────────────────────────────────────

async function makeTestDir(): Promise<string> {
  const dir = join(tmpdir(), `sprang-mcp-tools-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(join(dir, '.sprang'), { recursive: true });
  return dir;
}

function makeGraph(overrides: Record<string, unknown> = {}) {
  return {
    version: '1.0.0',
    generated_at: new Date().toISOString(),
    project_root: '/test',
    project_name: 'test',
    phase: 'complete',
    nodes: [
      {
        id: 'file:src/auth.ts',
        type: 'file',
        label: 'auth.ts',
        summary: 'JWT authentication logic',
        tags: ['auth'],
        risk_score: 0.85,
        risk_factors: [{ factor: 'blast_radius', score: 0.9, weight: 0.35 }],
        structural_warnings: [
          {
            category: 'god_node',
            severity: 'high',
            description: 'Too many outgoing edges',
            related_node_ids: [],
            heuristic: 'out_degree > 20',
          },
        ],
        decision_context: {
          commits: [
            { hash: 'abc123', author: 'alice@test.com', date: '2024-01-01', message: 'add JWT validation (#42)' },
          ],
          primary_authors: ['alice@test.com'],
          last_changed: '2024-01-01',
          change_frequency: 8,
          rationale_snippets: ['add JWT validation'],
          pr_references: ['#42'],
        },
      },
      {
        id: 'file:src/index.ts',
        type: 'file',
        label: 'index.ts',
        summary: 'Application entry point',
        tags: [],
        risk_score: 0.2,
      },
      {
        id: 'file:src/utils.ts',
        type: 'file',
        label: 'utils.ts',
        summary: 'Shared utility functions',
        tags: [],
        risk_score: 0.1,
      },
      {
        id: 'file:src/orphan.ts',
        type: 'file',
        label: 'orphan.ts',
        summary: 'Unused file with no edges',
        tags: [],
        risk_score: 0.05,
      },
    ],
    edges: [
      { source: 'file:src/index.ts', target: 'file:src/auth.ts', type: 'imports' },
      { source: 'file:src/auth.ts', target: 'file:src/utils.ts', type: 'imports' },
    ],
    layers: [
      { id: 'layer:core', name: 'Core', node_ids: ['file:src/auth.ts', 'file:src/utils.ts'] },
      { id: 'layer:entry', name: 'Entry', node_ids: ['file:src/index.ts'] },
    ],
    tours: [
      {
        id: 'tour:main',
        title: 'Main Tour',
        description: 'Walkthrough of the codebase',
        steps: [
          { node_id: 'file:src/index.ts', step_title: 'Entry', explanation: 'Start here', highlight: true },
          { node_id: 'file:src/auth.ts', step_title: 'Auth', explanation: 'Core auth', highlight: false },
        ],
      },
    ],
    domains: [
      {
        id: 'domain:auth',
        label: 'Authentication',
        summary: 'Handles JWT and sessions',
        flows: [{ id: 'flow:login', label: 'Login', steps: [] }],
        entities: ['file:src/auth.ts'],
      },
    ],
    stats: {
      node_count: 4,
      edge_count: 2,
      risk_summary: { high: 1, medium: 0, low: 3 },
      smell_summary: { god_node: 1 },
      generated_at: new Date().toISOString(),
    },
    ...overrides,
  };
}

async function setupGraph(overrides: Record<string, unknown> = {}): Promise<{ dir: string; loader: GraphLoader }> {
  const dir = await makeTestDir();
  await writeFile(join(dir, '.sprang', 'knowledge-graph.json'), JSON.stringify(makeGraph(overrides)), 'utf-8');
  const loader = new GraphLoader(dir);
  return { dir, loader };
}

// ─── sprang_health ─────────────────────────────────────────────────────────────

describe('sprang_health', () => {
  it('returns error when graph not found', async () => {
    const loader = new GraphLoader('/nonexistent');
    const result = await sprangHealth(loader, {});
    expect(result).toMatchObject({ error: expect.stringContaining('graph'), code: 'GRAPH_NOT_FOUND' });
  });

  it('returns correct node/edge counts', async () => {
    const { loader } = await setupGraph();
    const result = await sprangHealth(loader, {}) as Awaited<ReturnType<typeof sprangHealth>> & { total_nodes: number; total_edges: number };
    expect(result.total_nodes).toBe(4);
    expect(result.total_edges).toBe(2);
  });

  it('returns risk summary from graph stats', async () => {
    const { loader } = await setupGraph();
    const result = await sprangHealth(loader, {}) as { risk_summary: { high: number; medium: number; low: number } };
    expect(result.risk_summary).toEqual({ high: 1, medium: 0, low: 3 });
  });

  it('returns smell summary with god_node count', async () => {
    const { loader } = await setupGraph();
    const result = await sprangHealth(loader, {}) as { smell_summary: Record<string, number> };
    expect(result.smell_summary.god_node).toBe(1);
  });

  it('returns top risky nodes sorted by risk_score descending', async () => {
    const { loader } = await setupGraph();
    const result = await sprangHealth(loader, {}) as { top_10_risky_nodes: Array<{ node_id: string; risk_score: number }> };
    expect(result.top_10_risky_nodes[0].node_id).toBe('file:src/auth.ts');
    expect(result.top_10_risky_nodes[0].risk_score).toBe(0.85);
  });

  it('detects orphan node (no edges)', async () => {
    const { loader } = await setupGraph();
    const result = await sprangHealth(loader, {}) as { orphan_count: number };
    expect(result.orphan_count).toBeGreaterThanOrEqual(1); // orphan.ts has no edges
  });

  it('returns zero circular_dependency_count when none present', async () => {
    const { loader } = await setupGraph();
    const result = await sprangHealth(loader, {}) as { circular_dependency_count: number };
    expect(result.circular_dependency_count).toBe(0);
  });
});

// ─── sprang_tour ───────────────────────────────────────────────────────────────

describe('sprang_tour', () => {
  it('returns error when graph not found', async () => {
    const loader = new GraphLoader('/nonexistent');
    const result = await sprangTour(loader, {});
    expect(result).toMatchObject({ code: 'GRAPH_NOT_FOUND' });
  });

  it('returns first tour by default', async () => {
    const { loader } = await setupGraph();
    const result = await sprangTour(loader, {}) as { tour_id: string; title: string };
    expect(result.tour_id).toBe('tour:main');
    expect(result.title).toBe('Main Tour');
  });

  it('returns all steps for junior persona', async () => {
    const { loader } = await setupGraph();
    const result = await sprangTour(loader, { persona: 'junior' }) as { steps: unknown[]; total_steps: number };
    expect(result.total_steps).toBe(2);
    expect(result.steps).toHaveLength(2);
  });

  it('skips first step for senior persona', async () => {
    const { loader } = await setupGraph();
    const result = await sprangTour(loader, { persona: 'senior' }) as { total_steps: number };
    expect(result.total_steps).toBe(1);
  });

  it('returns empty steps for pm persona (no domain/service nodes in tour)', async () => {
    const { loader } = await setupGraph();
    const result = await sprangTour(loader, { persona: 'pm' }) as { total_steps: number };
    expect(result.total_steps).toBe(0);
  });

  it('returns error for unknown tour_id', async () => {
    const { loader } = await setupGraph();
    const result = await sprangTour(loader, { tour_id: 'tour:nonexistent' });
    expect(result).toMatchObject({ code: 'TOUR_NOT_FOUND' });
  });

  it('returns error when graph has no tours', async () => {
    const { loader } = await setupGraph({ tours: [] });
    const result = await sprangTour(loader, {});
    expect(result).toMatchObject({ code: 'NO_TOURS' });
  });

  it('enriches steps with node data', async () => {
    const { loader } = await setupGraph();
    const result = await sprangTour(loader, { persona: 'junior' }) as {
      steps: Array<{ node?: { label: string }; step_number: number }>
    };
    const first = result.steps[0];
    expect(first.step_number).toBe(1);
    expect(first.node?.label).toBe('index.ts');
  });
});

// ─── sprang_query ──────────────────────────────────────────────────────────────

describe('sprang_query', () => {
  it('returns empty nodes when graph not found', async () => {
    const loader = new GraphLoader('/nonexistent');
    const result = await sprangQuery(loader, { query: 'auth' }) as { nodes: unknown[] };
    expect(result.nodes).toHaveLength(0);
  });

  it('returns nodes matching query in label', async () => {
    const { loader } = await setupGraph();
    const result = await sprangQuery(loader, { query: 'auth' }) as { nodes: Array<{ id: string }> };
    expect(result.nodes.some((n) => n.id === 'file:src/auth.ts')).toBe(true);
  });

  it('returns nodes matching query in summary', async () => {
    const { loader } = await setupGraph();
    const result = await sprangQuery(loader, { query: 'JWT' }) as { nodes: Array<{ id: string }> };
    expect(result.nodes.some((n) => n.id === 'file:src/auth.ts')).toBe(true);
  });

  it('returns empty results for unmatched query', async () => {
    const { loader } = await setupGraph();
    const result = await sprangQuery(loader, { query: 'xyznonexistentxyz' }) as { nodes: unknown[] };
    expect(result.nodes).toHaveLength(0);
  });

  it('respects node_types filter', async () => {
    const { loader } = await setupGraph();
    const result = await sprangQuery(loader, { query: 'auth', node_types: ['function'] }) as { nodes: unknown[] };
    expect(result.nodes).toHaveLength(0); // no function nodes in mock
  });

  it('respects limit parameter', async () => {
    const { loader } = await setupGraph();
    const result = await sprangQuery(loader, { query: 'ts', limit: 2 }) as { nodes: unknown[] };
    expect(result.nodes.length).toBeLessThanOrEqual(2);
  });
});

// ─── sprang_query (semantic mode) ─────────────────────────────────────────────

describe('sprang_query — semantic mode', () => {
  it('returns results for mode: "semantic" using TF-IDF fallback (no embedding file)', async () => {
    const { loader } = await setupGraph();
    const result = await sprangQuery(loader, {
      query: 'authentication login',
      mode: 'semantic',
    }) as { nodes: Array<{ id: string; score: number }>; total: number; query: string };

    expect(result.query).toBe('authentication login');
    // Should return nodes — auth.ts has "JWT authentication logic" in summary
    expect(Array.isArray(result.nodes)).toBe(true);
    // Scores should be present (semantic mode always includes score)
    if (result.nodes.length > 0) {
      expect(typeof result.nodes[0]!.score).toBe('number');
      expect(result.nodes[0]!.score).toBeGreaterThanOrEqual(0);
      expect(result.nodes[0]!.score).toBeLessThanOrEqual(1);
    }
  });

  it('respects node_types filter in semantic mode', async () => {
    const { loader } = await setupGraph();
    const result = await sprangQuery(loader, {
      query: 'auth',
      mode: 'semantic',
      node_types: ['function'],
    }) as { nodes: unknown[] };
    // No function-type nodes in test graph
    expect(result.nodes).toHaveLength(0);
  });

  it('uses stored embeddings when embedding file exists', async () => {
    const { dir, loader } = await setupGraph();
    // Write a fake embedding store
    const embeddingStore = {
      version: '1.0',
      model: 'tfidf-local',
      generatedAt: new Date().toISOString(),
      embeddings: {
        'file:src/auth.ts': [1, 0, 0, 0],
        'file:src/index.ts': [0, 1, 0, 0],
        'file:src/utils.ts': [0, 0, 1, 0],
        'file:src/orphan.ts': [0, 0, 0, 1],
      },
    };
    await mkdir(join(dir, '.sprang', 'cache'), { recursive: true });
    await writeFile(
      join(dir, '.sprang', 'cache', 'embeddings.json'),
      JSON.stringify(embeddingStore),
      'utf-8'
    );

    const result = await sprangQuery(loader, {
      query: 'jwt authentication',
      mode: 'semantic',
    }) as { nodes: Array<{ id: string; score: number }> };

    expect(Array.isArray(result.nodes)).toBe(true);
    // Nodes should have score field
    for (const node of result.nodes) {
      expect(typeof node.score).toBe('number');
    }
  });
});

// ─── sprang_diff_impact ────────────────────────────────────────────────────────

describe('sprang_diff_impact', () => {
  it('returns error when graph not found', async () => {
    const loader = new GraphLoader('/nonexistent');
    const result = await sprangDiffImpact(loader, { files: ['src/auth.ts'] });
    expect(result).toMatchObject({ code: 'GRAPH_NOT_FOUND' });
  });

  it('returns changed nodes for known files', async () => {
    const { loader } = await setupGraph();
    const result = await sprangDiffImpact(loader, { files: ['src/auth.ts'] }) as {
      changed_nodes: Array<{ node_id: string }>;
    };
    expect(result.changed_nodes.some((n) => n.node_id === 'file:src/auth.ts')).toBe(true);
  });

  it('returns impact nodes via BFS from changed files', async () => {
    const { loader } = await setupGraph();
    // index.ts imports auth.ts, so changing utils.ts should not impact index.ts
    // but changing auth.ts should: index.ts imports auth.ts
    const result = await sprangDiffImpact(loader, { files: ['src/utils.ts'] }) as {
      impact_nodes: Array<{ node_id: string }>;
    };
    // auth.ts imports utils.ts so auth.ts is in blast radius
    expect(result.impact_nodes.some((n) => n.node_id === 'file:src/auth.ts')).toBe(true);
  });

  it('returns empty impact for unknown files', async () => {
    const { loader } = await setupGraph();
    const result = await sprangDiffImpact(loader, { files: ['src/does-not-exist.ts'] }) as {
      changed_nodes: unknown[];
      impact_nodes: unknown[];
    };
    expect(result.changed_nodes).toHaveLength(0);
  });

  it('returns high_risk_count summary', async () => {
    const { loader } = await setupGraph();
    const result = await sprangDiffImpact(loader, { files: ['src/auth.ts'] }) as {
      high_risk_count: number;
      total_impact: number;
    };
    expect(typeof result.high_risk_count).toBe('number');
    expect(typeof result.total_impact).toBe('number');
  });
});

// ─── sprang_domain ─────────────────────────────────────────────────────────────

describe('sprang_domain', () => {
  it('returns error when graph not found', async () => {
    const loader = new GraphLoader('/nonexistent');
    const result = await sprangDomain(loader, {});
    expect(result).toMatchObject({ code: 'GRAPH_NOT_FOUND' });
  });

  it('lists all domains when no domain_name given', async () => {
    const { loader } = await setupGraph();
    const result = await sprangDomain(loader, {}) as { domains: Array<{ label: string }> };
    expect(result.domains).toBeDefined();
    expect(result.domains.some((d) => d.label === 'Authentication')).toBe(true);
  });

  it('returns domain detail for known domain name', async () => {
    const { loader } = await setupGraph();
    const result = await sprangDomain(loader, { domain_name: 'Authentication' }) as {
      domain: { label: string; entry_points?: string[] };
    };
    expect(result.domain.label).toBe('Authentication');
  });

  it('returns error for unknown domain name', async () => {
    const { loader } = await setupGraph();
    const result = await sprangDomain(loader, { domain_name: 'Nonexistent' });
    expect(result).toMatchObject({ code: 'DOMAIN_NOT_FOUND' });
  });
});

// ─── sprang_why ────────────────────────────────────────────────────────────────

describe('sprang_why', () => {
  it('returns error when graph not found', async () => {
    const loader = new GraphLoader('/nonexistent');
    const result = await sprangWhy(loader, { node_id: 'file:src/auth.ts' }, '/nonexistent');
    expect(result).toMatchObject({ code: 'GRAPH_NOT_FOUND' });
  });

  it('returns error for unknown node', async () => {
    const { dir, loader } = await setupGraph();
    const result = await sprangWhy(loader, { node_id: 'file:nonexistent.ts' }, dir);
    expect(result).toMatchObject({ code: 'NODE_NOT_FOUND' });
  });

  it('returns node label and summary', async () => {
    const { dir, loader } = await setupGraph();
    const result = await sprangWhy(loader, { node_id: 'file:src/auth.ts' }, dir) as {
      label: string;
      summary: string;
    };
    expect(result.label).toBe('auth.ts');
    expect(result.summary).toBe('JWT authentication logic');
  });

  it('returns decision_context with commits and authors', async () => {
    const { dir, loader } = await setupGraph();
    const result = await sprangWhy(loader, { node_id: 'file:src/auth.ts' }, dir) as unknown as {
      decision_context: {
        commits: Array<{ hash: string }>;
        primary_authors: string[];
        change_frequency: number;
        pr_references: string[];
      };
    };
    expect(result.decision_context.commits).toHaveLength(1);
    expect(result.decision_context.primary_authors).toContain('alice@test.com');
    expect(result.decision_context.change_frequency).toBe(8);
    expect(result.decision_context.pr_references).toContain('#42');
  });

  it('returns node with no decision_context gracefully', async () => {
    const { dir, loader } = await setupGraph();
    const result = await sprangWhy(loader, { node_id: 'file:src/index.ts' }, dir) as {
      label: string;
      decision_context: unknown;
    };
    expect(result.label).toBe('index.ts');
    expect(['object', 'undefined'].includes(typeof result.decision_context)).toBe(true);
  });
});
