import { describe, it, expect } from 'vitest';
import { selectContext, tokenizeIdentifier } from '../../src/context/select.js';
import type { KnowledgeGraph } from '../../src/schema/types.js';

function graph(partial: {
  nodes?: unknown[];
  edges?: unknown[];
}): KnowledgeGraph {
  return {
    version: '1.0.0',
    generated_at: new Date().toISOString(),
    project_root: '/t',
    project_name: 't',
    phase: 'complete',
    nodes: partial.nodes ?? [],
    edges: partial.edges ?? [],
    layers: [],
    tours: [],
    domains: [],
    stats: {
      node_count: (partial.nodes ?? []).length,
      edge_count: (partial.edges ?? []).length,
      generated_at: new Date().toISOString(),
      risk_summary: { high: 0, medium: 0, low: 0 },
      smell_summary: {},
    },
  } as unknown as KnowledgeGraph;
}

const file = (path: string, extra: Record<string, unknown> = {}) => ({
  id: `file:${path}`,
  type: 'file',
  label: path.split('/').pop(),
  location: { file: path },
  metadata: { sizeLines: 100, fileCategory: 'source' },
  ...extra,
});

const fn = (path: string, name: string, extra: Record<string, unknown> = {}) => ({
  id: `function:${path}:${name}`,
  type: 'function',
  label: name,
  name,
  location: { file: path },
  metadata: { loc: 10 },
  ...extra,
});

describe('tokenizeIdentifier', () => {
  it('splits camelCase, snake_case and kebab-case, keeping the whole token', () => {
    expect(tokenizeIdentifier('parseConfigFile')).toEqual(
      expect.arrayContaining(['parseconfigfile', 'parse', 'config', 'file']),
    );
    expect(tokenizeIdentifier('snake_case_name')).toEqual(
      expect.arrayContaining(['snake_case_name', 'snake', 'case', 'name']),
    );
  });

  it('drops single characters, which match everything and mean nothing', () => {
    expect(tokenizeIdentifier('aXb')).not.toContain('a');
  });
});

describe('selectContext', () => {
  it('explains itself rather than returning an empty list on an empty graph', () => {
    const res = selectContext(graph({}), { task: 'anything' });
    expect(res.items).toEqual([]);
    expect(res.explanation).toMatch(/sprang scan/);
  });

  it('says so when nothing matched, instead of returning noise', () => {
    const res = selectContext(graph({ nodes: [file('src/a.ts')] }), {
      task: 'zzzz totally unrelated qqqq',
    });
    expect(res.items).toEqual([]);
    expect(res.explanation).toMatch(/Nothing in the graph matched/);
  });

  it('finds a symbol by exact name', () => {
    const res = selectContext(
      graph({ nodes: [file('src/auth.ts'), fn('src/auth.ts', 'validateToken')] }),
      { task: 'fix validateToken' },
    );
    expect(res.items.some((i) => i.nodeId.endsWith('validateToken'))).toBe(true);
  });

  it('respects the token budget', () => {
    const nodes = Array.from({ length: 50 }, (_, i) => file(`src/config${i}.ts`));
    const res = selectContext(graph({ nodes }), { task: 'config', budgetTokens: 3000 });
    expect(res.usedTokens).toBeLessThanOrEqual(3000);
    expect(res.omitted).toBeGreaterThan(0);
  });

  it('reports how many candidates did not fit', () => {
    const nodes = Array.from({ length: 30 }, (_, i) => file(`src/config${i}.ts`));
    const res = selectContext(graph({ nodes }), { task: 'config', budgetTokens: 1000 });
    expect(res.items.length + res.omitted).toBeGreaterThanOrEqual(30);
  });

  it('never exceeds the item limit', () => {
    const nodes = Array.from({ length: 60 }, (_, i) => file(`src/config${i}.ts`));
    const res = selectContext(graph({ nodes }), { task: 'config', budgetTokens: 10_000_000, limit: 5 });
    expect(res.items).toHaveLength(5);
  });

  it('records which channels found each item, so the choice is explainable', () => {
    const res = selectContext(
      graph({ nodes: [file('src/auth.ts'), fn('src/auth.ts', 'validateToken')] }),
      { task: 'validateToken' },
    );
    expect(res.items[0]!.channels.length).toBeGreaterThan(0);
  });

  it('reaches neighbours of a seed file through the graph', () => {
    const res = selectContext(
      graph({
        nodes: [file('src/a.ts'), file('src/b.ts')],
        edges: [{ source: 'file:src/b.ts', target: 'file:src/a.ts', type: 'imports' }],
      }),
      { task: 'unrelated words', seedFiles: ['src/a.ts'] },
    );
    // b.ts shares no vocabulary with the task; only the graph can surface it.
    expect(res.items.some((i) => i.path === 'src/b.ts')).toBe(true);
  });

  it('records hop distance for graph-reached items', () => {
    const res = selectContext(
      graph({
        nodes: [file('a.ts'), file('b.ts')],
        edges: [{ source: 'file:b.ts', target: 'file:a.ts', type: 'imports' }],
      }),
      { task: 'x', seedFiles: ['a.ts'] },
    );
    const b = res.items.find((i) => i.path === 'b.ts');
    expect(b?.hopsFromSeed).toBe(1);
  });

  it('ignores contains edges when walking, or every file drags in its symbols', () => {
    const res = selectContext(
      graph({
        nodes: [file('a.ts'), fn('a.ts', 'helper')],
        edges: [{ source: 'file:a.ts', target: 'function:a.ts:helper', type: 'contains' }],
      }),
      { task: 'zzz', seedFiles: ['a.ts'] },
    );
    const helper = res.items.find((i) => i.nodeId.endsWith('helper'));
    expect(helper?.hopsFromSeed).toBeUndefined();
  });

  it('surfaces behavioural hotspots near the seeds', () => {
    const res = selectContext(
      graph({
        nodes: [
          file('a.ts'),
          file('hot.ts', { metadata: { sizeLines: 50, fileCategory: 'source', behavioral: { hotspot_score: 0.9 } } }),
        ],
      }),
      { task: 'zzz', seedFiles: ['a.ts'] },
    );
    expect(res.items.some((i) => i.path === 'hot.ts')).toBe(true);
  });

  it('is deterministic for the same input', () => {
    const g = graph({ nodes: [file('src/auth.ts'), file('src/authz.ts'), fn('src/auth.ts', 'auth')] });
    const a = selectContext(g, { task: 'auth' });
    const b = selectContext(g, { task: 'auth' });
    expect(a.items.map((i) => i.nodeId)).toEqual(b.items.map((i) => i.nodeId));
    expect(a.items.map((i) => i.score)).toEqual(b.items.map((i) => i.score));
  });

  it('carries risk through so the caller can warn without a second lookup', () => {
    const res = selectContext(
      graph({ nodes: [file('src/auth.ts', { risk_score: 0.83 })] }),
      { task: 'auth' },
    );
    expect(res.items[0]!.riskScore).toBe(0.83);
  });

  it('handles a budget smaller than any single item without crashing', () => {
    const res = selectContext(graph({ nodes: [file('src/auth.ts')] }), {
      task: 'auth',
      budgetTokens: 1,
    });
    expect(res.items).toEqual([]);
    expect(res.usedTokens).toBe(0);
  });

  it('scales to a large graph quickly', () => {
    const nodes = Array.from({ length: 4000 }, (_, i) => file(`src/mod${i}/widget.ts`));
    const edges = Array.from({ length: 4000 }, (_, i) => ({
      source: `file:src/mod${i}/widget.ts`,
      target: `file:src/mod${(i + 1) % 4000}/widget.ts`,
      type: 'imports',
    }));
    const start = Date.now();
    // Not a stopword — "thing" is deliberately filtered as noise.
    const res = selectContext(graph({ nodes, edges }), { task: 'widget', budgetTokens: 8000 });
    expect(Date.now() - start).toBeLessThan(3000);
    expect(res.items.length).toBeGreaterThan(0);
  });
});

describe('query quality', () => {
  it('ignores generic verbs so they do not dominate the ranking', () => {
    // "add a new tool" must not match every `add` function in the repo.
    const nodes = [
      file('src/unrelated/math.ts'),
      fn('src/unrelated/math.ts', 'add'),
      file('src/coupling/detector.ts'),
    ];
    const res = selectContext(graph({ nodes }), { task: 'add a new coupling detector' });
    const top = res.items[0]!;
    expect(top.path).toContain('coupling');
  });

  it('demotes an identifier defined in many files as generic noise', () => {
    const nodes: unknown[] = [];
    for (let i = 0; i < 6; i++) {
      nodes.push(file(`src/mod${i}/thing.ts`), fn(`src/mod${i}/thing.ts`, 'parse'));
    }
    nodes.push(file('src/special/parseUniqueThing.ts'));
    const res = selectContext(graph({ nodes }), { task: 'parse' });
    // `parse` is defined in six files, so exact-symbol should not fire for it.
    expect(res.items.every((i) => !i.channels.includes('exact-symbol'))).toBe(true);
  });

  it('keeps an explicitly mentioned identifier even if it is a stopword', () => {
    const res = selectContext(
      graph({ nodes: [file('src/a.ts'), fn('src/a.ts', 'get')] }),
      { task: 'something', mentionedIdents: ['get'] },
    );
    expect(res.items.some((i) => i.nodeId.endsWith('get'))).toBe(true);
  });

  it('weights a match in the path above one in a summary', () => {
    const res = selectContext(
      graph({
        nodes: [
          file('packages/mcp/src/tools/coupling.ts'),
          file('src/other.ts', { summary: 'mentions coupling in passing' }),
        ],
      }),
      { task: 'coupling' },
    );
    expect(res.items[0]!.path).toContain('coupling.ts');
  });
});
