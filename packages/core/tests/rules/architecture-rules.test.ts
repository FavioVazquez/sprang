import { describe, it, expect } from 'vitest';
import {
  parseRulesFile,
  checkRules,
  matchesSelector,
  EXAMPLE_RULES_FILE,
  type ArchitectureRule,
} from '../../src/rules/architecture-rules.js';
import type { KnowledgeGraph, SprangEdge, SprangNode } from '../../src/schema/types.js';

// ─── Fixtures ─────────────────────────────────────────────────────────

function node(id: string, filePath?: string, layer?: string): SprangNode {
  const n: SprangNode = { id, type: 'file', label: id };
  if (filePath !== undefined) n.filePath = filePath;
  if (layer !== undefined) n.layer = layer;
  return n;
}

function edge(source: string, target: string, type: SprangEdge['type'] = 'imports'): SprangEdge {
  return { source, target, type };
}

function graphOf(nodes: SprangNode[], edges: SprangEdge[], layers: KnowledgeGraph['layers'] = []): KnowledgeGraph {
  return {
    version: '1.0.0',
    generated_at: '2024-01-01T00:00:00.000Z',
    project_root: '/repo',
    project_name: 'test',
    phase: 'complete',
    nodes,
    edges,
    layers,
    tours: [],
    domains: [],
    stats: {
      node_count: nodes.length,
      edge_count: edges.length,
      risk_summary: { high: 0, medium: 0, low: 0 },
      smell_summary: {},
      generated_at: '2024-01-01T00:00:00.000Z',
    },
  };
}

const EMPTY_GRAPH = graphOf([], []);

/** core -> dashboard (a violation), core -> core (fine), cli -> core (fine). */
function sampleGraph(): KnowledgeGraph {
  const nodes = [
    node('core-index', 'packages/core/src/index.ts', 'domain'),
    node('core-util', 'packages/core/src/utils/fs.ts', 'domain'),
    node('dash-app', 'packages/dashboard/src/App.tsx', 'ui'),
    node('cli-main', 'packages/cli/src/index.ts', 'api'),
  ];
  const edges = [
    edge('core-index', 'core-util'),
    edge('core-index', 'dash-app'),
    edge('cli-main', 'core-index'),
  ];
  return graphOf(nodes, edges);
}

const FORBID_CORE_TO_DASH: ArchitectureRule = {
  name: 'core-not-ui',
  from: 'packages/core/**',
  to: 'packages/dashboard/**',
  type: 'forbidden',
};

// ─── matchesSelector ──────────────────────────────────────────────────

describe('matchesSelector', () => {
  it('matches a plain literal path exactly', () => {
    expect(matchesSelector('src/a.ts', node('a', 'src/a.ts'), EMPTY_GRAPH)).toBe(true);
    expect(matchesSelector('src/a.ts', node('b', 'src/ab.ts'), EMPTY_GRAPH)).toBe(false);
  });

  it("'*' matches within a segment but never crosses '/'", () => {
    const sel = 'src/*.ts';
    expect(matchesSelector(sel, node('a', 'src/a.ts'), EMPTY_GRAPH)).toBe(true);
    expect(matchesSelector(sel, node('b', 'src/deep/a.ts'), EMPTY_GRAPH)).toBe(false);
  });

  it("'**' crosses segments", () => {
    const sel = 'src/**/*.ts';
    expect(matchesSelector(sel, node('a', 'src/a.ts'), EMPTY_GRAPH)).toBe(true);
    expect(matchesSelector(sel, node('b', 'src/deep/nest/a.ts'), EMPTY_GRAPH)).toBe(true);
    expect(matchesSelector(sel, node('c', 'other/a.ts'), EMPTY_GRAPH)).toBe(false);
  });

  it("a trailing '/**' matches the prefix itself and anything below it", () => {
    const sel = 'packages/core/**';
    expect(matchesSelector(sel, node('a', 'packages/core'), EMPTY_GRAPH)).toBe(true);
    expect(matchesSelector(sel, node('b', 'packages/core/src/x.ts'), EMPTY_GRAPH)).toBe(true);
    expect(matchesSelector(sel, node('c', 'packages/corex/src/x.ts'), EMPTY_GRAPH)).toBe(false);
  });

  it("'?' matches exactly one character", () => {
    expect(matchesSelector('src/a?.ts', node('a', 'src/ab.ts'), EMPTY_GRAPH)).toBe(true);
    expect(matchesSelector('src/a?.ts', node('b', 'src/abc.ts'), EMPTY_GRAPH)).toBe(false);
  });

  it('treats regex metacharacters in the selector as literals', () => {
    // '.' must not behave as "any character"
    expect(matchesSelector('src/a.ts', node('a', 'src/axts'), EMPTY_GRAPH)).toBe(false);
    // '+' must not be a quantifier
    expect(matchesSelector('vendor/lib.v1+2/x.ts', node('a', 'vendor/lib.v1+2/x.ts'), EMPTY_GRAPH)).toBe(true);
    expect(matchesSelector('vendor/lib.v1+2/x.ts', node('b', 'vendor/lib.v112/x.ts'), EMPTY_GRAPH)).toBe(false);
  });

  it('treats parentheses and brackets in paths literally', () => {
    expect(matchesSelector('app/(marketing)/[id]/page.tsx', node('a', 'app/(marketing)/[id]/page.tsx'), EMPTY_GRAPH))
      .toBe(true);
    expect(matchesSelector('app/(marketing)/[id]/page.tsx', node('b', 'app/marketing/i/page.tsx'), EMPTY_GRAPH))
      .toBe(false);
  });

  it('anchors at both ends', () => {
    expect(matchesSelector('src/a.ts', node('a', 'x/src/a.ts'), EMPTY_GRAPH)).toBe(false);
    expect(matchesSelector('src/a.ts', node('b', 'src/a.tsx'), EMPTY_GRAPH)).toBe(false);
  });

  it("matches 'layer:<id>' against the node's own layer field", () => {
    expect(matchesSelector('layer:api', node('a', 'x.ts', 'api'), EMPTY_GRAPH)).toBe(true);
    expect(matchesSelector('layer:api', node('b', 'x.ts', 'domain'), EMPTY_GRAPH)).toBe(false);
  });

  it("matches 'layer:<id>' via the graph's layer membership list", () => {
    const n = node('a', 'x.ts');
    const graph = graphOf([n], [], [{ id: 'api', name: 'API', node_ids: ['a'] }]);
    expect(matchesSelector('layer:api', n, graph)).toBe(true);
    expect(matchesSelector('layer:ui', n, graph)).toBe(false);
  });

  it('returns false for a node with no location when the selector is a glob', () => {
    expect(matchesSelector('**', node('a'), EMPTY_GRAPH)).toBe(false);
    expect(matchesSelector('src/**', node('a'), EMPTY_GRAPH)).toBe(false);
  });

  it('falls back to location.file when filePath is absent', () => {
    const n: SprangNode = { id: 'a', type: 'function', label: 'f', location: { file: 'src/a.ts' } };
    expect(matchesSelector('src/*.ts', n, EMPTY_GRAPH)).toBe(true);
  });

  it('returns false for empty or malformed layer selectors', () => {
    expect(matchesSelector('', node('a', 'x.ts'), EMPTY_GRAPH)).toBe(false);
    expect(matchesSelector('   ', node('a', 'x.ts'), EMPTY_GRAPH)).toBe(false);
    expect(matchesSelector('layer:', node('a', 'x.ts', 'api'), EMPTY_GRAPH)).toBe(false);
  });

  it("'**' alone matches every located node", () => {
    expect(matchesSelector('**', node('a', 'anything/at/all.ts'), EMPTY_GRAPH)).toBe(true);
  });
});

// ─── checkRules ───────────────────────────────────────────────────────

describe('checkRules — forbidden', () => {
  it('fires on a forbidden dependency', () => {
    const result = checkRules(sampleGraph(), [FORBID_CORE_TO_DASH]);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toMatchObject({
      rule: 'core-not-ui',
      severity: 'error',
      from: 'core-index',
      to: 'dash-app',
      edgeType: 'imports',
    });
  });

  it('does not fire on allowed dependencies', () => {
    const rule: ArchitectureRule = { ...FORBID_CORE_TO_DASH, to: 'packages/nothing/**' };
    const result = checkRules(sampleGraph(), [rule]);
    expect(result.violations).toEqual([]);
    expect(result.errorCount).toBe(0);
  });

  it('is directional — the reverse edge is not a violation', () => {
    const rule: ArchitectureRule = {
      name: 'ui-not-core',
      from: 'packages/dashboard/**',
      to: 'packages/core/**',
      type: 'forbidden',
    };
    expect(checkRules(sampleGraph(), [rule]).violations).toEqual([]);
  });

  it('carries the rule comment onto every violation', () => {
    const rule: ArchitectureRule = { ...FORBID_CORE_TO_DASH, comment: 'core is headless' };
    const result = checkRules(sampleGraph(), [rule]);
    expect(result.violations[0]?.comment).toBe('core is headless');
  });

  it('omits comment entirely when the rule has none', () => {
    const result = checkRules(sampleGraph(), [FORBID_CORE_TO_DASH]);
    expect(result.violations[0] && 'comment' in result.violations[0]).toBe(false);
  });

  it('reports the concrete edge type', () => {
    const g = graphOf(
      [node('a', 'src/a.ts'), node('b', 'tests/b.ts')],
      [edge('a', 'b', 'depends_on')],
    );
    const rule: ArchitectureRule = { name: 'r', from: 'src/**', to: 'tests/**', type: 'forbidden' };
    expect(checkRules(g, [rule]).violations[0]?.edgeType).toBe('depends_on');
  });
});

describe('checkRules — allowed-only', () => {
  const rule: ArchitectureRule = {
    name: 'api-only-domain',
    from: 'layer:api',
    to: 'layer:domain',
    type: 'allowed-only',
  };

  it('fires on anything outside the allow set', () => {
    const g = graphOf(
      [node('a', 'api/a.ts', 'api'), node('d', 'domain/d.ts', 'domain'), node('i', 'infra/i.ts', 'infra')],
      [edge('a', 'd'), edge('a', 'i')],
    );
    const result = checkRules(g, [rule]);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]?.to).toBe('i');
  });

  it('permits dependencies inside the from-group itself', () => {
    const g = graphOf(
      [node('a1', 'api/a1.ts', 'api'), node('a2', 'api/a2.ts', 'api'), node('d', 'domain/d.ts', 'domain')],
      [edge('a1', 'a2')],
    );
    expect(checkRules(g, [rule]).violations).toEqual([]);
  });

  it('fires for every disallowed target, not just the first', () => {
    const g = graphOf(
      [
        node('a', 'api/a.ts', 'api'),
        node('i1', 'infra/i1.ts', 'infra'),
        node('i2', 'infra/i2.ts', 'infra'),
        node('d', 'domain/d.ts', 'domain'),
      ],
      [edge('a', 'i1'), edge('a', 'i2'), edge('a', 'd')],
    );
    const result = checkRules(g, [rule]);
    expect(result.violations.map((v) => v.to)).toEqual(['i1', 'i2']);
  });
});

describe('checkRules — bookkeeping and guards', () => {
  it('handles an empty graph', () => {
    const result = checkRules(EMPTY_GRAPH, [FORBID_CORE_TO_DASH]);
    expect(result.violations).toEqual([]);
    expect(result.rulesEvaluated).toBe(1);
    expect(result.unmatchedRules).toEqual(['core-not-ui']);
  });

  it('handles empty rules', () => {
    const result = checkRules(sampleGraph(), []);
    expect(result).toEqual({
      violations: [],
      errorCount: 0,
      warningCount: 0,
      rulesEvaluated: 0,
      unmatchedRules: [],
    });
  });

  it('reports rules whose from-selector matches nothing', () => {
    const typo: ArchitectureRule = { name: 'typo', from: 'packges/core/**', to: '**', type: 'forbidden' };
    const result = checkRules(sampleGraph(), [FORBID_CORE_TO_DASH, typo]);
    expect(result.unmatchedRules).toEqual(['typo']);
    // and the good rule still ran
    expect(result.violations).toHaveLength(1);
  });

  it('does not report a rule as unmatched merely because its to-side matches nothing', () => {
    const rule: ArchitectureRule = { name: 'r', from: 'packages/core/**', to: 'nope/**', type: 'forbidden' };
    expect(checkRules(sampleGraph(), [rule]).unmatchedRules).toEqual([]);
  });

  it('a rule matching everything on both sides flags all cross-node edges', () => {
    const rule: ArchitectureRule = { name: 'all', from: '**', to: '**', type: 'forbidden' };
    const result = checkRules(sampleGraph(), [rule]);
    expect(result.violations).toHaveLength(3);
    expect(result.errorCount).toBe(3);
  });

  it('ignores edges pointing at a node that is missing from the graph', () => {
    const g = graphOf([node('a', 'src/a.ts')], [edge('a', 'ghost')]);
    const rule: ArchitectureRule = { name: 'r', from: '**', to: '**', type: 'forbidden' };
    expect(checkRules(g, [rule]).violations).toEqual([]);
  });

  it('ignores edges whose source is missing from the graph', () => {
    const g = graphOf([node('b', 'src/b.ts')], [edge('ghost', 'b')]);
    const rule: ArchitectureRule = { name: 'r', from: '**', to: '**', type: 'forbidden' };
    expect(checkRules(g, [rule]).violations).toEqual([]);
  });

  it('ignores self-edges', () => {
    const g = graphOf([node('a', 'src/a.ts')], [edge('a', 'a')]);
    const rule: ArchitectureRule = { name: 'r', from: '**', to: '**', type: 'forbidden' };
    expect(checkRules(g, [rule]).violations).toEqual([]);
  });

  it('nodes without a location are simply not covered by a path rule', () => {
    const g = graphOf([{ id: 'x', type: 'concept', label: 'x' }, node('d', 'packages/dashboard/a.ts')], [edge('x', 'd')]);
    const result = checkRules(g, [FORBID_CORE_TO_DASH]);
    expect(result.violations).toEqual([]);
    expect(result.unmatchedRules).toEqual(['core-not-ui']);
  });

  it('counts errors and warnings separately', () => {
    const warn: ArchitectureRule = { ...FORBID_CORE_TO_DASH, name: 'w', severity: 'warning' };
    const err: ArchitectureRule = { ...FORBID_CORE_TO_DASH, name: 'e', severity: 'error' };
    const result = checkRules(sampleGraph(), [warn, err]);
    expect(result.warningCount).toBe(1);
    expect(result.errorCount).toBe(1);
    expect(result.violations).toHaveLength(2);
  });

  it('defaults severity to error', () => {
    expect(checkRules(sampleGraph(), [FORBID_CORE_TO_DASH]).violations[0]?.severity).toBe('error');
  });

  it('deduplicates identical source/target/edge-type triples within one rule', () => {
    const g = graphOf(
      [node('a', 'src/a.ts'), node('b', 'tests/b.ts')],
      [edge('a', 'b'), edge('a', 'b')],
    );
    const rule: ArchitectureRule = { name: 'r', from: 'src/**', to: 'tests/**', type: 'forbidden' };
    expect(checkRules(g, [rule]).violations).toHaveLength(1);
  });

  it('keeps distinct edge types between the same pair as distinct violations', () => {
    const g = graphOf(
      [node('a', 'src/a.ts'), node('b', 'tests/b.ts')],
      [edge('a', 'b', 'imports'), edge('a', 'b', 'calls')],
    );
    const rule: ArchitectureRule = { name: 'r', from: 'src/**', to: 'tests/**', type: 'forbidden' };
    expect(checkRules(g, [rule]).violations.map((v) => v.edgeType)).toEqual(['imports', 'calls']);
  });

  it('reports rulesEvaluated as the number of rules given, matched or not', () => {
    const typo: ArchitectureRule = { name: 'typo', from: 'nowhere/**', to: '**', type: 'forbidden' };
    expect(checkRules(sampleGraph(), [FORBID_CORE_TO_DASH, typo]).rulesEvaluated).toBe(2);
  });

  it('is deterministic across repeated runs and preserves rule then edge order', () => {
    const rules: ArchitectureRule[] = [
      { name: 'r2', from: '**', to: 'packages/dashboard/**', type: 'forbidden' },
      { name: 'r1', from: 'packages/cli/**', to: 'packages/core/**', type: 'forbidden' },
    ];
    const first = checkRules(sampleGraph(), rules);
    const second = checkRules(sampleGraph(), rules);
    expect(first).toEqual(second);
    expect(first.violations.map((v) => v.rule)).toEqual(['r2', 'r1']);
  });
});

// ─── parseRulesFile ───────────────────────────────────────────────────

describe('parseRulesFile', () => {
  it('parses a forbid rule', () => {
    const { rules, errors } = parseRulesFile('forbid packages/core/** -> packages/dashboard/**');
    expect(errors).toEqual([]);
    expect(rules).toEqual([
      {
        name: 'forbid packages/core/** -> packages/dashboard/**',
        from: 'packages/core/**',
        to: 'packages/dashboard/**',
        type: 'forbidden',
        severity: 'error',
      },
    ]);
  });

  it('parses an allow-only rule', () => {
    const { rules, errors } = parseRulesFile('allow-only layer:api -> layer:domain');
    expect(errors).toEqual([]);
    expect(rules[0]?.type).toBe('allowed-only');
    expect(rules[0]?.severity).toBe('error');
  });

  it('parses the -warn directives as warnings', () => {
    const { rules, errors } = parseRulesFile('forbid-warn a/** -> b/**\nallow-only-warn c/** -> d/**');
    expect(errors).toEqual([]);
    expect(rules.map((r) => [r.type, r.severity])).toEqual([
      ['forbidden', 'warning'],
      ['allowed-only', 'warning'],
    ]);
  });

  it('captures a trailing comment on a rule line', () => {
    const { rules } = parseRulesFile('forbid a/** -> b/**   # keep a clean');
    expect(rules[0]?.comment).toBe('keep a clean');
  });

  it('omits comment when there is none, and when the comment is empty', () => {
    const { rules } = parseRulesFile('forbid a/** -> b/**\nforbid c/** -> d/**   #  ');
    expect(rules[0] && 'comment' in rules[0]).toBe(false);
    expect(rules[1] && 'comment' in rules[1]).toBe(false);
  });

  it('ignores blank lines and whole-line comments', () => {
    const { rules, errors } = parseRulesFile('# header\n\n   \nforbid a/** -> b/**\n\n# trailer\n');
    expect(errors).toEqual([]);
    expect(rules).toHaveLength(1);
  });

  it('handles an empty file', () => {
    expect(parseRulesFile('')).toEqual({ rules: [], errors: [] });
  });

  it('handles a whitespace-only file', () => {
    expect(parseRulesFile('\n\n   \n\t\n')).toEqual({ rules: [], errors: [] });
  });

  it('handles CRLF line endings', () => {
    const { rules, errors } = parseRulesFile('forbid a/** -> b/**\r\nforbid c/** -> d/**\r\n');
    expect(errors).toEqual([]);
    expect(rules).toHaveLength(2);
  });

  it('is case-insensitive on the directive but not on selectors', () => {
    const { rules, errors } = parseRulesFile('FORBID Src/** -> b/**');
    expect(errors).toEqual([]);
    expect(rules[0]?.from).toBe('Src/**');
  });

  it('reports a missing arrow with the line number', () => {
    const { rules, errors } = parseRulesFile('forbid a/** b/**');
    expect(rules).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('line 1');
    expect(errors[0]).toContain("missing '->'");
  });

  it('reports an unknown directive with the offending token', () => {
    const { errors } = parseRulesFile('# a comment\nban a/** -> b/**');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('line 2');
    expect(errors[0]).toContain('unknown directive "ban"');
  });

  it('reports more than one arrow', () => {
    const { errors } = parseRulesFile('forbid a/** -> b/** -> c/**');
    expect(errors[0]).toContain('line 1');
    expect(errors[0]).toContain("more than one '->'");
  });

  it('reports an empty target selector', () => {
    const { errors } = parseRulesFile('forbid a/** ->');
    expect(errors[0]).toContain('empty target selector');
  });

  it('reports a directive with no source selector', () => {
    const { errors } = parseRulesFile('forbid -> b/**');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('line 1');
  });

  it('reports whitespace inside a selector rather than guessing', () => {
    const { rules, errors } = parseRulesFile('forbid a/** b -> c/**');
    expect(rules).toEqual([]);
    expect(errors[0]).toContain('whitespace');
  });

  it('reports duplicate rules', () => {
    const { rules, errors } = parseRulesFile('forbid a/** -> b/**\nforbid a/** -> b/**');
    expect(rules).toHaveLength(1);
    expect(errors[0]).toContain('line 2');
    expect(errors[0]).toContain('duplicate');
  });

  it('reports errors per line and keeps every good rule', () => {
    const { rules, errors } = parseRulesFile(
      ['forbid a/** -> b/**', 'garbage', 'allow-only c/** -> d/**', 'nope x -> y'].join('\n'),
    );
    expect(rules).toHaveLength(2);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain('line 2');
    expect(errors[1]).toContain('line 4');
  });

  it('does not throw on adversarial input', () => {
    expect(() => parseRulesFile('->\n#\n   ->   \nforbid\n-> ->\n\u0000')).not.toThrow();
  });

  it('is deterministic', () => {
    const content = 'forbid a/** -> b/**\nbad line\nallow-only c/** -> d/**';
    expect(parseRulesFile(content)).toEqual(parseRulesFile(content));
  });

  it('produces rules that feed straight into checkRules', () => {
    const { rules, errors } = parseRulesFile('forbid packages/core/** -> packages/dashboard/**  # headless');
    expect(errors).toEqual([]);
    const result = checkRules(sampleGraph(), rules);
    expect(result.errorCount).toBe(1);
    expect(result.violations[0]?.comment).toBe('headless');
  });
});

// ─── EXAMPLE_RULES_FILE ───────────────────────────────────────────────

describe('EXAMPLE_RULES_FILE', () => {
  it('parses with zero errors', () => {
    const { errors } = parseRulesFile(EXAMPLE_RULES_FILE);
    expect(errors).toEqual([]);
  });

  it('yields a usable, non-empty rule set', () => {
    const { rules } = parseRulesFile(EXAMPLE_RULES_FILE);
    expect(rules.length).toBeGreaterThanOrEqual(4);
    expect(rules.every((r) => r.from.length > 0 && r.to.length > 0)).toBe(true);
  });

  it('demonstrates both rule types and both severities', () => {
    const { rules } = parseRulesFile(EXAMPLE_RULES_FILE);
    expect(rules.some((r) => r.type === 'forbidden')).toBe(true);
    expect(rules.some((r) => r.type === 'allowed-only')).toBe(true);
    expect(rules.some((r) => r.severity === 'warning')).toBe(true);
  });

  it('runs against a graph without throwing', () => {
    const { rules } = parseRulesFile(EXAMPLE_RULES_FILE);
    const result = checkRules(sampleGraph(), rules);
    expect(result.rulesEvaluated).toBe(rules.length);
    expect(result.violations.some((v) => v.to === 'dash-app')).toBe(true);
  });
});
