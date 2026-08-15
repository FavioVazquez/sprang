import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { KnowledgeGraph, SprangEdge, SprangNode } from '../../src/schema/types.js';
import { generateWiki, relativeLink, slugifySegment } from '../../src/export/wiki.js';
import type { WikiPage } from '../../src/export/wiki.js';

// ─── fixtures ────────────────────────────────────────────────────────

function fileNode(filePath: string, over: Partial<SprangNode> = {}): SprangNode {
  return {
    id: `file:${filePath}`,
    type: 'file',
    label: filePath,
    location: { file: filePath },
    ...over,
  };
}

function fnNode(filePath: string, name: string, over: Partial<SprangNode> = {}): SprangNode {
  return {
    id: `function:${filePath}:${name}`,
    type: 'function',
    label: name,
    location: { file: filePath, start_line: 1, end_line: 9 },
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
      risk_summary: { high: 1, medium: 2, low: 3 },
      smell_summary: { orphan_node: 2 },
      generated_at: '2026-01-01T00:00:00.000Z',
    },
    ...over,
  };
}

const emptyGraph = graphOf([], []);

function sampleGraph(): KnowledgeGraph {
  const nodes: SprangNode[] = [
    fileNode('packages/core/src/deep/page.tsx', {
      layer: 'ui',
      risk_score: 0.91,
      risk_factors: ['high_coupling', 'bus_factor_one'],
      summary: 'Renders the page.',
      tags: ['react'],
      metadata: {
        language: 'tsx',
        sizeLines: 120,
        community: 'community-1',
        parser: 'tree-sitter',
        behavioral: {
          revisions: 42,
          bug_fixes: 7,
          main_developer: 'Ada Lovelace',
          bus_factor: 1,
          hotspot_score: 0.66,
          trap_count: 2,
        },
      },
      structural_warnings: [
        {
          category: 'god_node',
          severity: 'high',
          description: 'Too many outgoing edges.',
          related_node_ids: [],
          heuristic: 'out_degree > 20',
        },
      ],
      security_warnings: [
        {
          category: 'hardcoded_secret',
          severity: 'medium',
          description: 'Looks like a token.',
          pattern: 'sk-[A-Za-z0-9]+',
          confidence: 'unverified',
        },
      ],
      decision_context: {
        commits: [{ sha: 'abc1234', date: '2026-01-01', message: 'fix: pipe | in message', author: 'Ada' }],
        primary_authors: ['Ada Lovelace'],
        last_changed: '2026-01-01',
        change_frequency: 4,
        rationale_snippets: ['Needed for the launch.'],
        pr_references: ['#12'],
        changelog_entries: [],
      },
      annotations: ['Careful: this is load bearing.'],
    }),
    fileNode('packages/core/src/deep/button.tsx', { layer: 'ui', risk_score: 0.5 }),
    fileNode('src/data/repo.ts', { layer: 'data', risk_score: 0.5, summary: 'Data access.' }),
    fnNode('packages/core/src/deep/page.tsx', 'render'),
    fnNode('src/data/repo.ts', 'load'),
  ];
  const edges: SprangEdge[] = [
    edge('file:packages/core/src/deep/page.tsx', 'function:packages/core/src/deep/page.tsx:render', 'contains'),
    edge('file:src/data/repo.ts', 'function:src/data/repo.ts:load', 'contains'),
    edge('file:packages/core/src/deep/page.tsx', 'file:src/data/repo.ts', 'imports'),
    edge('file:packages/core/src/deep/button.tsx', 'file:src/data/repo.ts', 'imports'),
    edge('function:packages/core/src/deep/page.tsx:render', 'function:src/data/repo.ts:load', 'calls'),
  ];
  return graphOf(nodes, edges, {
    description: 'A demo project.',
    languages: ['typescript'],
    frameworks: ['react'],
    layers: [
      {
        id: 'ui',
        name: 'UI',
        description: 'Presentation layer.',
        node_ids: ['file:packages/core/src/deep/page.tsx', 'file:packages/core/src/deep/button.tsx'],
      },
      { id: 'data', name: 'Data', description: 'Persistence layer.', node_ids: ['file:src/data/repo.ts'] },
    ],
    tours: [
      { id: 'tour-1', title: 'Start here', description: 'The happy path.', steps: [{ step_title: 's', explanation: 'e' }] },
    ],
    domains: [
      {
        id: 'billing',
        label: 'Billing',
        summary: 'Money in.',
        entities: ['Invoice'],
        flows: [
          {
            id: 'flow-1',
            label: 'Charge card',
            summary: 'Take payment.',
            steps: [
              { id: 'step-2', label: 'Persist', node_ids: ['file:src/data/repo.ts'], weight: 0.9 },
              { id: 'step-1', label: 'Render', node_ids: ['function:packages/core/src/deep/page.tsx:render'], weight: 0.1 },
            ],
            business_rules: ['Never double charge.'],
          },
        ],
      },
    ],
  });
}

function pageMap(pages: readonly WikiPage[]): Map<string, WikiPage> {
  return new Map(pages.map(p => [p.path, p]));
}

/** Every markdown link target in a page, excluding absolute/external URLs. */
function localLinks(markdown: string): string[] {
  const targets: string[] = [];
  const re = /\]\(([^)]+)\)/g;
  let match = re.exec(markdown);
  while (match !== null) {
    const target = match[1];
    if (target !== undefined && !/^[a-z]+:\/\//i.test(target)) targets.push(target);
    match = re.exec(markdown);
  }
  return targets;
}

// ─── structure ───────────────────────────────────────────────────────

describe('generateWiki — structure', () => {
  it('always emits index.md and RISKS.md', () => {
    const pages = pageMap(generateWiki(sampleGraph()));
    expect(pages.has('index.md')).toBe(true);
    expect(pages.has('RISKS.md')).toBe(true);
  });

  it('emits one page per layer', () => {
    const pages = pageMap(generateWiki(sampleGraph()));
    expect(pages.has('layers/ui.md')).toBe(true);
    expect(pages.has('layers/data.md')).toBe(true);
    expect([...pages.keys()].filter(p => p.startsWith('layers/')).length).toBe(2);
  });

  it('emits one page per file node and none for symbols', () => {
    const pages = pageMap(generateWiki(sampleGraph()));
    const filePages = [...pages.keys()].filter(p => p.startsWith('files/'));
    expect(filePages.length).toBe(3);
    expect(filePages.some(p => p.includes('render'))).toBe(false);
  });

  it('preserves directory structure in file page paths', () => {
    const pages = pageMap(generateWiki(sampleGraph()));
    expect(pages.has('files/packages/core/src/deep/page.tsx.md')).toBe(true);
    expect(pages.has('files/src/data/repo.ts.md')).toBe(true);
  });

  it('emits a domain page when domains exist', () => {
    const pages = pageMap(generateWiki(sampleGraph()));
    expect(pages.has('domains/billing.md')).toBe(true);
    expect(pages.get('domains/billing.md')?.markdown).toContain('Charge card');
  });

  it('emits no domain pages when there are none', () => {
    const graph = sampleGraph();
    graph.domains = [];
    expect(generateWiki(graph).some(p => p.path.startsWith('domains/'))).toBe(false);
  });

  it('returns pages sorted by path with unique paths and non-empty titles', () => {
    const pages = generateWiki(sampleGraph());
    const paths = pages.map(p => p.path);
    expect([...paths].sort()).toEqual(paths);
    expect(new Set(paths).size).toBe(paths.length);
    for (const page of pages) {
      expect(page.title.length).toBeGreaterThan(0);
      expect(page.markdown.endsWith('\n')).toBe(true);
      expect(page.markdown).not.toContain('undefined');
      expect(page.markdown).not.toContain('[object Object]');
    }
  });
});

// ─── links ───────────────────────────────────────────────────────────

describe('generateWiki — links', () => {
  it('resolves every relative link to a page that exists', () => {
    const pages = generateWiki(sampleGraph());
    const known = new Set(pages.map(p => p.path));
    let checked = 0;
    for (const page of pages) {
      const dir = path.posix.dirname(page.path);
      for (const target of localLinks(page.markdown)) {
        const resolved = path.posix.normalize(path.posix.join(dir === '.' ? '' : dir, target));
        expect(known.has(resolved), `${page.path} → ${target} (${resolved})`).toBe(true);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(10);
  });

  it('links back to index.md with the right number of ../ hops from a deep page', () => {
    const pages = pageMap(generateWiki(sampleGraph()));
    const deep = pages.get('files/packages/core/src/deep/page.tsx.md');
    expect(deep).toBeDefined();
    expect(deep?.markdown).toContain('(../../../../../index.md)');
  });

  it('uses a bare link from a root-level page', () => {
    const pages = pageMap(generateWiki(sampleGraph()));
    expect(pages.get('RISKS.md')?.markdown).toContain('(index.md)');
    expect(pages.get('index.md')?.markdown).toContain('(RISKS.md)');
  });

  it('uses one ../ hop from a layer page', () => {
    const pages = pageMap(generateWiki(sampleGraph()));
    expect(pages.get('layers/ui.md')?.markdown).toContain('(../index.md)');
  });

  it('makes links absolute when baseUrl is given', () => {
    const pages = pageMap(generateWiki(sampleGraph(), { baseUrl: 'https://wiki.example.com/sprang' }));
    const deep = pages.get('files/packages/core/src/deep/page.tsx.md');
    expect(deep?.markdown).toContain('https://wiki.example.com/sprang/index.md');
    expect(deep?.markdown).not.toContain('../');
  });

  it('does not double the slash when baseUrl has a trailing one', () => {
    const pages = pageMap(generateWiki(sampleGraph(), { baseUrl: 'https://x.dev/w/' }));
    expect(pages.get('RISKS.md')?.markdown).toContain('https://x.dev/w/index.md');
    expect(pages.get('RISKS.md')?.markdown).not.toContain('https://x.dev/w//');
  });

  it('relativeLink computes hops from the source page depth', () => {
    expect(relativeLink('index.md', 'RISKS.md')).toBe('RISKS.md');
    expect(relativeLink('layers/ui.md', 'index.md')).toBe('../index.md');
    expect(relativeLink('files/a/b/c.ts.md', 'index.md')).toBe('../../../index.md');
    expect(relativeLink('files/a/b/c.ts.md', 'index.md', 'https://x.dev')).toBe('https://x.dev/index.md');
  });

  it('cross-links file pages to their layer and to imported files', () => {
    const pages = pageMap(generateWiki(sampleGraph()));
    const deep = pages.get('files/packages/core/src/deep/page.tsx.md')?.markdown ?? '';
    expect(deep).toContain('(../../../../../layers/ui.md)');
    expect(deep).toContain('(../../../../../files/src/data/repo.ts.md)');
  });

  it('lists importers on the imported file page', () => {
    const repo = pageMap(generateWiki(sampleGraph())).get('files/src/data/repo.ts.md')?.markdown ?? '';
    expect(repo).toContain('## Imported by');
    expect(repo).toContain('packages/core/src/deep/page.tsx');
  });

  it('never emits a link target containing a space or an unescaped paren', () => {
    const graph = graphOf([fileNode('my dir/a (copy).ts')], []);
    for (const page of generateWiki(graph)) {
      for (const target of localLinks(page.markdown)) {
        expect(target).not.toContain(' ');
        expect(target).not.toContain('(');
      }
    }
  });
});

// ─── content ─────────────────────────────────────────────────────────

describe('generateWiki — content', () => {
  it('puts counts and an architecture diagram on the index', () => {
    const index = pageMap(generateWiki(sampleGraph())).get('index.md')?.markdown ?? '';
    expect(index).toContain('# demo — Sprang Wiki');
    expect(index).toContain('A demo project.');
    expect(index).toContain('| Files | 3 |');
    expect(index).toContain('| Layers | 2 |');
    expect(index).toContain('```mermaid');
    expect(index).toContain('graph TB');
    expect(index).toContain('subgraph');
    expect(index.split('```mermaid').length - 1).toBe(1);
  });

  it('lists tours and languages on the index', () => {
    const index = pageMap(generateWiki(sampleGraph())).get('index.md')?.markdown ?? '';
    expect(index).toContain('Start here');
    expect(index).toContain('| Languages | typescript |');
    expect(index).toContain('| Frameworks | react |');
  });

  it('renders a layer page with members, summaries and dependencies', () => {
    const ui = pageMap(generateWiki(sampleGraph())).get('layers/ui.md')?.markdown ?? '';
    expect(ui).toContain('# Layer — UI');
    expect(ui).toContain('Presentation layer.');
    expect(ui).toContain('Renders the page.');
    expect(ui).toContain('## Outbound dependencies');
    expect(ui).toContain('## Inbound dependencies');
    expect(ui).toMatch(/Data.*— 3 edges/);
  });

  it('shows inbound dependencies on the depended-upon layer', () => {
    const data = pageMap(generateWiki(sampleGraph())).get('layers/data.md')?.markdown ?? '';
    expect(data).toMatch(/## Inbound dependencies[\s\S]*UI/);
  });

  it('falls back gracefully for a node with no summary', () => {
    const button = pageMap(generateWiki(sampleGraph())).get('files/packages/core/src/deep/button.tsx.md')?.markdown ?? '';
    expect(button).toContain('_No summary available._');
  });

  it('lists the symbols a file contains', () => {
    const page = pageMap(generateWiki(sampleGraph())).get('files/packages/core/src/deep/page.tsx.md')?.markdown ?? '';
    expect(page).toContain('## Symbols');
    expect(page).toContain('| render | function | 1–9 |');
  });

  it('says so when a file has no symbols', () => {
    const button = pageMap(generateWiki(sampleGraph())).get('files/packages/core/src/deep/button.tsx.md')?.markdown ?? '';
    expect(button).toContain('_No symbols extracted._');
  });

  it('renders risk factors, structural and security warnings', () => {
    const page = pageMap(generateWiki(sampleGraph())).get('files/packages/core/src/deep/page.tsx.md')?.markdown ?? '';
    expect(page).toContain('## Risk');
    expect(page).toContain('Score: **0.91** (high)');
    expect(page).toContain('`bus_factor_one`');
    expect(page).toContain('### Structural warnings');
    expect(page).toContain('Too many outgoing edges.');
    expect(page).toContain('### Security warnings');
    expect(page).toContain('unverified');
  });

  it('omits risk sections when includeRisk is false', () => {
    const pages = pageMap(generateWiki(sampleGraph(), { includeRisk: false }));
    const page = pages.get('files/packages/core/src/deep/page.tsx.md')?.markdown ?? '';
    expect(page).not.toContain('## Risk');
    expect(page).not.toContain('Structural warnings');
    expect(pages.get('index.md')?.markdown).not.toContain('## Health');
  });

  it('renders behavioural history when includeHistory', () => {
    const page = pageMap(generateWiki(sampleGraph(), { includeHistory: true })).get(
      'files/packages/core/src/deep/page.tsx.md'
    )?.markdown ?? '';
    expect(page).toContain('## History');
    expect(page).toContain('Revisions: 42');
    expect(page).toContain('Bug fixes: 7');
    expect(page).toContain('Main developer: Ada Lovelace');
    expect(page).toContain('Bus factor: 1');
    expect(page).toContain('Hotspot score: 0.66');
    expect(page).toContain('Traps (reverted / urgent fixes): 2');
    expect(page).toContain('### Recent commits');
    expect(page).toContain('Needed for the launch.');
  });

  it('omits history when includeHistory is false', () => {
    const page = pageMap(generateWiki(sampleGraph(), { includeHistory: false })).get(
      'files/packages/core/src/deep/page.tsx.md'
    )?.markdown ?? '';
    expect(page).not.toContain('## History');
    expect(page).not.toContain('Ada Lovelace');
  });

  it('says so when a file has no recorded history', () => {
    const page = pageMap(generateWiki(sampleGraph())).get('files/src/data/repo.ts.md')?.markdown ?? '';
    expect(page).toContain('_No history recorded for this file._');
  });

  it('escapes pipes so markdown tables do not break', () => {
    const page = pageMap(generateWiki(sampleGraph())).get('files/packages/core/src/deep/page.tsx.md')?.markdown ?? '';
    expect(page).toContain('fix: pipe \\| in message');
  });

  it('renders team annotations', () => {
    const page = pageMap(generateWiki(sampleGraph())).get('files/packages/core/src/deep/page.tsx.md')?.markdown ?? '';
    expect(page).toContain('> Careful: this is load bearing.');
  });

  it('orders domain flow steps by weight and links to file pages', () => {
    const domain = pageMap(generateWiki(sampleGraph())).get('domains/billing.md')?.markdown ?? '';
    expect(domain.indexOf('Render')).toBeLessThan(domain.indexOf('Persist'));
    expect(domain).toContain('Never double charge.');
    expect(domain).toContain('Invoice');
    expect(domain).toContain('../files/packages/core/src/deep/page.tsx.md');
  });
});

// ─── RISKS ───────────────────────────────────────────────────────────

describe('generateWiki — risk register', () => {
  it('orders the register highest risk first', () => {
    const nodes = [
      fileNode('low.ts', { risk_score: 0.1 }),
      fileNode('high.ts', { risk_score: 0.95 }),
      fileNode('mid.ts', { risk_score: 0.55 }),
    ];
    const risks = pageMap(generateWiki(graphOf(nodes, []))).get('RISKS.md')?.markdown ?? '';
    expect(risks.indexOf('high.ts')).toBeLessThan(risks.indexOf('mid.ts'));
    expect(risks.indexOf('mid.ts')).toBeLessThan(risks.indexOf('low.ts'));
    expect(risks).toContain('| 1 |');
    expect(risks).toContain('| 3 |');
  });

  it('breaks risk ties by node id for determinism', () => {
    const nodes = [fileNode('b.ts', { risk_score: 0.5 }), fileNode('a.ts', { risk_score: 0.5 })];
    const risks = pageMap(generateWiki(graphOf(nodes, []))).get('RISKS.md')?.markdown ?? '';
    expect(risks.indexOf('a.ts')).toBeLessThan(risks.indexOf('b.ts'));
  });

  it('labels the risk bands', () => {
    const nodes = [
      fileNode('h.ts', { risk_score: 0.7 }),
      fileNode('m.ts', { risk_score: 0.4 }),
      fileNode('l.ts', { risk_score: 0.39 }),
    ];
    const risks = pageMap(generateWiki(graphOf(nodes, []))).get('RISKS.md')?.markdown ?? '';
    expect(risks).toContain('| 0.70 | high |');
    expect(risks).toContain('| 0.40 | medium |');
    expect(risks).toContain('| 0.39 | low |');
  });

  it('skips unscored nodes and says so when there are none', () => {
    const risks = pageMap(generateWiki(graphOf([fileNode('a.ts')], []))).get('RISKS.md')?.markdown ?? '';
    expect(risks).toContain('_No risk scores in this graph._');
    expect(risks).not.toContain('| 1 |');
  });
});

// ─── edge cases ──────────────────────────────────────────────────────

describe('generateWiki — edge cases', () => {
  it('handles an empty graph', () => {
    const pages = generateWiki(emptyGraph);
    expect(pages.map(p => p.path)).toEqual(['RISKS.md', 'index.md']);
    const index = pages.find(p => p.path === 'index.md')?.markdown ?? '';
    expect(index).toContain('_No layers were derived for this graph._');
    expect(index).toContain('_No files in this graph._');
    expect(index).toContain('%% empty graph');
  });

  it('handles a graph with files but no layers', () => {
    const pages = pageMap(generateWiki(graphOf([fileNode('a.ts')], [])));
    expect([...pages.keys()].some(p => p.startsWith('layers/'))).toBe(false);
    expect(pages.has('files/a.ts.md')).toBe(true);
  });

  it('handles a layer whose members are missing from the graph', () => {
    const graph = graphOf([fileNode('a.ts')], [], {
      layers: [{ id: 'ghost', name: 'Ghost', node_ids: ['file:nope.ts'] }],
    });
    const ghost = pageMap(generateWiki(graph)).get('layers/ghost.md')?.markdown ?? '';
    expect(ghost).toContain('_This layer has no members._');
    expect(ghost).toContain('_None._');
  });

  it('slugifies paths containing spaces', () => {
    const pages = pageMap(generateWiki(graphOf([fileNode('my dir/my file.ts')], [])));
    expect(pages.has('files/my-dir/my-file.ts.md')).toBe(true);
  });

  it('preserves unicode in page paths and titles', () => {
    const pages = pageMap(generateWiki(graphOf([fileNode('пример/файл.ts')], [])));
    expect(pages.has('files/пример/файл.ts.md')).toBe(true);
    expect(pages.get('files/пример/файл.ts.md')?.title).toBe('пример/файл.ts');
  });

  it('gives colliding page names distinct paths instead of overwriting', () => {
    const graph = graphOf([fileNode('a b.ts'), fileNode('a-b.ts'), fileNode('a/b.ts')], []);
    const pages = generateWiki(graph);
    const filePages = pages.filter(p => p.path.startsWith('files/'));
    expect(filePages.length).toBe(3);
    expect(new Set(filePages.map(p => p.path)).size).toBe(3);
    const titles = new Set(filePages.map(p => p.title));
    expect(titles).toEqual(new Set(['a b.ts', 'a-b.ts', 'a/b.ts']));
  });

  it('keeps collision-broken links resolvable', () => {
    const graph = graphOf(
      [fileNode('a b.ts'), fileNode('a-b.ts')],
      [edge('file:a b.ts', 'file:a-b.ts', 'imports')]
    );
    const pages = generateWiki(graph);
    const known = new Set(pages.map(p => p.path));
    for (const page of pages) {
      const dir = path.posix.dirname(page.path);
      for (const target of localLinks(page.markdown)) {
        expect(known.has(path.posix.normalize(path.posix.join(dir === '.' ? '' : dir, target)))).toBe(true);
      }
    }
  });

  it('handles a node whose path is only separators', () => {
    const pages = generateWiki(graphOf([fileNode('///')], []));
    expect(pages.some(p => p.path.startsWith('files/'))).toBe(true);
  });

  it('slugifySegment neutralises everything that breaks a link', () => {
    expect(slugifySegment('a b')).toBe('a-b');
    expect(slugifySegment('a(b)c')).toBe('a-b-c');
    expect(slugifySegment('#hash%pct')).toBe('-hash-pct-'.replace(/^-|-$/g, ''));
    expect(slugifySegment('   ')).toBe('unnamed');
    expect(slugifySegment('файл')).toBe('файл');
  });

  it('is deterministic — same graph, byte-identical pages', () => {
    const first = generateWiki(sampleGraph(), { includeRisk: true, includeHistory: true });
    const second = generateWiki(sampleGraph(), { includeRisk: true, includeHistory: true });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('is deterministic regardless of input node ordering', () => {
    const forward = generateWiki(sampleGraph());
    const shuffled = sampleGraph();
    shuffled.nodes.reverse();
    shuffled.edges.reverse();
    const backward = generateWiki(shuffled);
    expect(backward.map(p => p.path)).toEqual(forward.map(p => p.path));
    expect(backward.find(p => p.path === 'RISKS.md')?.markdown).toBe(
      forward.find(p => p.path === 'RISKS.md')?.markdown
    );
  });

  it('does not blow up on a self-referential contains edge', () => {
    const graph = graphOf([fileNode('a.ts')], [edge('file:a.ts', 'file:a.ts', 'contains')]);
    expect(() => generateWiki(graph)).not.toThrow();
    expect(pageMap(generateWiki(graph)).has('files/a.ts.md')).toBe(true);
  });
});
