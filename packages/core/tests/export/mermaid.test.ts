import { describe, expect, it } from 'vitest';
import type { KnowledgeGraph, SprangEdge, SprangNode } from '../../src/schema/types.js';
import {
  createMermaidIdFactory,
  escapeMermaidLabel,
  mermaidSafeId,
  nodeFilePath,
  toMermaidArchitecture,
  toMermaidC4Context,
  toMermaidSequence,
} from '../../src/export/mermaid.js';

// ─── fixtures ────────────────────────────────────────────────────────

function fileNode(path: string, over: Partial<SprangNode> = {}): SprangNode {
  return {
    id: `file:${path}`,
    type: 'file',
    label: path,
    location: { file: path },
    ...over,
  };
}

function fnNode(path: string, name: string, over: Partial<SprangNode> = {}): SprangNode {
  return {
    id: `function:${path}:${name}`,
    type: 'function',
    label: name,
    location: { file: path },
    ...over,
  };
}

function edge(source: string, target: string, type: SprangEdge['type']): SprangEdge {
  return { source, target, type };
}

function graphOf(nodes: SprangNode[], edges: SprangEdge[], over: Partial<KnowledgeGraph> = {}): KnowledgeGraph {
  return {
    version: '1.0.0',
    generated_at: '2026-01-01T00:00:00.000Z',
    project_root: '/repo',
    project_name: 'demo',
    phase: 'complete',
    nodes,
    edges,
    layers: [],
    tours: [],
    domains: [],
    stats: {
      node_count: nodes.length,
      edge_count: edges.length,
      risk_summary: { high: 0, medium: 0, low: 0 },
      smell_summary: {},
      generated_at: '2026-01-01T00:00:00.000Z',
    },
    ...over,
  };
}

const emptyGraph = graphOf([], []);

/** Two layers, four files, symbols and cross-layer edges. */
function sampleGraph(): KnowledgeGraph {
  const nodes: SprangNode[] = [
    fileNode('src/ui/page.tsx', { layer: 'ui', risk_score: 0.2 }),
    fileNode('src/ui/button.tsx', { layer: 'ui', risk_score: 0.1 }),
    fileNode('src/data/repo.ts', { layer: 'data', risk_score: 0.9 }),
    fileNode('src/data/db.ts', { layer: 'data', risk_score: 0.8 }),
    fnNode('src/ui/page.tsx', 'render'),
    fnNode('src/data/repo.ts', 'load'),
    fnNode('src/data/db.ts', 'query'),
  ];
  const edges: SprangEdge[] = [
    edge('file:src/ui/page.tsx', 'function:src/ui/page.tsx:render', 'contains'),
    edge('file:src/data/repo.ts', 'function:src/data/repo.ts:load', 'contains'),
    edge('file:src/data/db.ts', 'function:src/data/db.ts:query', 'contains'),
    edge('file:src/ui/page.tsx', 'file:src/data/repo.ts', 'imports'),
    edge('file:src/ui/button.tsx', 'file:src/data/repo.ts', 'imports'),
    edge('function:src/ui/page.tsx:render', 'function:src/data/repo.ts:load', 'calls'),
    edge('function:src/data/repo.ts:load', 'function:src/data/db.ts:query', 'calls'),
  ];
  return graphOf(nodes, edges, {
    layers: [
      { id: 'ui', name: 'UI', description: 'Presentation', node_ids: ['file:src/ui/page.tsx', 'file:src/ui/button.tsx'] },
      { id: 'data', name: 'Data', description: 'Persistence', node_ids: ['file:src/data/repo.ts', 'file:src/data/db.ts'] },
    ],
  });
}

const DANGEROUS = ['(', ')', '[', ']', '{', '}', '"', '<', '>', '#', ';', '|', '\\', '`', "'"] as const;

// ─── mermaidSafeId ───────────────────────────────────────────────────

describe('mermaidSafeId', () => {
  it('replaces dots, slashes and dashes', () => {
    expect(mermaidSafeId('src/foo-bar.baz.ts')).toBe('src_foo_bar_baz_ts');
  });

  it('never emits a character outside [A-Za-z0-9_]', () => {
    const inputs = [
      'file:packages/core/src/a-b.ts',
      'weird name (copy).ts',
      'ünïcødé/пример.ts',
      'a\nb\tc',
      '###',
      '../../escape.ts',
    ];
    for (const input of inputs) {
      expect(mermaidSafeId(input)).toMatch(/^[A-Za-z0-9_]+$/);
    }
  });

  it('does not start with a digit', () => {
    expect(mermaidSafeId('123abc')).toBe('n_123abc');
    expect(mermaidSafeId('0')).toBe('n_0');
    expect(mermaidSafeId('9-lives.ts')).toMatch(/^[A-Za-z_]/);
  });

  it('handles an empty string without producing an empty id', () => {
    const id = mermaidSafeId('');
    expect(id.length).toBeGreaterThan(0);
    expect(id).toMatch(/^n_[0-9a-f]{6}$/);
  });

  it('handles a string made only of separators', () => {
    expect(mermaidSafeId('///')).toMatch(/^n_[0-9a-f]{6}$/);
  });

  it('is stable across calls', () => {
    expect(mermaidSafeId('a/b/c.ts')).toBe(mermaidSafeId('a/b/c.ts'));
  });

  it('trims leading and trailing underscores introduced by sanitising', () => {
    expect(mermaidSafeId('/leading/and/trailing/')).toBe('leading_and_trailing');
  });
});

// ─── id factory / collisions ─────────────────────────────────────────

describe('createMermaidIdFactory', () => {
  it('returns the same id for the same raw string', () => {
    const next = createMermaidIdFactory();
    expect(next('a/b.ts')).toBe(next('a/b.ts'));
  });

  it('does not collapse two distinct raw ids onto one id', () => {
    const next = createMermaidIdFactory();
    const first = next('a/b');
    const second = next('a-b');
    const third = next('a.b');
    expect(new Set([first, second, third]).size).toBe(3);
  });

  it('suffixes with a hash rather than silently overwriting', () => {
    const next = createMermaidIdFactory();
    expect(next('a/b')).toBe('a_b');
    expect(next('a-b')).toMatch(/^a_b_[0-9a-f]{6}$/);
  });

  it('keeps every allocated id syntactically valid', () => {
    const next = createMermaidIdFactory();
    for (const raw of ['1.ts', '2.ts', 'x/y', 'x-y', '', '  ', '###']) {
      expect(next(raw)).toMatch(/^[A-Za-z_][A-Za-z0-9_]*$/);
    }
  });

  it('is deterministic across factory instances', () => {
    const run = (): string[] => {
      const next = createMermaidIdFactory();
      return ['a/b', 'a-b', 'a.b'].map(next);
    };
    expect(run()).toEqual(run());
  });
});

// ─── escapeMermaidLabel ──────────────────────────────────────────────

describe('escapeMermaidLabel', () => {
  it('escapes every dangerous character', () => {
    for (const ch of DANGEROUS) {
      const out = escapeMermaidLabel(`a${ch}b`);
      expect(out.includes(ch)).toBe(ch === '#' || ch === ';');
      expect(out).not.toBe(`a${ch}b`);
    }
  });

  it('produces entity syntax for the classic breakers', () => {
    expect(escapeMermaidLabel('f(x)')).toBe('f#40;x#41;');
    expect(escapeMermaidLabel('a[b]')).toBe('a#91;b#93;');
    expect(escapeMermaidLabel('{a}')).toBe('#123;a#125;');
    expect(escapeMermaidLabel('a<b>c')).toBe('a#lt;b#gt;c');
    expect(escapeMermaidLabel('say "hi"')).toBe('say #quot;hi#quot;');
    expect(escapeMermaidLabel('a;b')).toBe('a#59;b');
    expect(escapeMermaidLabel('#tag')).toBe('#35;tag');
  });

  it('does not double-escape the entities it just produced', () => {
    // '#' -> '#35;' must not become '#35;35#59;'
    expect(escapeMermaidLabel('#')).toBe('#35;');
    expect(escapeMermaidLabel('(')).toBe('#40;');
  });

  it('collapses newlines, carriage returns and tabs into single spaces', () => {
    expect(escapeMermaidLabel('a\nb\r\nc\td')).toBe('a b c d');
    expect(escapeMermaidLabel('a\n\n\nb')).toBe('a b');
  });

  it('trims and never returns an empty label', () => {
    expect(escapeMermaidLabel('   ')).toBe('unnamed');
    expect(escapeMermaidLabel('')).toBe('unnamed');
    expect(escapeMermaidLabel('  x  ')).toBe('x');
  });

  it('survives a real-world path containing every dangerous character', () => {
    const raw = 'src/weird [dir]/a (copy)#1;{v}<x>"q"\\z`t`.ts';
    const out = escapeMermaidLabel(raw);
    for (const ch of ['(', ')', '[', ']', '{', '}', '"', '<', '>', '|', '\\', '`']) {
      expect(out).not.toContain(ch);
    }
  });

  it('keeps unicode and spaces intact', () => {
    expect(escapeMermaidLabel('café ünïcødé/пример.ts')).toBe('café ünïcødé/пример.ts');
  });
});

describe('nodeFilePath', () => {
  it('prefers filePath, then location.file, then the id without its type prefix', () => {
    expect(nodeFilePath({ id: 'x', type: 'file', label: 'x', filePath: 'a.ts' })).toBe('a.ts');
    expect(nodeFilePath(fileNode('b.ts'))).toBe('b.ts');
    expect(nodeFilePath({ id: 'file:c.ts', type: 'file', label: 'c' })).toBe('c.ts');
  });
});

// ─── toMermaidArchitecture ───────────────────────────────────────────

describe('toMermaidArchitecture', () => {
  it('handles an empty graph without throwing', () => {
    const out = toMermaidArchitecture(emptyGraph);
    expect(out.startsWith('graph TB')).toBe(true);
    expect(out).toContain('%% empty graph');
    expect(out).not.toContain('subgraph');
  });

  it('defaults to TB and honours LR', () => {
    expect(toMermaidArchitecture(sampleGraph()).split('\n')[0]).toBe('graph TB');
    expect(toMermaidArchitecture(sampleGraph(), { direction: 'LR' }).split('\n')[0]).toBe('graph LR');
  });

  it('emits one subgraph per layer with its display name', () => {
    const out = toMermaidArchitecture(sampleGraph());
    expect(out).toContain('subgraph sg_ui["UI"]');
    expect(out).toContain('subgraph sg_data["Data"]');
    expect(out.match(/^\s*subgraph /gm)?.length).toBe(2);
  });

  it('has balanced subgraph/end pairs', () => {
    for (const opts of [{}, { groupBy: 'directory' as const }, { groupBy: 'community' as const }, { includeRisk: true }]) {
      const out = toMermaidArchitecture(sampleGraph(), opts);
      const subgraphs = out.match(/^\s*subgraph\b/gm)?.length ?? 0;
      const ends = out.match(/^\s*end\s*$/gm)?.length ?? 0;
      expect(subgraphs).toBeGreaterThan(0);
      expect(ends).toBe(subgraphs);
    }
  });

  it('reports the member count inside each subgraph', () => {
    const out = toMermaidArchitecture(sampleGraph());
    expect(out).toContain('grp_ui["2 files"]');
    expect(out).toContain('grp_data["2 files"]');
  });

  it('aggregates cross-group edges and labels them with the count', () => {
    const out = toMermaidArchitecture(sampleGraph());
    // 2 imports + 1 call from ui into data
    expect(out).toContain('grp_ui -->|3| grp_data');
    expect(out).not.toContain('grp_ui -->|1| grp_data');
  });

  it('attributes contained symbols to their owning file group', () => {
    const out = toMermaidArchitecture(sampleGraph());
    // the data -> data internal call must not create a self arrow
    expect(out).not.toMatch(/grp_data -->\|\d+\| grp_data/);
  });

  it('never draws a group arrow to itself', () => {
    const out = toMermaidArchitecture(sampleGraph(), { groupBy: 'directory' });
    for (const line of out.split('\n')) {
      const match = /^ {2}(\S+) -->\|.*\| (\S+)$/.exec(line);
      if (match !== null) expect(match[1]).not.toBe(match[2]);
    }
  });

  it('caps at maxNodes and explains what was omitted and why', () => {
    const out = toMermaidArchitecture(sampleGraph(), { groupBy: 'directory', maxNodes: 1 });
    expect(out.match(/^\s*subgraph /gm)?.length).toBe(1);
    expect(out).toContain('%% 1 of 2 directory groups omitted');
    expect(out).toContain('maxNodes=1');
    expect(out).toContain('highest cross-group edge degree');
  });

  it('keeps the highest-degree group when capping', () => {
    const nodes = [
      fileNode('hub/a.ts', { layer: 'hub' }),
      fileNode('leaf/b.ts', { layer: 'leaf' }),
      fileNode('lonely/c.ts', { layer: 'lonely' }),
    ];
    const edges = [edge('file:hub/a.ts', 'file:leaf/b.ts', 'imports')];
    const graph = graphOf(nodes, edges, {
      layers: [
        { id: 'hub', name: 'Hub', node_ids: ['file:hub/a.ts'] },
        { id: 'leaf', name: 'Leaf', node_ids: ['file:leaf/b.ts'] },
        { id: 'lonely', name: 'Lonely', node_ids: ['file:lonely/c.ts'] },
      ],
    });
    const out = toMermaidArchitecture(graph, { maxNodes: 2 });
    expect(out).toContain('"Hub"');
    expect(out).toContain('"Leaf"');
    expect(out).not.toContain('"Lonely"');
  });

  it('emits no omission comment when nothing is omitted', () => {
    expect(toMermaidArchitecture(sampleGraph(), { maxNodes: 60 })).not.toContain('omitted');
  });

  it('falls back to the default cap for a nonsensical maxNodes', () => {
    const out = toMermaidArchitecture(sampleGraph(), { maxNodes: 0 });
    expect(out.match(/^\s*subgraph /gm)?.length).toBe(2);
    expect(out).not.toContain('omitted');
  });

  it('styles high-risk groups red and medium groups amber when includeRisk', () => {
    const out = toMermaidArchitecture(sampleGraph(), { includeRisk: true });
    expect(out).toContain('classDef sprangRiskHigh');
    expect(out).toContain('class grp_data sprangRiskHigh');
    expect(out).toContain('risk 0.85');
  });

  it('emits classDef lines only when they are used', () => {
    const lowRisk = graphOf(
      [fileNode('a.ts', { layer: 'x', risk_score: 0.01 })],
      [],
      { layers: [{ id: 'x', name: 'X', node_ids: ['file:a.ts'] }] }
    );
    const out = toMermaidArchitecture(lowRisk, { includeRisk: true });
    expect(out).not.toContain('classDef');
    expect(out).not.toContain('sprangRiskMedium');
  });

  it('emits no risk styling at all when includeRisk is false', () => {
    const out = toMermaidArchitecture(sampleGraph());
    expect(out).not.toContain('classDef');
    expect(out).not.toContain('risk ');
  });

  it('groups by community', () => {
    const nodes = [
      fileNode('a.ts', { metadata: { community: 'community-1' } }),
      fileNode('b.ts', { metadata: { community: 'community-2' } }),
      fileNode('c.ts', {}),
    ];
    const out = toMermaidArchitecture(graphOf(nodes, []), { groupBy: 'community' });
    expect(out).toContain('subgraph sg_community_1["community-1"]');
    expect(out).toContain('subgraph sg_community_2["community-2"]');
    expect(out).toContain('"unassigned"');
  });

  it('groups by directory, with root files in (root)', () => {
    const nodes = [fileNode('src/deep/a.ts'), fileNode('README.md')];
    const out = toMermaidArchitecture(graphOf(nodes, []), { groupBy: 'directory' });
    expect(out).toContain('"src/deep"');
    expect(out).toContain('#40;root#41;');
  });

  it('escapes dangerous characters in group labels', () => {
    const nodes = [fileNode('weird (dir)/a [1].ts')];
    const out = toMermaidArchitecture(graphOf(nodes, []), { groupBy: 'directory' });
    expect(out).toContain('subgraph');
    expect(out).toContain('#40;dir#41;');
    const subgraphLine = out.split('\n').find(l => l.includes('subgraph')) ?? '';
    expect(subgraphLine.match(/"/g)?.length).toBe(2);
  });

  it('produces valid ids for unicode and space-containing paths', () => {
    const nodes = [fileNode('пример каталог/файл.ts'), fileNode('my dir/файл.ts')];
    const out = toMermaidArchitecture(graphOf(nodes, []), { groupBy: 'directory' });
    for (const line of out.split('\n')) {
      const idMatch = /^\s*(?:subgraph\s+)?([A-Za-z_][A-Za-z0-9_]*)\[/.exec(line);
      if (idMatch !== null) expect(idMatch[1]).toMatch(/^[A-Za-z_][A-Za-z0-9_]*$/);
    }
    expect(out.match(/^\s*subgraph /gm)?.length).toBe(2);
  });

  it('is deterministic', () => {
    const a = toMermaidArchitecture(sampleGraph(), { includeRisk: true, groupBy: 'layer' });
    const b = toMermaidArchitecture(sampleGraph(), { includeRisk: true, groupBy: 'layer' });
    expect(a).toBe(b);
  });

  it('ignores edges pointing at nodes that are not in the graph', () => {
    const graph = graphOf([fileNode('a.ts', { layer: 'x' })], [edge('file:a.ts', 'file:ghost.ts', 'imports')], {
      layers: [{ id: 'x', name: 'X', node_ids: ['file:a.ts'] }],
    });
    const out = toMermaidArchitecture(graph);
    expect(out).not.toContain('ghost');
    expect(out).toContain('subgraph sg_x["X"]');
  });
});

// ─── toMermaidC4Context ──────────────────────────────────────────────

describe('toMermaidC4Context', () => {
  it('handles an empty graph', () => {
    const out = toMermaidC4Context(emptyGraph);
    expect(out.split('\n')[0]).toBe('C4Context');
    expect(out).toContain('%% empty graph');
  });

  it('renders layers as systems inside an enterprise boundary', () => {
    const out = toMermaidC4Context(sampleGraph());
    expect(out).toContain('Enterprise_Boundary(');
    expect(out).toContain('System(sys_ui, "UI", "2 files")');
    expect(out).toContain('System(sys_data, "Data", "2 files")');
    expect(out.trimEnd()).toContain('  }');
  });

  it('treats boundary-looking paths as System_Ext', () => {
    for (const hint of ['client', 'sdk', 'vendor', 'external', 'integration']) {
      const graph = graphOf([fileNode(`src/${hint}/thing.ts`, { layer: 'ui' })], [], {
        layers: [{ id: 'ui', name: 'UI', node_ids: [`file:src/${hint}/thing.ts`] }],
      });
      const out = toMermaidC4Context(graph);
      expect(out).toContain(`System_Ext(ext_${hint}, "${hint}"`);
      expect(out).not.toContain('System(sys_ui');
    }
  });

  it('aggregates relationships with an edge count', () => {
    const out = toMermaidC4Context(sampleGraph());
    expect(out).toContain('Rel(sys_ui, sys_data, "3 edges")');
  });

  it('uses the singular form for a single edge/file', () => {
    const graph = graphOf([fileNode('a.ts', { layer: 'x' })], [], {
      layers: [{ id: 'x', name: 'X', node_ids: ['file:a.ts'] }],
    });
    expect(toMermaidC4Context(graph)).toContain('"1 file"');
  });

  it('never leaves an unescaped double quote inside a C4 string', () => {
    const graph = graphOf([fileNode('a.ts', { layer: 'q' })], [], {
      layers: [{ id: 'q', name: 'Say "hi"', node_ids: ['file:a.ts'] }],
    });
    const out = toMermaidC4Context(graph);
    const systemLine = out.split('\n').find(l => l.includes('System(')) ?? '';
    expect(systemLine.match(/"/g)?.length).toBe(4);
    expect(systemLine).toContain("Say 'hi'");
  });

  it('notes when there are no internal systems', () => {
    const graph = graphOf([fileNode('vendor/lib.js')], []);
    const out = toMermaidC4Context(graph);
    expect(out).toContain('%% no internal systems');
    expect(out).toContain('System_Ext(');
  });

  it('is deterministic', () => {
    expect(toMermaidC4Context(sampleGraph())).toBe(toMermaidC4Context(sampleGraph()));
  });
});

// ─── toMermaidSequence ───────────────────────────────────────────────

describe('toMermaidSequence', () => {
  it('renders participants from containing files and messages from calls', () => {
    const out = toMermaidSequence(sampleGraph(), 'function:src/ui/page.tsx:render');
    expect(out.split('\n')[0]).toBe('sequenceDiagram');
    expect(out).toContain('participant p_src_ui_page_tsx as src/ui/page.tsx');
    expect(out).toContain('participant p_src_data_repo_ts as src/data/repo.ts');
    expect(out).toContain('->>');
    expect(out).toContain(': load');
    expect(out).toContain(': query');
  });

  it('declares every participant before the first message', () => {
    const out = toMermaidSequence(sampleGraph(), 'function:src/ui/page.tsx:render');
    const lines = out.split('\n');
    const lastParticipant = lines.map(l => l.includes('participant ')).lastIndexOf(true);
    const firstMessage = lines.findIndex(l => l.includes('->>'));
    expect(lastParticipant).toBeLessThan(firstMessage);
  });

  it('honours maxDepth', () => {
    const shallow = toMermaidSequence(sampleGraph(), 'function:src/ui/page.tsx:render', { maxDepth: 1 });
    expect(shallow).toContain(': load');
    expect(shallow).not.toContain(': query');
  });

  it('defaults to depth 4', () => {
    const out = toMermaidSequence(sampleGraph(), 'function:src/ui/page.tsx:render');
    expect(out.match(/->>/g)?.length).toBe(2);
  });

  it('reports an unknown entry node instead of throwing', () => {
    const out = toMermaidSequence(sampleGraph(), 'function:nope');
    expect(out).toContain('%% entry node not found');
    expect(out).not.toContain('->>');
  });

  it('reports when the entry node makes no calls', () => {
    const out = toMermaidSequence(sampleGraph(), 'file:src/ui/button.tsx');
    expect(out).toContain('%% no outgoing calls edges');
    expect(out).toContain('participant ');
  });

  it('handles an empty graph', () => {
    const out = toMermaidSequence(emptyGraph, 'anything');
    expect(out).toContain('%% entry node not found');
  });

  it('terminates on a call cycle', () => {
    const nodes = [
      fileNode('a.ts'),
      fnNode('a.ts', 'one'),
      fnNode('a.ts', 'two'),
    ];
    const edges = [
      edge('file:a.ts', 'function:a.ts:one', 'contains'),
      edge('file:a.ts', 'function:a.ts:two', 'contains'),
      edge('function:a.ts:one', 'function:a.ts:two', 'calls'),
      edge('function:a.ts:two', 'function:a.ts:one', 'calls'),
    ];
    const out = toMermaidSequence(graphOf(nodes, edges), 'function:a.ts:one', { maxDepth: 10 });
    expect(out.match(/->>/g)?.length).toBe(2);
  });

  it('escapes dangerous characters in participants and messages', () => {
    const nodes = [
      fileNode('weird (dir)/a;b.ts'),
      fnNode('weird (dir)/a;b.ts', 'do<it>'),
      fnNode('weird (dir)/a;b.ts', 'call[me]'),
    ];
    const edges = [
      edge('file:weird (dir)/a;b.ts', 'function:weird (dir)/a;b.ts:do<it>', 'contains'),
      edge('file:weird (dir)/a;b.ts', 'function:weird (dir)/a;b.ts:call[me]', 'contains'),
      edge('function:weird (dir)/a;b.ts:do<it>', 'function:weird (dir)/a;b.ts:call[me]', 'calls'),
    ];
    const out = toMermaidSequence(graphOf(nodes, edges), 'function:weird (dir)/a;b.ts:do<it>');
    expect(out).toContain('#40;dir#41;');
    expect(out).toContain('call#91;me#93;');
    // only `->>` may contain arrow characters; no label may contain a breaker
    const labels = out
      .split('\n')
      .flatMap(line => {
        const participant = /participant \S+ as (.*)$/.exec(line);
        if (participant !== null) return [participant[1] ?? ''];
        const message = /->>[^:]+: (.*)$/.exec(line);
        return message !== null ? [message[1] ?? ''] : [];
      });
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) {
      for (const ch of ['(', ')', '[', ']', '<', '>']) expect(label).not.toContain(ch);
      // the only surviving `;` must be part of an entity like `#59;`
      expect(label.replace(/#(?:\d+|quot|lt|gt);/g, '')).not.toContain(';');
    }
  });

  it('dedupes repeated calls between the same pair', () => {
    const nodes = [fileNode('a.ts'), fnNode('a.ts', 'one'), fileNode('b.ts'), fnNode('b.ts', 'two')];
    const edges = [
      edge('file:a.ts', 'function:a.ts:one', 'contains'),
      edge('file:b.ts', 'function:b.ts:two', 'contains'),
      edge('function:a.ts:one', 'function:b.ts:two', 'calls'),
      edge('function:a.ts:one', 'function:b.ts:two', 'calls'),
    ];
    const out = toMermaidSequence(graphOf(nodes, edges), 'function:a.ts:one');
    expect(out.match(/->>/g)?.length).toBe(1);
    expect(out.match(/participant /g)?.length).toBe(2);
  });

  it('is deterministic', () => {
    const a = toMermaidSequence(sampleGraph(), 'function:src/ui/page.tsx:render');
    const b = toMermaidSequence(sampleGraph(), 'function:src/ui/page.tsx:render');
    expect(a).toBe(b);
  });

  it('uses valid participant ids even for unicode paths', () => {
    const nodes = [fileNode('пример/файл.ts'), fnNode('пример/файл.ts', 'делать')];
    const edges = [edge('file:пример/файл.ts', 'function:пример/файл.ts:делать', 'contains')];
    const out = toMermaidSequence(graphOf(nodes, edges), 'function:пример/файл.ts:делать');
    const participantLine = out.split('\n').find(l => l.includes('participant ')) ?? '';
    const id = /participant (\S+) as/.exec(participantLine)?.[1] ?? '';
    expect(id).toMatch(/^[A-Za-z_][A-Za-z0-9_]*$/);
  });
});
