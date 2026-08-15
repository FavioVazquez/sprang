import { describe, it, expect } from 'vitest';
import type { KnowledgeGraph, SprangEdge, SprangNode } from '../../src/schema/types.js';
import { detectCommunities, modularity } from '../../src/graph/communities.js';

type Graph = Pick<KnowledgeGraph, 'nodes' | 'edges'>;

const file = (path: string): SprangNode => ({
  id: `file:${path}`,
  type: 'file',
  name: path,
  label: path,
  filePath: path,
});

const fn = (path: string, name: string): SprangNode => ({
  id: `function:${path}:${name}`,
  type: 'function',
  name,
  label: name,
  location: { file: path },
});

const imports = (from: string, to: string, weight?: number): SprangEdge => ({
  source: from.startsWith('file:') || from.includes(':') ? from : `file:${from}`,
  target: to.startsWith('file:') || to.includes(':') ? to : `file:${to}`,
  type: 'imports',
  ...(weight !== undefined ? { weight } : {}),
});

const imp = (from: string, to: string, weight?: number): SprangEdge =>
  imports(`file:${from}`, `file:${to}`, weight);

const graph = (nodes: SprangNode[], edges: SprangEdge[]): Graph => ({ nodes, edges });

/** Two dense clusters joined by a single bridge edge. */
function twoClusterGraph(): Graph {
  const paths = ['src/a/1.ts', 'src/a/2.ts', 'src/a/3.ts', 'src/b/1.ts', 'src/b/2.ts', 'src/b/3.ts'];
  const nodes = paths.map(file);
  const edges = [
    imp('src/a/1.ts', 'src/a/2.ts'),
    imp('src/a/2.ts', 'src/a/3.ts'),
    imp('src/a/3.ts', 'src/a/1.ts'),
    imp('src/b/1.ts', 'src/b/2.ts'),
    imp('src/b/2.ts', 'src/b/3.ts'),
    imp('src/b/3.ts', 'src/b/1.ts'),
    imp('src/a/1.ts', 'src/b/1.ts'),
  ];
  return graph(nodes, edges);
}

describe('detectCommunities — guards', () => {
  it('returns [] for an empty graph', () => {
    expect(detectCommunities(graph([], []))).toEqual([]);
  });

  it('returns [] when the graph has no file nodes', () => {
    expect(detectCommunities(graph([fn('src/a.ts', 'go')], []))).toEqual([]);
  });

  it('returns one singleton community for a single node', () => {
    const result = detectCommunities(graph([file('src/a.ts')], []));
    expect(result).toHaveLength(1);
    expect(result[0]?.nodeIds).toEqual(['file:src/a.ts']);
    expect(result[0]?.id).toBe('community-0');
    expect(result[0]?.internalEdges).toBe(0);
    expect(result[0]?.externalEdges).toBe(0);
  });

  it('puts every node in its own community when there are no edges', () => {
    const nodes = ['src/a.ts', 'src/b.ts', 'src/c.ts'].map(file);
    const result = detectCommunities(graph(nodes, []));
    expect(result).toHaveLength(3);
    for (const community of result) expect(community.nodeIds).toHaveLength(1);
  });

  it('ignores non-import edges entirely', () => {
    const nodes = ['src/a.ts', 'src/b.ts'].map(file);
    const edges: SprangEdge[] = [{ source: 'file:src/a.ts', target: 'file:src/b.ts', type: 'calls' }];
    const result = detectCommunities(graph(nodes, edges));
    expect(result).toHaveLength(2);
  });

  it('tolerates self-loops without crashing or losing the node', () => {
    const nodes = ['src/a.ts', 'src/b.ts'].map(file);
    const edges = [imp('src/a.ts', 'src/a.ts'), imp('src/a.ts', 'src/b.ts')];
    const result = detectCommunities(graph(nodes, edges));
    const all = result.flatMap((c) => c.nodeIds).sort();
    expect(all).toEqual(['file:src/a.ts', 'file:src/b.ts']);
  });

  it('drops edges whose endpoints are unknown nodes', () => {
    const nodes = [file('src/a.ts')];
    const edges = [imp('src/a.ts', 'src/ghost.ts')];
    const result = detectCommunities(graph(nodes, edges));
    expect(result).toHaveLength(1);
    expect(result[0]?.externalEdges).toBe(0);
  });

  it('keeps disconnected parts of the graph in separate communities', () => {
    const nodes = ['src/a/1.ts', 'src/a/2.ts', 'src/b/1.ts', 'src/b/2.ts'].map(file);
    const edges = [imp('src/a/1.ts', 'src/a/2.ts'), imp('src/b/1.ts', 'src/b/2.ts')];
    const result = detectCommunities(graph(nodes, edges));
    expect(result).toHaveLength(2);
    for (const community of result) expect(community.nodeIds).toHaveLength(2);
  });

  it('partitions: every file node appears exactly once', () => {
    const result = detectCommunities(twoClusterGraph());
    const all = result.flatMap((c) => c.nodeIds);
    expect(new Set(all).size).toBe(all.length);
    expect(all).toHaveLength(6);
  });
});

describe('detectCommunities — clustering', () => {
  it('separates two clear clusters', () => {
    const result = detectCommunities(twoClusterGraph());
    expect(result).toHaveLength(2);
    const sets = result.map((c) => c.nodeIds.slice().sort());
    expect(sets).toContainEqual(['file:src/a/1.ts', 'file:src/a/2.ts', 'file:src/a/3.ts']);
    expect(sets).toContainEqual(['file:src/b/1.ts', 'file:src/b/2.ts', 'file:src/b/3.ts']);
  });

  it('counts internal and external edges for each cluster', () => {
    const result = detectCommunities(twoClusterGraph());
    for (const community of result) {
      expect(community.internalEdges).toBe(3);
      expect(community.externalEdges).toBe(1);
    }
  });

  it('lifts symbol-level import edges to their containing file', () => {
    const nodes = [
      file('src/a/1.ts'), file('src/a/2.ts'), file('src/b/1.ts'), file('src/b/2.ts'),
      fn('src/a/1.ts', 'go'), fn('src/b/1.ts', 'stop'),
    ];
    const edges = [
      { source: 'function:src/a/1.ts:go', target: 'file:src/a/2.ts', type: 'imports' as const },
      { source: 'function:src/b/1.ts:stop', target: 'file:src/b/2.ts', type: 'imports' as const },
    ];
    const result = detectCommunities(graph(nodes, edges));
    const sets = result.map((c) => c.nodeIds.slice().sort());
    expect(sets).toContainEqual(['file:src/a/1.ts', 'file:src/a/2.ts']);
    expect(sets).toContainEqual(['file:src/b/1.ts', 'file:src/b/2.ts']);
  });

  it('treats imports as undirected (direction does not change the partition)', () => {
    const forward = detectCommunities(twoClusterGraph());
    const g = twoClusterGraph();
    const reversed = graph(g.nodes, g.edges.map((e) => ({ ...e, source: e.target, target: e.source })));
    expect(detectCommunities(reversed).map((c) => c.nodeIds)).toEqual(forward.map((c) => c.nodeIds));
  });

  it('sums parallel/weighted edges rather than double counting nodes', () => {
    const nodes = ['src/a.ts', 'src/b.ts', 'src/c.ts'].map(file);
    const edges = [imp('src/a.ts', 'src/b.ts', 5), imp('src/b.ts', 'src/a.ts', 5), imp('src/b.ts', 'src/c.ts')];
    const result = detectCommunities(graph(nodes, edges));
    const withAB = result.find((c) => c.nodeIds.includes('file:src/a.ts'));
    expect(withAB?.nodeIds).toContain('file:src/b.ts');
  });

  it('a higher resolution never produces fewer communities', () => {
    const g = twoClusterGraph();
    const coarse = detectCommunities(g, { resolution: 0.5 });
    const fine = detectCommunities(g, { resolution: 2 });
    expect(fine.length).toBeGreaterThanOrEqual(coarse.length);
  });

  it('respects maxPasses = 1 without crashing', () => {
    const result = detectCommunities(twoClusterGraph(), { maxPasses: 1 });
    expect(result.flatMap((c) => c.nodeIds)).toHaveLength(6);
  });

  it('accepts a seed option and stays identical with or without it', () => {
    const a = detectCommunities(twoClusterGraph(), { seed: 42 });
    const b = detectCommunities(twoClusterGraph());
    expect(a).toEqual(b);
  });

  it('orders communities largest first', () => {
    const nodes = ['src/a/1.ts', 'src/a/2.ts', 'src/a/3.ts', 'src/b/1.ts', 'src/b/2.ts', 'z/lonely.ts'].map(file);
    const edges = [
      imp('src/a/1.ts', 'src/a/2.ts'), imp('src/a/2.ts', 'src/a/3.ts'), imp('src/a/3.ts', 'src/a/1.ts'),
      imp('src/b/1.ts', 'src/b/2.ts'),
    ];
    const result = detectCommunities(graph(nodes, edges));
    expect(result.map((c) => c.nodeIds.length)).toEqual([3, 2, 1]);
    expect(result.map((c) => c.id)).toEqual(['community-0', 'community-1', 'community-2']);
  });
});

describe('detectCommunities — connectivity split (post-Louvain)', () => {
  it('splits an internally disconnected community reported as one group', () => {
    // Force the pathology by hand: ask modularity/split behaviour through a
    // graph whose only cluster is two components joined by nothing.
    const nodes = ['m/a.ts', 'm/b.ts', 'm/c.ts', 'm/d.ts'].map(file);
    const edges = [imp('m/a.ts', 'm/b.ts'), imp('m/c.ts', 'm/d.ts')];
    const result = detectCommunities(graph(nodes, edges));
    expect(result).toHaveLength(2);
    for (const community of result) {
      // each returned community must be internally connected
      expect(community.internalEdges).toBeGreaterThan(0);
    }
  });

  it('every returned community is internally connected on a larger graph', () => {
    const paths = [
      'src/a/1.ts', 'src/a/2.ts', 'src/a/3.ts', 'src/a/4.ts',
      'src/b/1.ts', 'src/b/2.ts', 'src/b/3.ts',
      'src/c/1.ts', 'src/c/2.ts',
    ];
    const nodes = paths.map(file);
    const edges = [
      imp('src/a/1.ts', 'src/a/2.ts'), imp('src/a/2.ts', 'src/a/3.ts'), imp('src/a/3.ts', 'src/a/4.ts'),
      imp('src/a/4.ts', 'src/a/1.ts'), imp('src/a/1.ts', 'src/a/3.ts'),
      imp('src/b/1.ts', 'src/b/2.ts'), imp('src/b/2.ts', 'src/b/3.ts'), imp('src/b/3.ts', 'src/b/1.ts'),
      imp('src/c/1.ts', 'src/c/2.ts'),
      imp('src/a/1.ts', 'src/b/1.ts'), imp('src/b/1.ts', 'src/c/1.ts'),
    ];
    const g = graph(nodes, edges);
    const result = detectCommunities(g);
    const index = new Map(nodes.map((n, i) => [n.id, i] as const));
    const adjacency = new Map<string, Set<string>>();
    for (const n of nodes) adjacency.set(n.id, new Set());
    for (const e of edges) {
      adjacency.get(e.source)?.add(e.target);
      adjacency.get(e.target)?.add(e.source);
    }
    for (const community of result) {
      const members = new Set(community.nodeIds);
      const start = community.nodeIds[0];
      expect(start).toBeDefined();
      const seen = new Set<string>([start ?? '']);
      const queue = [start ?? ''];
      while (queue.length > 0) {
        const cur = queue.shift() ?? '';
        for (const next of adjacency.get(cur) ?? []) {
          if (members.has(next) && !seen.has(next)) { seen.add(next); queue.push(next); }
        }
      }
      expect(seen.size).toBe(members.size);
    }
    expect(index.size).toBe(9);
  });
});

describe('detectCommunities — labels', () => {
  it('uses the longest common directory prefix', () => {
    const nodes = ['src/graph/a.ts', 'src/graph/b.ts'].map(file);
    const result = detectCommunities(graph(nodes, [imp('src/graph/a.ts', 'src/graph/b.ts')]));
    expect(result[0]?.label).toBe('src/graph');
  });

  it('falls back to the most common top-level directory', () => {
    const nodes = ['src/a/1.ts', 'src/b/1.ts'].map(file);
    const result = detectCommunities(graph(nodes, [imp('src/a/1.ts', 'src/b/1.ts')]));
    expect(result[0]?.label).toBe('src');
  });

  it('picks the modal top-level directory when prefixes disagree', () => {
    const nodes = ['src/a/1.ts', 'src/b/1.ts', 'lib/c.ts'].map(file);
    const result = detectCommunities(graph(nodes, [
      imp('src/a/1.ts', 'src/b/1.ts'),
      imp('src/b/1.ts', 'lib/c.ts'),
    ]));
    expect(result[0]?.label).toBe('src/*');
  });

  it('falls back to community-N for root-level files with no directory', () => {
    const nodes = ['a.ts', 'b.ts'].map(file);
    const result = detectCommunities(graph(nodes, [imp('a.ts', 'b.ts')]));
    expect(result[0]?.label).toBe('community-0');
  });

  it('labels a single-file community with its directory', () => {
    const result = detectCommunities(graph([file('src/util/x.ts')], []));
    expect(result[0]?.label).toBe('src/util');
  });
});

describe('modularity', () => {
  it('matches a hand-computed value: two disjoint edges, Q = 0.5', () => {
    // A: a-b, c-d. m = 2, 2m = 4, every k_i = 1.
    // internal sum(A_ij) over same-community pairs = 4; sum over communities of
    // (sum k)^2 = 2^2 + 2^2 = 8.  Q = 4/4 - 8/16 = 0.5
    const nodes = ['a.ts', 'b.ts', 'c.ts', 'd.ts'].map(file);
    const edges = [imp('a.ts', 'b.ts'), imp('c.ts', 'd.ts')];
    const g = graph(nodes, edges);
    const communities = detectCommunities(g);
    expect(modularity(g, communities)).toBeCloseTo(0.5, 10);
  });

  it('is 0 for the all-in-one-community partition', () => {
    const nodes = ['a.ts', 'b.ts', 'c.ts', 'd.ts'].map(file);
    const edges = [imp('a.ts', 'b.ts'), imp('c.ts', 'd.ts')];
    const g = graph(nodes, edges);
    const single = [{
      id: 'community-0',
      nodeIds: nodes.map((n) => n.id),
      label: 'all',
      internalEdges: 2,
      externalEdges: 0,
    }];
    expect(modularity(g, single)).toBeCloseTo(0, 10);
  });

  it('is negative for the fully-split singleton partition of a connected graph', () => {
    const nodes = ['a.ts', 'b.ts'].map(file);
    const g = graph(nodes, [imp('a.ts', 'b.ts')]);
    const singletons = nodes.map((n, i) => ({
      id: `community-${i}`,
      nodeIds: [n.id],
      label: n.id,
      internalEdges: 0,
      externalEdges: 1,
    }));
    expect(modularity(g, singletons)).toBeLessThan(0);
  });

  it('is 0 when the graph has no edges', () => {
    const nodes = ['a.ts', 'b.ts'].map(file);
    expect(modularity(graph(nodes, []), detectCommunities(graph(nodes, [])))).toBe(0);
  });

  it('is 0 for an empty graph', () => {
    expect(modularity(graph([], []), [])).toBe(0);
  });

  it('treats unlisted nodes as singletons rather than throwing', () => {
    const nodes = ['a.ts', 'b.ts', 'c.ts', 'd.ts'].map(file);
    const g = graph(nodes, [imp('a.ts', 'b.ts'), imp('c.ts', 'd.ts')]);
    const partial = [{
      id: 'community-0',
      nodeIds: ['file:a.ts', 'file:b.ts'],
      label: 'x',
      internalEdges: 1,
      externalEdges: 0,
    }];
    // c and d become singletons: Q = 2/4 - (2^2 + 1^2 + 1^2)/16 = 0.125
    expect(modularity(g, partial)).toBeCloseTo(0.125, 10);
  });

  it('ignores node ids that are not in the graph', () => {
    const nodes = ['a.ts', 'b.ts'].map(file);
    const g = graph(nodes, [imp('a.ts', 'b.ts')]);
    const communities = [{
      id: 'community-0',
      nodeIds: ['file:a.ts', 'file:b.ts', 'file:ghost.ts'],
      label: 'x',
      internalEdges: 1,
      externalEdges: 0,
    }];
    expect(modularity(g, communities)).toBeCloseTo(0, 10);
  });

  it('honours the resolution parameter', () => {
    const g = twoClusterGraph();
    const communities = detectCommunities(g);
    const q1 = modularity(g, communities, 1);
    const q2 = modularity(g, communities, 2);
    expect(q2).toBeLessThan(q1);
  });

  it('the Louvain partition beats the all-in-one partition', () => {
    const g = twoClusterGraph();
    const found = modularity(g, detectCommunities(g));
    const lumped = modularity(g, [{
      id: 'community-0',
      nodeIds: g.nodes.map((n) => n.id),
      label: 'all',
      internalEdges: 7,
      externalEdges: 0,
    }]);
    expect(found).toBeGreaterThan(lumped);
  });
});

describe('detectCommunities — determinism', () => {
  it('produces identical output across two runs', () => {
    const a = detectCommunities(twoClusterGraph());
    const b = detectCommunities(twoClusterGraph());
    expect(a).toEqual(b);
  });

  it('is invariant to the input order of nodes and edges', () => {
    const g = twoClusterGraph();
    const shuffled = graph(g.nodes.slice().reverse(), g.edges.slice().reverse());
    const a = detectCommunities(g).map((c) => c.nodeIds);
    const b = detectCommunities(shuffled).map((c) => c.nodeIds);
    expect(b).toEqual(a);
  });

  it('is stable over ten repeated runs on a larger graph', () => {
    const paths = Array.from({ length: 24 }, (_, i) => `src/m${Math.floor(i / 4)}/f${i}.ts`);
    const nodes = paths.map(file);
    const edges: SprangEdge[] = [];
    for (let i = 0; i < paths.length; i++) {
      for (let j = i + 1; j < paths.length; j++) {
        const a = paths[i];
        const b = paths[j];
        if (a === undefined || b === undefined) continue;
        if (Math.floor(i / 4) === Math.floor(j / 4)) edges.push(imp(a, b));
        else if (i % 7 === 0 && j % 5 === 0) edges.push(imp(a, b));
      }
    }
    const g = graph(nodes, edges);
    const first = JSON.stringify(detectCommunities(g));
    for (let run = 0; run < 10; run++) {
      expect(JSON.stringify(detectCommunities(g))).toBe(first);
    }
  });

  it('does not mutate the input graph', () => {
    const g = twoClusterGraph();
    const snapshot = JSON.stringify(g);
    detectCommunities(g);
    modularity(g, detectCommunities(g));
    expect(JSON.stringify(g)).toBe(snapshot);
  });
});
