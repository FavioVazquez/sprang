import { describe, it, expect } from 'vitest';
import {
  detectDeadCode,
  generateSuggestions,
  FRAMEWORK_INVOKED_NAMES,
  MAX_SUGGESTIONS,
} from '../../src/graph/suggestions.js';
import type { KnowledgeGraph, SprangEdge, SprangNode } from '../../src/schema/types.js';

// ── builders ────────────────────────────────────────────────────────────────

function fileNode(path: string, extra: Partial<SprangNode> = {}): SprangNode {
  return {
    id: path,
    type: 'file',
    name: path,
    label: path,
    location: { file: path },
    filePath: path,
    metadata: { fileCategory: 'source' },
    ...extra,
  };
}

function fnNode(id: string, name: string, file: string, extra: Partial<SprangNode> = {}): SprangNode {
  return {
    id,
    type: 'function',
    name,
    label: name,
    location: { file, start_line: 10 },
    ...extra,
  };
}

function edge(source: string, target: string, type: SprangEdge['type'] = 'calls'): SprangEdge {
  return { source, target, type };
}

function graph(nodes: SprangNode[], edges: SprangEdge[] = []): Pick<KnowledgeGraph, 'nodes' | 'edges'> {
  return { nodes, edges };
}

/** A reachable source file plus one uncalled, non-exported function inside it. */
function deadCodeGraph(name = 'orphanHelper'): Pick<KnowledgeGraph, 'nodes' | 'edges'> {
  return graph(
    [fileNode('src/a.ts'), fileNode('src/b.ts'), fnNode('src/a.ts::fn', name, 'src/a.ts')],
    [edge('src/b.ts', 'src/a.ts', 'imports')],
  );
}

const idsOf = (list: { id: string }[]): string[] => list.map((s) => s.id);

// ─────────────────────────────────────────────────────────────────────────────
// detectDeadCode
// ─────────────────────────────────────────────────────────────────────────────

describe('detectDeadCode', () => {
  it('returns [] for an empty graph', () => {
    expect(detectDeadCode({ nodes: [], edges: [] })).toEqual([]);
  });

  it('flags an uncalled, non-exported function in a reachable source file with high confidence', () => {
    const findings = detectDeadCode(deadCodeGraph());
    expect(findings).toHaveLength(1);
    expect(findings[0]?.nodeId).toBe('src/a.ts::fn');
    expect(findings[0]?.name).toBe('orphanHelper');
    expect(findings[0]?.file).toBe('src/a.ts');
    expect(findings[0]?.line).toBe(10);
    expect(findings[0]?.confidence).toBe('high');
    expect(findings[0]?.reason).toContain('No incoming call edges');
  });

  it('does not flag a function that has an incoming calls edge', () => {
    const g = deadCodeGraph();
    g.edges.push(edge('src/b.ts::caller', 'src/a.ts::fn', 'calls'));
    expect(detectDeadCode(g)).toEqual([]);
  });

  it('ignores node types other than function and class', () => {
    const g = graph([
      fileNode('src/a.ts'),
      { id: 'm', type: 'module', name: 'mod', label: 'mod', location: { file: 'src/a.ts' } },
    ]);
    expect(detectDeadCode(g)).toEqual([]);
  });

  it('flags uncalled classes as well as functions', () => {
    const g = graph(
      [
        fileNode('src/a.ts'),
        fileNode('src/b.ts'),
        { ...fnNode('src/a.ts::C', 'LonelyClass', 'src/a.ts'), type: 'class' },
      ],
      [edge('src/b.ts', 'src/a.ts', 'imports')],
    );
    expect(detectDeadCode(g).map((f) => f.name)).toEqual(['LonelyClass']);
  });

  it('skips exported symbols — public API has no internal callers by design', () => {
    const g = deadCodeGraph();
    g.nodes.push(fnNode('src/a.ts::pub', 'publicThing', 'src/a.ts', { metadata: { exported: true } }));
    expect(detectDeadCode(g).map((f) => f.name)).toEqual(['orphanHelper']);
  });

  it('skips the Python dunder __init__ via the exemption list', () => {
    const g = deadCodeGraph('__init__');
    expect(detectDeadCode(g)).toEqual([]);
  });

  it('skips `handler`, which frameworks invoke reflectively', () => {
    expect(detectDeadCode(deadCodeGraph('handler'))).toEqual([]);
  });

  it('matches the exemption list case-insensitively so GET and get are both exempt', () => {
    expect(detectDeadCode(deadCodeGraph('GET'))).toEqual([]);
    expect(detectDeadCode(deadCodeGraph('get'))).toEqual([]);
  });

  it('exports an auditable exemption list covering the documented families', () => {
    for (const name of [
      'main',
      'default',
      'handler',
      'setup',
      'teardown',
      'render',
      'constructor',
      'componentDidMount',
      'ngOnInit',
      'useEffect',
      '__init__',
      '__main__',
      '__enter__',
      '__exit__',
      '__call__',
      'beforeEach',
      'afterEach',
      'beforeAll',
      'afterAll',
      'setUp',
      'tearDown',
      'GET',
      'POST',
      'PUT',
      'PATCH',
      'DELETE',
      'up',
      'down',
      'upgrade',
      'downgrade',
      'run',
      'start',
      'serve',
      'execute',
      'init',
    ]) {
      expect(FRAMEWORK_INVOKED_NAMES).toContain(name);
    }
  });

  it('skips symbols living in test files', () => {
    for (const path of [
      'src/__tests__/a.ts',
      'src/a.test.ts',
      'src/a.spec.ts',
      'tests/a.ts',
      'packages/core/test/a.ts',
    ]) {
      const g = graph(
        [fileNode(path), fileNode('src/b.ts'), fnNode(`${path}::fn`, 'helper', path)],
        [edge('src/b.ts', path, 'imports')],
      );
      expect(detectDeadCode(g), path).toEqual([]);
    }
  });

  it('skips files whose fileCategory is not source', () => {
    const g = graph(
      [
        fileNode('config/app.json', { metadata: { fileCategory: 'config' } }),
        fileNode('src/b.ts'),
        fnNode('config/app.json::fn', 'helper', 'config/app.json'),
      ],
      [edge('src/b.ts', 'config/app.json', 'imports')],
    );
    expect(detectDeadCode(g)).toEqual([]);
  });

  it('downgrades to medium when the containing file has no incoming edges', () => {
    // No edge into src/a.ts: the file itself may be unreachable, which is a
    // different (larger) finding than a single dead symbol.
    const g = graph([fileNode('src/a.ts'), fnNode('src/a.ts::fn', 'orphanHelper', 'src/a.ts')]);
    const findings = detectDeadCode(g);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.confidence).toBe('medium');
    expect(findings[0]?.reason).toContain('no incoming edges');
  });

  it('downgrades to medium when no file node records the category', () => {
    const g = graph([fnNode('lonely::fn', 'orphanHelper', 'src/unknown.ts')]);
    const findings = detectDeadCode(g);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.confidence).toBe('medium');
    expect(findings[0]?.reason).toContain('not marked as source');
  });

  it('inherits fileCategory from the symbol itself when present', () => {
    const g = graph([
      fileNode('src/b.ts'),
      fnNode('x::fn', 'orphanHelper', 'src/gen.ts', { metadata: { fileCategory: 'generated' } }),
    ]);
    expect(detectDeadCode(g)).toEqual([]);
  });

  it('does not count self-edges as calls', () => {
    const g = deadCodeGraph();
    g.edges.push(edge('src/a.ts::fn', 'src/a.ts::fn', 'calls'));
    expect(detectDeadCode(g)).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// generateSuggestions
// ─────────────────────────────────────────────────────────────────────────────

describe('generateSuggestions', () => {
  it('returns [] for an empty graph', () => {
    expect(generateSuggestions({ nodes: [], edges: [] })).toEqual([]);
  });

  it('returns [] for a graph with nodes but no signals at all', () => {
    expect(generateSuggestions(graph([fileNode('src/a.ts'), fileNode('src/b.ts')]))).toEqual([]);
  });

  it('fires circular-dependencies when a circular_dependency warning is present', () => {
    const g = graph([
      fileNode('src/a.ts', {
        structural_warnings: [
          {
            category: 'circular_dependency',
            severity: 'high',
            description: 'a -> b -> a',
            related_node_ids: ['src/b.ts'],
            heuristic: 'cycle detection',
          },
        ],
      }),
      fileNode('src/b.ts'),
    ]);
    const s = generateSuggestions(g);
    expect(idsOf(s)).toContain('circular-dependencies');
    const card = s.find((x) => x.id === 'circular-dependencies');
    expect(card?.nodeIds).toEqual(expect.arrayContaining(['src/a.ts', 'src/b.ts']));
    expect(card?.detail).toContain('1 circular dependency warning');
  });

  it('does not fire circular-dependencies when no such warning exists', () => {
    const g = graph([
      fileNode('src/a.ts', {
        structural_warnings: [
          {
            category: 'low_cohesion',
            severity: 'low',
            description: 'x',
            related_node_ids: [],
            heuristic: 'h',
          },
        ],
      }),
    ]);
    expect(idsOf(generateSuggestions(g))).not.toContain('circular-dependencies');
  });

  it('fires god-nodes for god_node and over_connected warnings', () => {
    const g = graph([
      fileNode('src/hub.ts', {
        structural_warnings: [
          {
            category: 'god_node',
            severity: 'high',
            description: 'too big',
            related_node_ids: [],
            heuristic: 'out_degree > 20',
          },
        ],
      }),
      fileNode('src/other.ts', {
        structural_warnings: [
          {
            category: 'over_connected',
            severity: 'medium',
            description: 'many edges',
            related_node_ids: [],
            heuristic: 'degree > 15',
          },
        ],
      }),
    ]);
    const card = generateSuggestions(g).find((x) => x.id === 'god-nodes');
    expect(card).toBeDefined();
    expect(card?.priority).toBe('high'); // highest severity among the warnings
    expect(card?.detail).toContain('out_degree > 20');
    expect(card?.nodeIds).toHaveLength(2);
  });

  it('drops god-nodes to medium priority when no warning is high severity', () => {
    const g = graph([
      fileNode('src/hub.ts', {
        structural_warnings: [
          {
            category: 'god_node',
            severity: 'medium',
            description: 'biggish',
            related_node_ids: [],
            heuristic: 'degree > 15',
          },
        ],
      }),
    ]);
    expect(generateSuggestions(g).find((x) => x.id === 'god-nodes')?.priority).toBe('medium');
  });

  it('fires layer-violations only when a layer_violation warning is present', () => {
    const with_ = graph([
      fileNode('src/ui.ts', {
        structural_warnings: [
          {
            category: 'layer_violation',
            severity: 'high',
            description: 'ui -> db',
            related_node_ids: ['src/db.ts'],
            heuristic: 'layer order',
          },
        ],
      }),
    ]);
    expect(idsOf(generateSuggestions(with_))).toContain('layer-violations');
    expect(idsOf(generateSuggestions(graph([fileNode('src/ui.ts')])))).not.toContain('layer-violations');
  });

  it('fires change-traps for trap_count and for the previously_reverted risk factor', () => {
    const byTraps = graph([
      fileNode('src/a.ts', { metadata: { fileCategory: 'source', behavioral: { trap_count: 2 } } }),
    ]);
    const trapCard = generateSuggestions(byTraps).find((x) => x.id === 'change-traps');
    expect(trapCard?.priority).toBe('critical');
    expect(trapCard?.detail).toContain('2 recorded revert');

    const byFactor = graph([fileNode('src/a.ts', { risk_factors: ['previously_reverted'] })]);
    expect(idsOf(generateSuggestions(byFactor))).toContain('change-traps');
  });

  it('does not fire change-traps when behavioural data is absent', () => {
    const g = graph([fileNode('src/a.ts', { metadata: { fileCategory: 'source', behavioral: { revisions: 9 } } })]);
    expect(idsOf(generateSuggestions(g))).not.toContain('change-traps');
  });

  it('fires bus-factor-one only for high-risk single-owner files, and names no owner it was not given', () => {
    const highRisk = graph([
      fileNode('src/a.ts', {
        risk_score: 0.8,
        metadata: { fileCategory: 'source', behavioral: { bus_factor: 1, main_developer: 'ada' } },
      }),
    ]);
    const card = generateSuggestions(highRisk).find((x) => x.id === 'bus-factor-one');
    expect(card?.detail).toContain('ada');

    // Same bus factor, low risk: not worth anyone's attention.
    const lowRisk = graph([
      fileNode('src/a.ts', { risk_score: 0.2, metadata: { fileCategory: 'source', behavioral: { bus_factor: 1 } } }),
    ]);
    expect(idsOf(generateSuggestions(lowRisk))).not.toContain('bus-factor-one');
  });

  it('never invents an owner when main_developer is missing', () => {
    const g = graph([
      fileNode('src/a.ts', { risk_score: 0.9, metadata: { fileCategory: 'source', behavioral: { bus_factor: 1 } } }),
    ]);
    const card = generateSuggestions(g).find((x) => x.id === 'bus-factor-one');
    expect(card).toBeDefined();
    expect(card?.detail).not.toContain('main developer');
  });

  it('fires hotspots at score >= 0.5 and not below it', () => {
    const hot = graph([
      fileNode('src/a.ts', { metadata: { fileCategory: 'source', behavioral: { hotspot_score: 0.7, revisions: 42 } } }),
    ]);
    const card = generateSuggestions(hot).find((x) => x.id === 'hotspots');
    expect(card?.detail).toContain('0.7');
    expect(card?.detail).toContain('42 revisions');

    const cold = graph([
      fileNode('src/a.ts', { metadata: { fileCategory: 'source', behavioral: { hotspot_score: 0.4 } } }),
    ]);
    expect(idsOf(generateSuggestions(cold))).not.toContain('hotspots');
  });

  it('fires untested-high-risk only when both the factor and the score qualify', () => {
    const both = graph([fileNode('src/a.ts', { risk_score: 0.7, risk_factors: ['no_test_coverage'] })]);
    expect(generateSuggestions(both).find((x) => x.id === 'untested-high-risk')?.detail).toContain('0.7');

    const lowScore = graph([fileNode('src/a.ts', { risk_score: 0.3, risk_factors: ['no_test_coverage'] })]);
    expect(idsOf(generateSuggestions(lowScore))).not.toContain('untested-high-risk');

    const noFactor = graph([fileNode('src/a.ts', { risk_score: 0.9, risk_factors: ['high_coupling'] })]);
    expect(idsOf(generateSuggestions(noFactor))).not.toContain('untested-high-risk');
  });

  it('fires dead-code from detectDeadCode and stays quiet when nothing is dead', () => {
    expect(idsOf(generateSuggestions(deadCodeGraph()))).toContain('dead-code');
    expect(idsOf(generateSuggestions(deadCodeGraph('__init__')))).not.toContain('dead-code');
  });

  it('quantifies removed lines only when every dead symbol reported a size', () => {
    const sized = graph(
      [
        fileNode('src/a.ts'),
        fileNode('src/b.ts'),
        fnNode('src/a.ts::x', 'orphanA', 'src/a.ts', { metadata: { sizeLines: 30 } }),
        fnNode('src/a.ts::y', 'orphanB', 'src/a.ts', { metadata: { sizeLines: 12 } }),
      ],
      [edge('src/b.ts', 'src/a.ts', 'imports')],
    );
    expect(generateSuggestions(sized).find((x) => x.id === 'dead-code')?.impact).toBe(
      'Removes ~42 lines of code that nothing calls.',
    );

    // One symbol has no size: no number may be claimed.
    const unsized = generateSuggestions(deadCodeGraph()).find((x) => x.id === 'dead-code');
    expect(unsized?.impact).not.toMatch(/~\d/);
  });

  it('fires security-hints for high-severity warnings only', () => {
    const high = graph([
      fileNode('src/a.ts', {
        security_warnings: [
          {
            category: 'hardcoded_secret',
            severity: 'high',
            description: 'looks like a key',
            pattern: 'AKIA[0-9A-Z]{16}',
            confidence: 'unverified',
          },
        ],
      }),
    ]);
    expect(idsOf(generateSuggestions(high))).toContain('security-hints');

    const low = graph([
      fileNode('src/a.ts', {
        security_warnings: [
          {
            category: 'weak_crypto',
            severity: 'low',
            description: 'md5',
            pattern: 'md5',
            confidence: 'unverified',
          },
        ],
      }),
    ]);
    expect(idsOf(generateSuggestions(low))).not.toContain('security-hints');
  });

  it('never calls a security hint a vulnerability and always says it is unverified', () => {
    const g = graph([
      fileNode('src/a.ts', {
        security_warnings: [
          {
            category: 'sql_injection',
            severity: 'high',
            description: 'string concat in query',
            pattern: 'SELECT .* \\+',
            confidence: 'unverified',
          },
        ],
      }),
    ]);
    const card = generateSuggestions(g).find((x) => x.id === 'security-hints');
    expect(card).toBeDefined();
    const text = `${card?.title} ${card?.detail} ${card?.action} ${card?.impact}`.toLowerCase();
    expect(text).not.toContain('vulnerab');
    expect(text).not.toContain('exploit');
    expect(text).toContain('unverified');
  });

  it('deduplicates: many nodes in one category produce one card with at most 5 examples', () => {
    const nodes = Array.from({ length: 20 }, (_, i) =>
      fileNode(`src/f${i}.ts`, {
        structural_warnings: [
          {
            category: 'god_node',
            severity: 'high',
            description: 'big',
            related_node_ids: [],
            heuristic: 'degree > 20',
          },
        ],
      }),
    );
    const s = generateSuggestions(graph(nodes));
    expect(s.filter((x) => x.id === 'god-nodes')).toHaveLength(1);
    expect(s[0]?.nodeIds.length).toBeLessThanOrEqual(5);
    expect(s.find((x) => x.id === 'god-nodes')?.detail).toContain('20 nodes');
  });

  it('caps the list at 12 and keeps every id unique when every category fires', () => {
    const nodes: SprangNode[] = [fileNode('src/hub.ts')];
    for (let i = 0; i < 40; i++) {
      nodes.push(
        fileNode(`src/f${i}.ts`, {
          risk_score: 0.9,
          risk_factors: ['no_test_coverage', 'previously_reverted'],
          structural_warnings: [
            {
              category: i % 3 === 0 ? 'circular_dependency' : i % 3 === 1 ? 'god_node' : 'layer_violation',
              severity: 'high',
              description: 'd',
              related_node_ids: [],
              heuristic: 'h',
            },
          ],
          security_warnings: [
            {
              category: 'unsafe_eval',
              severity: 'high',
              description: 'eval',
              pattern: 'eval\\(',
              confidence: 'unverified',
            },
          ],
          metadata: {
            fileCategory: 'source',
            behavioral: { trap_count: 1, bus_factor: 1, hotspot_score: 0.9, revisions: 30 },
          },
        }),
      );
      nodes.push(fnNode(`src/f${i}.ts::dead`, `orphan${i}`, `src/f${i}.ts`));
    }
    const s = generateSuggestions(graph(nodes, [edge('src/hub.ts', 'src/f0.ts', 'imports')]));
    expect(s.length).toBeLessThanOrEqual(MAX_SUGGESTIONS);
    expect(new Set(idsOf(s)).size).toBe(s.length);
    expect(s.length).toBeGreaterThanOrEqual(8);
  });

  it('sorts critical first, then high, then medium', () => {
    const g = graph(
      [
        fileNode('src/a.ts', { metadata: { fileCategory: 'source', behavioral: { trap_count: 3 } } }),
        fileNode('src/b.ts', {
          structural_warnings: [
            {
              category: 'god_node',
              severity: 'medium',
              description: 'biggish',
              related_node_ids: [],
              heuristic: 'h',
            },
          ],
        }),
        fileNode('src/c.ts', { risk_score: 0.8, risk_factors: ['no_test_coverage'] }),
      ],
      [],
    );
    const s = generateSuggestions(g);
    expect(s.map((x) => x.priority)).toEqual(['critical', 'high', 'medium']);
  });

  it('gives every suggestion a non-empty title, detail, action and impact', () => {
    const g = graph(
      [
        fileNode('src/a.ts', {
          risk_score: 0.9,
          risk_factors: ['no_test_coverage'],
          metadata: {
            fileCategory: 'source',
            behavioral: { trap_count: 1, bus_factor: 1, hotspot_score: 0.8, revisions: 12 },
          },
        }),
      ],
      [],
    );
    const s = generateSuggestions(g);
    expect(s.length).toBeGreaterThan(0);
    for (const card of s) {
      expect(card.id).not.toBe('');
      expect(card.title.length).toBeGreaterThan(0);
      expect(card.detail.length).toBeGreaterThan(0);
      expect(card.action.length).toBeGreaterThan(0);
      expect(card.impact.length).toBeGreaterThan(0);
      expect(card.nodeIds.length).toBeGreaterThan(0);
    }
  });

  it('tolerates nodes with no metadata, no warnings and no risk data', () => {
    const g = graph([
      { id: 'bare', type: 'file', label: 'bare' },
      { id: 'bare2', type: 'function', label: 'main' },
    ]);
    expect(() => generateSuggestions(g)).not.toThrow();
    expect(generateSuggestions(g)).toEqual([]);
  });
});
