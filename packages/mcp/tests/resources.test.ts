/**
 * Resources, resource templates and completion.
 *
 * Resources are the application-controlled half of MCP: a user attaches one
 * from the `@` menu, so a broken listing or a thrown read is user-visible in a
 * way a tool failure is not. These tests pin the listing shape, the level-1
 * URI expansion (node ids carry colons, paths carry slashes) and the
 * degradation contract when no graph exists.
 */
import { describe, it, expect } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { GraphLoader } from '../src/graph-loader.js';
import {
  STATIC_RESOURCES,
  RESOURCE_TEMPLATES,
  COMPLETION_LIMIT,
  listResources,
  listResourceTemplates,
  matchUriTemplate,
  readResource,
  complete,
  completeNodeIds,
} from '../src/resources.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

async function makeTestDir(): Promise<string> {
  const dir = join(
    tmpdir(),
    `sprang-resources-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  await mkdir(join(dir, '.sprang'), { recursive: true });
  return dir;
}

interface GraphOverrides {
  nodes?: unknown[];
  edges?: unknown[];
}

function makeGraph(overrides: GraphOverrides = {}): Record<string, unknown> {
  return {
    version: '1.0.0',
    generated_at: new Date().toISOString(),
    project_root: '/test',
    project_name: 'test',
    phase: 'complete',
    nodes: overrides.nodes ?? [
      {
        id: 'file:src/auth.ts',
        type: 'file',
        label: 'auth.ts',
        filePath: 'src/auth.ts',
        summary: 'Auth logic',
        risk_score: 0.8,
      },
      { id: 'file:src/index.ts', type: 'file', label: 'index.ts', filePath: 'src/index.ts' },
      { id: 'file:src/deep/nested/utils.ts', type: 'file', label: 'utils.ts', filePath: 'src/deep/nested/utils.ts' },
      { id: 'function:src/auth.ts:verifyToken', type: 'function', label: 'verifyToken' },
      { id: 'function:src/auth.ts:signToken', type: 'function', label: 'signToken' },
      { id: 'class:src/index.ts:App', type: 'class', label: 'App' },
    ],
    edges: overrides.edges ?? [
      { source: 'file:src/index.ts', target: 'file:src/auth.ts', type: 'imports' },
      { source: 'file:src/auth.ts', target: 'function:src/auth.ts:verifyToken', type: 'contains' },
    ],
    layers: [],
    tours: [],
    domains: [],
    stats: {
      node_count: 6,
      edge_count: 2,
      risk_summary: { high: 1, medium: 0, low: 5 },
      smell_summary: {},
      generated_at: new Date().toISOString(),
    },
  };
}

async function withGraph(graph: Record<string, unknown> = makeGraph()): Promise<{
  dir: string;
  loader: GraphLoader;
}> {
  const dir = await makeTestDir();
  await writeFile(join(dir, '.sprang', 'knowledge-graph.json'), JSON.stringify(graph), 'utf-8');
  return { dir, loader: new GraphLoader(dir) };
}

function noGraphLoader(): GraphLoader {
  return new GraphLoader(join(tmpdir(), 'sprang-definitely-missing-root'));
}

function parseJson(text: string): Record<string, unknown> {
  return JSON.parse(text) as Record<string, unknown>;
}

async function readJson(
  loader: GraphLoader,
  root: string,
  uri: string
): Promise<Record<string, unknown>> {
  const result = await readResource(loader, root, uri);
  const first = result.contents[0];
  expect(first).toBeDefined();
  return parseJson(first?.text ?? '{}');
}

// ─── Static resource listing ──────────────────────────────────────────────────

describe('resources/list', () => {
  it('lists all four static resources', () => {
    expect(listResources().resources).toHaveLength(4);
  });

  it('lists the exact expected URIs', () => {
    expect(listResources().resources.map((r) => r.uri)).toEqual([
      'sprang://health',
      'sprang://report',
      'sprang://graph/stats',
      'sprang://suggestions',
    ]);
  });

  it('gives every resource a non-empty uri, name, title, description and mimeType', () => {
    for (const resource of listResources().resources) {
      expect(resource.uri.startsWith('sprang://')).toBe(true);
      expect(resource.name.length).toBeGreaterThan(0);
      expect(resource.title.length).toBeGreaterThan(0);
      expect(resource.description.length).toBeGreaterThan(0);
      expect(resource.mimeType.length).toBeGreaterThan(0);
    }
  });

  it('declares the report as markdown and the rest as JSON', () => {
    const byUri = new Map(STATIC_RESOURCES.map((r) => [r.uri, r.mimeType]));
    expect(byUri.get('sprang://report')).toBe('text/markdown');
    expect(byUri.get('sprang://health')).toBe('application/json');
    expect(byUri.get('sprang://graph/stats')).toBe('application/json');
    expect(byUri.get('sprang://suggestions')).toBe('application/json');
  });

  it('lists resources even when no graph exists', () => {
    // Listing is static on purpose: the `@` menu must populate on a fresh repo.
    expect(listResources().resources).toHaveLength(STATIC_RESOURCES.length);
  });

  it('uses unique resource names', () => {
    const names = listResources().resources.map((r) => r.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

// ─── Reading static resources with a graph ────────────────────────────────────

describe('resources/read with a real graph', () => {
  it('reads sprang://health as a health report', async () => {
    const { dir, loader } = await withGraph();
    const body = await readJson(loader, dir, 'sprang://health');
    expect(body['health_grade']).toBeDefined();
    expect(body['total_nodes']).toBe(6);
  });

  it('reads sprang://graph/stats as the stats block', async () => {
    const { dir, loader } = await withGraph();
    const body = await readJson(loader, dir, 'sprang://graph/stats');
    expect(body['node_count']).toBe(6);
    expect(body['edge_count']).toBe(2);
  });

  it('reads sprang://suggestions as a counted list', async () => {
    const { dir, loader } = await withGraph();
    const body = await readJson(loader, dir, 'sprang://suggestions');
    expect(Array.isArray(body['suggestions'])).toBe(true);
    expect(body['count']).toBe((body['suggestions'] as unknown[]).length);
  });

  it('reads sprang://report from .sprang/SPRANG_REPORT.md when present', async () => {
    const { dir, loader } = await withGraph();
    await writeFile(join(dir, '.sprang', 'SPRANG_REPORT.md'), '# Arch\n\nHello.\n', 'utf-8');
    const result = await readResource(loader, dir, 'sprang://report');
    expect(result.contents[0]?.mimeType).toBe('text/markdown');
    expect(result.contents[0]?.text).toContain('# Arch');
  });

  it('returns a readable markdown placeholder when the report is missing', async () => {
    const { dir, loader } = await withGraph();
    const result = await readResource(loader, dir, 'sprang://report');
    expect(result.contents[0]?.mimeType).toBe('text/markdown');
    expect(result.contents[0]?.text).toContain('sprang scan');
  });

  it('echoes the requested uri back in the contents', async () => {
    const { dir, loader } = await withGraph();
    const result = await readResource(loader, dir, 'sprang://graph/stats');
    expect(result.contents[0]?.uri).toBe('sprang://graph/stats');
  });
});

// ─── Reading with no graph ────────────────────────────────────────────────────

describe('resources/read with no graph', () => {
  it('returns a readable error for sprang://graph/stats rather than throwing', async () => {
    const loader = noGraphLoader();
    const body = await readJson(loader, '/nonexistent', 'sprang://graph/stats');
    expect(body['code']).toBe('GRAPH_NOT_FOUND');
    expect(typeof body['remedy']).toBe('string');
  });

  it('returns a readable error for sprang://suggestions', async () => {
    const loader = noGraphLoader();
    const body = await readJson(loader, '/nonexistent', 'sprang://suggestions');
    expect(body['code']).toBe('GRAPH_NOT_FOUND');
  });

  it('still answers sprang://health with an error payload, not a rejection', async () => {
    const loader = noGraphLoader();
    await expect(readResource(loader, '/nonexistent', 'sprang://health')).resolves.toBeDefined();
  });

  it('still answers sprang://report with markdown', async () => {
    const loader = noGraphLoader();
    const result = await readResource(loader, '/nonexistent', 'sprang://report');
    expect(result.contents[0]?.mimeType).toBe('text/markdown');
  });
});

// ─── Template listing ─────────────────────────────────────────────────────────

describe('resources/templates/list', () => {
  it('lists the three templates', () => {
    expect(listResourceTemplates().resourceTemplates.map((t) => t.uriTemplate)).toEqual([
      'sprang://node/{nodeId}',
      'sprang://file/{path}',
      'sprang://why/{nodeId}',
    ]);
  });

  it('gives every template a name, title, description and mimeType', () => {
    for (const template of RESOURCE_TEMPLATES) {
      expect(template.name.length).toBeGreaterThan(0);
      expect(template.title.length).toBeGreaterThan(0);
      expect(template.description.length).toBeGreaterThan(0);
      expect(template.mimeType).toBe('application/json');
    }
  });
});

// ─── URI template expansion ───────────────────────────────────────────────────

describe('matchUriTemplate (RFC 6570 level 1)', () => {
  it('captures a simple variable', () => {
    expect(matchUriTemplate('sprang://node/{nodeId}', 'sprang://node/file:src/a.ts')).toEqual({
      nodeId: 'file:src/a.ts',
    });
  });

  it('captures a nodeId containing colons greedily', () => {
    expect(
      matchUriTemplate('sprang://node/{nodeId}', 'sprang://node/function:src/a.ts:doThing')
    ).toEqual({ nodeId: 'function:src/a.ts:doThing' });
  });

  it('captures a path containing slashes greedily', () => {
    expect(
      matchUriTemplate('sprang://file/{path}', 'sprang://file/src/deep/nested/utils.ts')
    ).toEqual({ path: 'src/deep/nested/utils.ts' });
  });

  it('percent-decodes the captured segment', () => {
    expect(
      matchUriTemplate('sprang://node/{nodeId}', 'sprang://node/function%3Asrc%2Fa.ts%3AdoThing')
    ).toEqual({ nodeId: 'function:src/a.ts:doThing' });
  });

  it('tolerates a malformed percent escape instead of throwing', () => {
    expect(matchUriTemplate('sprang://node/{nodeId}', 'sprang://node/100%')).toEqual({
      nodeId: '100%',
    });
  });

  it('returns null when the prefix does not match', () => {
    expect(matchUriTemplate('sprang://node/{nodeId}', 'sprang://why/x')).toBeNull();
  });

  it('returns null when the variable would be empty', () => {
    expect(matchUriTemplate('sprang://node/{nodeId}', 'sprang://node/')).toBeNull();
  });
});

// ─── Reading templated resources ──────────────────────────────────────────────

describe('resources/read for templates', () => {
  it('reads sprang://node/{nodeId} for a file node', async () => {
    const { dir, loader } = await withGraph();
    const body = await readJson(loader, dir, 'sprang://node/file:src/auth.ts');
    expect((body['node'] as Record<string, unknown>)['id']).toBe('file:src/auth.ts');
    expect(Array.isArray(body['neighbors'])).toBe(true);
  });

  it('reads sprang://node/{nodeId} for a colon-heavy function id', async () => {
    const { dir, loader } = await withGraph();
    const body = await readJson(loader, dir, 'sprang://node/function:src/auth.ts:verifyToken');
    expect((body['node'] as Record<string, unknown>)['id']).toBe(
      'function:src/auth.ts:verifyToken'
    );
  });

  it('reads sprang://why/{nodeId}', async () => {
    const { dir, loader } = await withGraph();
    const body = await readJson(loader, dir, 'sprang://why/file:src/auth.ts');
    expect(body['node_id']).toBe('file:src/auth.ts');
  });

  it('reads sprang://file/{path} and includes contained symbols', async () => {
    const { dir, loader } = await withGraph();
    const body = await readJson(loader, dir, 'sprang://file/src/auth.ts');
    expect((body['file'] as Record<string, unknown>)['id']).toBe('file:src/auth.ts');
    const symbolIds = (body['symbols'] as Array<{ id: string }>).map((s) => s.id);
    expect(symbolIds).toContain('function:src/auth.ts:verifyToken');
    expect(symbolIds).toContain('function:src/auth.ts:signToken');
    expect(body['symbol_count']).toBe(symbolIds.length);
  });

  it('reads a deep slashed path through sprang://file/{path}', async () => {
    const { dir, loader } = await withGraph();
    const body = await readJson(loader, dir, 'sprang://file/src/deep/nested/utils.ts');
    expect((body['file'] as Record<string, unknown>)['id']).toBe('file:src/deep/nested/utils.ts');
  });

  it('accepts a percent-encoded node id', async () => {
    const { dir, loader } = await withGraph();
    const body = await readJson(
      loader,
      dir,
      `sprang://node/${encodeURIComponent('function:src/auth.ts:verifyToken')}`
    );
    expect((body['node'] as Record<string, unknown>)['id']).toBe(
      'function:src/auth.ts:verifyToken'
    );
  });

  it('reports an unknown file path without throwing', async () => {
    const { dir, loader } = await withGraph();
    const body = await readJson(loader, dir, 'sprang://file/src/ghost.ts');
    expect(body['code']).toBe('NODE_NOT_FOUND');
  });

  it('reports a URI matching no resource or template', async () => {
    const { dir, loader } = await withGraph();
    const body = await readJson(loader, dir, 'sprang://banana');
    expect(body['code']).toBe('UNKNOWN_RESOURCE');
    expect(String(body['remedy'])).toContain('sprang://health');
  });

  it('returns a graph error for sprang://file/{path} with no graph', async () => {
    const loader = noGraphLoader();
    const body = await readJson(loader, '/nonexistent', 'sprang://file/src/a.ts');
    expect(body['code']).toBe('GRAPH_NOT_FOUND');
  });
});

// ─── Completion ───────────────────────────────────────────────────────────────

describe('completion/complete', () => {
  const nodeRef = { type: 'ref/resource', uri: 'sprang://node/{nodeId}' };

  it('prefix-matches node ids case-insensitively', async () => {
    const { loader } = await withGraph();
    const result = await complete(loader, {
      ref: nodeRef,
      argument: { name: 'nodeId', value: 'FUNCTION:' },
    });
    expect(result.completion.values).toContain('function:src/auth.ts:verifyToken');
    expect(result.completion.values.every((v) => v.startsWith('function:'))).toBe(true);
  });

  it('falls back to substring matching when there are fewer than ten prefix hits', async () => {
    const { loader } = await withGraph();
    const result = await complete(loader, {
      ref: nodeRef,
      argument: { name: 'nodeId', value: 'verifytoken' },
    });
    expect(result.completion.values).toEqual(['function:src/auth.ts:verifyToken']);
  });

  it('puts prefix hits ahead of substring hits', async () => {
    const { loader } = await withGraph();
    const result = await complete(loader, {
      ref: nodeRef,
      argument: { name: 'nodeId', value: 'file:' },
    });
    const values = result.completion.values;
    expect(values[0]?.startsWith('file:')).toBe(true);
  });

  it('ranks shorter matches first, then alphabetically', async () => {
    const { loader } = await withGraph({
      ...makeGraph(),
      nodes: [
        { id: 'file:bbb.ts', type: 'file', label: 'bbb' },
        { id: 'file:aaa.ts', type: 'file', label: 'aaa' },
        { id: 'file:longer/path.ts', type: 'file', label: 'longer' },
      ],
      edges: [],
    });
    const result = await complete(loader, {
      ref: nodeRef,
      argument: { name: 'nodeId', value: 'file:' },
    });
    expect(result.completion.values).toEqual([
      'file:aaa.ts',
      'file:bbb.ts',
      'file:longer/path.ts',
    ]);
  });

  it('is deterministic across repeated calls', async () => {
    const { loader } = await withGraph();
    const a = await complete(loader, { ref: nodeRef, argument: { name: 'nodeId', value: 's' } });
    const b = await complete(loader, { ref: nodeRef, argument: { name: 'nodeId', value: 's' } });
    expect(a.completion.values).toEqual(b.completion.values);
  });

  it('caps values at 100 and sets hasMore', async () => {
    const nodes = Array.from({ length: 150 }, (_, i) => ({
      id: `function:src/a.ts:fn${String(i).padStart(4, '0')}`,
      type: 'function',
      label: `fn${i}`,
    }));
    const { loader } = await withGraph({ ...makeGraph(), nodes, edges: [] });
    const result = await complete(loader, {
      ref: nodeRef,
      argument: { name: 'nodeId', value: 'function:' },
    });
    expect(result.completion.values).toHaveLength(COMPLETION_LIMIT);
    expect(result.completion.total).toBe(150);
    expect(result.completion.hasMore).toBe(true);
  });

  it('reports hasMore false when everything fits', async () => {
    const { loader } = await withGraph();
    const result = await complete(loader, {
      ref: nodeRef,
      argument: { name: 'nodeId', value: 'file:' },
    });
    expect(result.completion.hasMore).toBe(false);
    expect(result.completion.total).toBe(result.completion.values.length);
  });

  it('returns everything (capped) for an empty value', async () => {
    const { loader } = await withGraph();
    const result = await complete(loader, {
      ref: nodeRef,
      argument: { name: 'nodeId', value: '' },
    });
    expect(result.completion.values.length).toBe(6);
  });

  it('returns an empty completion when no graph exists', async () => {
    const loader = noGraphLoader();
    const result = await complete(loader, {
      ref: nodeRef,
      argument: { name: 'nodeId', value: 'file' },
    });
    expect(result.completion).toEqual({ values: [], total: 0, hasMore: false });
  });

  it('returns an empty completion for a graph with no nodes', async () => {
    const { loader } = await withGraph({
      ...makeGraph(),
      nodes: [],
      edges: [],
    });
    const result = await completeNodeIds(loader, 'anything');
    expect(result.completion.values).toEqual([]);
    expect(result.completion.total).toBe(0);
  });

  it('returns an empty completion for a non-resource ref', async () => {
    const { loader } = await withGraph();
    const result = await complete(loader, {
      ref: { type: 'ref/prompt', name: 'whatever' },
      argument: { name: 'nodeId', value: 'file' },
    });
    expect(result.completion.values).toEqual([]);
  });

  it('returns an empty completion for an unknown template uri', async () => {
    const { loader } = await withGraph();
    const result = await complete(loader, {
      ref: { type: 'ref/resource', uri: 'sprang://nope/{x}' },
      argument: { name: 'x', value: 'f' },
    });
    expect(result.completion.values).toEqual([]);
  });

  it('returns an empty completion for the wrong argument name', async () => {
    const { loader } = await withGraph();
    const result = await complete(loader, {
      ref: nodeRef,
      argument: { name: 'notTheArgument', value: 'file' },
    });
    expect(result.completion.values).toEqual([]);
  });

  it('completes the why template over the same node ids', async () => {
    const { loader } = await withGraph();
    const result = await complete(loader, {
      ref: { type: 'ref/resource', uri: 'sprang://why/{nodeId}' },
      argument: { name: 'nodeId', value: 'file:src/auth' },
    });
    expect(result.completion.values).toContain('file:src/auth.ts');
  });

  it('completes {path} with bare file paths, not file: ids', async () => {
    const { loader } = await withGraph();
    const result = await complete(loader, {
      ref: { type: 'ref/resource', uri: 'sprang://file/{path}' },
      argument: { name: 'path', value: 'src/' },
    });
    expect(result.completion.values).toContain('src/auth.ts');
    expect(result.completion.values.some((v) => v.startsWith('file:'))).toBe(false);
  });

  it('returns an empty {path} completion with no graph', async () => {
    const loader = noGraphLoader();
    const result = await complete(loader, {
      ref: { type: 'ref/resource', uri: 'sprang://file/{path}' },
      argument: { name: 'path', value: 'src' },
    });
    expect(result.completion.values).toEqual([]);
  });

  it('never returns duplicate values', async () => {
    const { loader } = await withGraph();
    const result = await complete(loader, {
      ref: nodeRef,
      argument: { name: 'nodeId', value: 'src' },
    });
    expect(new Set(result.completion.values).size).toBe(result.completion.values.length);
  });
});
