import { describe, it, expect } from 'vitest';
import { selectTests, isTestPath, inferRunner } from '../../src/verify/test-selection.js';
import type { KnowledgeGraph, SprangNode, SprangEdge, EdgeType } from '../../src/schema/types.js';

function fileNode(path: string): SprangNode {
  return { id: `file:${path}`, type: 'file', name: path, label: path, filePath: path };
}

function fnNode(path: string, name: string): SprangNode {
  return {
    id: `function:${path}:${name}`,
    type: 'function',
    name,
    label: name,
    filePath: path,
    location: { file: path },
  };
}

function edge(source: string, target: string, type: EdgeType = 'imports'): SprangEdge {
  return { source, target, type };
}

function graphOf(nodes: SprangNode[], edges: SprangEdge[]): KnowledgeGraph {
  return {
    version: '1.0.0',
    generated_at: '2024-01-01T00:00:00.000Z',
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
      generated_at: '2024-01-01T00:00:00.000Z',
    },
  };
}

/** src/a.ts <- src/b.ts <- tests/b.test.ts, plus a direct tests/a.test.ts. */
function chainGraph(): KnowledgeGraph {
  return graphOf(
    [
      fileNode('src/a.ts'),
      fileNode('src/b.ts'),
      fileNode('tests/a.test.ts'),
      fileNode('tests/b.test.ts'),
      fileNode('package.json'),
      fileNode('vitest.config.ts'),
    ],
    [
      edge('file:src/b.ts', 'file:src/a.ts'),
      edge('file:tests/a.test.ts', 'file:src/a.ts'),
      edge('file:tests/b.test.ts', 'file:src/b.ts'),
    ],
  );
}

describe('isTestPath', () => {
  it('recognises .test. files', () => {
    expect(isTestPath('src/foo.test.ts')).toBe(true);
  });

  it('recognises .spec. files', () => {
    expect(isTestPath('src/foo.spec.js')).toBe(true);
  });

  it('recognises go _test. files', () => {
    expect(isTestPath('pkg/handler_test.go')).toBe(true);
  });

  it('recognises python test_ prefixed files', () => {
    expect(isTestPath('app/test_handler.py')).toBe(true);
  });

  it('does not treat a mid-path test_ as a prefix match on the basename', () => {
    expect(isTestPath('src/contest_helper.py')).toBe(false);
  });

  it('recognises a /tests/ directory', () => {
    expect(isTestPath('packages/core/tests/thing.ts')).toBe(true);
  });

  it('recognises a top-level tests/ directory', () => {
    expect(isTestPath('tests/thing.ts')).toBe(true);
  });

  it('recognises a /test/ directory', () => {
    expect(isTestPath('lib/test/thing.rb')).toBe(true);
  });

  it('recognises __tests__ directories', () => {
    expect(isTestPath('src/__tests__/thing.ts')).toBe(true);
  });

  it('recognises Java Test.java suffix', () => {
    expect(isTestPath('src/main/java/com/x/OrderTest.java')).toBe(true);
  });

  it('recognises Ruby _spec.rb suffix', () => {
    expect(isTestPath('spec/models/order_spec.rb')).toBe(true);
  });

  it('normalises Windows separators', () => {
    expect(isTestPath('packages\\core\\tests\\thing.ts')).toBe(true);
    expect(isTestPath('src\\__tests__\\thing.ts')).toBe(true);
  });

  it('returns false for ordinary source files', () => {
    expect(isTestPath('src/index.ts')).toBe(false);
    expect(isTestPath('src/latest.ts')).toBe(false);
  });
});

describe('selectTests reverse reachability', () => {
  it('finds a test one hop away', () => {
    const result = selectTests(chainGraph(), ['src/a.ts']);
    const direct = result.tests.find((t) => t.path === 'tests/a.test.ts');
    expect(direct).toBeDefined();
    expect(direct?.distance).toBe(1);
    expect(direct?.reason).toContain('directly depends on src/a.ts');
  });

  it('finds a test two hops away through an intermediate module', () => {
    const result = selectTests(chainGraph(), ['src/a.ts']);
    const indirect = result.tests.find((t) => t.path === 'tests/b.test.ts');
    expect(indirect?.distance).toBe(2);
  });

  it('sorts by distance then path', () => {
    const result = selectTests(chainGraph(), ['src/a.ts']);
    expect(result.tests.map((t) => t.path)).toEqual(['tests/a.test.ts', 'tests/b.test.ts']);
  });

  it('respects maxDistance', () => {
    const result = selectTests(chainGraph(), ['src/a.ts'], { maxDistance: 1 });
    expect(result.tests.map((t) => t.path)).toEqual(['tests/a.test.ts']);
  });

  it('maxDistance 0 selects nothing and reports unverifiable', () => {
    const result = selectTests(chainGraph(), ['src/a.ts'], { maxDistance: 0 });
    expect(result.tests).toEqual([]);
    expect(result.unverifiable).toBe(true);
  });

  it('follows calls edges between function nodes', () => {
    const graph = graphOf(
      [
        fileNode('src/a.ts'),
        fnNode('src/a.ts', 'doThing'),
        fileNode('tests/a.test.ts'),
        fnNode('tests/a.test.ts', 'itWorks'),
        fileNode('vitest.config.ts'),
      ],
      [edge('function:tests/a.test.ts:itWorks', 'function:src/a.ts:doThing', 'calls')],
    );
    const result = selectTests(graph, ['src/a.ts']);
    expect(result.tests.map((t) => t.path)).toEqual(['tests/a.test.ts']);
  });

  it('ignores non-dependency edge types such as contains and tested_by', () => {
    const graph = graphOf(
      [fileNode('src/a.ts'), fileNode('tests/a.test.ts')],
      [edge('file:src/a.ts', 'file:tests/a.test.ts', 'tested_by')],
    );
    const result = selectTests(graph, ['src/a.ts']);
    expect(result.tests).toEqual([]);
  });

  it('reports unverifiable when nothing reaches the change', () => {
    const graph = graphOf(
      [fileNode('src/lonely.ts'), fileNode('tests/other.test.ts'), fileNode('vitest.config.ts')],
      [],
    );
    const result = selectTests(graph, ['src/lonely.ts']);
    expect(result.unverifiable).toBe(true);
    expect(result.command).toBeNull();
    expect(result.guidance).toContain('cannot be verified by the existing test suite');
  });

  it('names the nearest seam when unverifiable but callers exist', () => {
    const graph = graphOf(
      [
        fileNode('src/a.ts'),
        fileNode('src/b.ts'),
        fileNode('src/c.ts'),
        fileNode('src/d.ts'),
      ],
      [
        edge('file:src/b.ts', 'file:src/a.ts'),
        edge('file:src/c.ts', 'file:src/a.ts'),
        // b is depended upon by c and d, making it the most-depended-on caller.
        edge('file:src/c.ts', 'file:src/b.ts'),
        edge('file:src/d.ts', 'file:src/b.ts'),
      ],
    );
    const result = selectTests(graph, ['src/a.ts']);
    expect(result.unverifiable).toBe(true);
    expect(result.guidance).toContain('nearest seam is src/b.ts');
  });

  it('says a new test must call in directly when nothing depends on the change', () => {
    const graph = graphOf([fileNode('src/lonely.ts')], []);
    const result = selectTests(graph, ['src/lonely.ts']);
    expect(result.guidance).toContain('call into it directly');
  });

  it('handles an empty changed list without claiming unverifiable', () => {
    const result = selectTests(chainGraph(), []);
    expect(result.tests).toEqual([]);
    expect(result.unverifiable).toBe(false);
    expect(result.command).toBeNull();
    expect(result.guidance).toContain('No changed files');
  });

  it('handles a changed file that is not in the graph', () => {
    const result = selectTests(chainGraph(), ['src/brand-new.ts']);
    expect(result.tests).toEqual([]);
    expect(result.unverifiable).toBe(true);
    expect(result.changedFiles).toEqual(['src/brand-new.ts']);
  });

  it('treats a changed test file as its own test at distance 0', () => {
    const result = selectTests(chainGraph(), ['tests/a.test.ts']);
    expect(result.tests[0]).toMatchObject({ path: 'tests/a.test.ts', distance: 0 });
    expect(result.unverifiable).toBe(false);
  });

  it('deduplicates a test reached from two changed files, keeping the shortest hop', () => {
    const result = selectTests(chainGraph(), ['src/a.ts', 'src/b.ts']);
    const bTest = result.tests.filter((t) => t.path === 'tests/b.test.ts');
    expect(bTest).toHaveLength(1);
    expect(bTest[0]?.distance).toBe(1);
  });

  it('normalises Windows separators in the changed list', () => {
    const result = selectTests(chainGraph(), ['src\\a.ts']);
    expect(result.changedFiles).toEqual(['src/a.ts']);
    expect(result.tests.length).toBeGreaterThan(0);
  });

  it('survives a cycle in the dependency graph', () => {
    const graph = graphOf(
      [fileNode('src/a.ts'), fileNode('src/b.ts'), fileNode('tests/a.test.ts')],
      [
        edge('file:src/b.ts', 'file:src/a.ts'),
        edge('file:src/a.ts', 'file:src/b.ts'),
        edge('file:tests/a.test.ts', 'file:src/b.ts'),
      ],
    );
    const result = selectTests(graph, ['src/a.ts']);
    expect(result.tests.map((t) => t.path)).toEqual(['tests/a.test.ts']);
  });

  it('guidance never claims the selected tests assert anything', () => {
    const result = selectTests(chainGraph(), ['src/a.ts']);
    expect(result.guidance).toContain('does not mean they assert anything');
  });
});

describe('inferRunner', () => {
  it('infers vitest from vitest.config', () => {
    const graph = graphOf([fileNode('vitest.config.ts'), fileNode('package.json')], []);
    expect(inferRunner(graph)).toBe('vitest');
  });

  it('infers jest from jest.config', () => {
    const graph = graphOf([fileNode('jest.config.js'), fileNode('package.json')], []);
    expect(inferRunner(graph)).toBe('jest');
  });

  it('falls back to vitest for a bare package.json', () => {
    const graph = graphOf([fileNode('package.json'), fileNode('src/a.ts')], []);
    expect(inferRunner(graph)).toBe('vitest');
  });

  it('infers pytest from pytest.ini', () => {
    const graph = graphOf([fileNode('pytest.ini'), fileNode('app/main.py')], []);
    expect(inferRunner(graph)).toBe('pytest');
  });

  it('infers pytest from conftest.py', () => {
    const graph = graphOf([fileNode('tests/conftest.py')], []);
    expect(inferRunner(graph)).toBe('pytest');
  });

  it('infers go test from go.mod', () => {
    const graph = graphOf([fileNode('go.mod'), fileNode('pkg/a.go')], []);
    expect(inferRunner(graph)).toBe('go test');
  });

  it('infers cargo test from Cargo.toml', () => {
    const graph = graphOf([fileNode('Cargo.toml'), fileNode('src/lib.rs')], []);
    expect(inferRunner(graph)).toBe('cargo test');
  });

  it('returns null rather than guessing when there is no marker file', () => {
    const graph = graphOf([fileNode('src/a.ts'), fileNode('README.md')], []);
    expect(inferRunner(graph)).toBeNull();
  });

  it('prefers an explicit config over the package.json fallback', () => {
    const graph = graphOf([fileNode('package.json'), fileNode('jest.config.mjs')], []);
    expect(inferRunner(graph)).toBe('jest');
  });
});

describe('command construction', () => {
  it('builds a vitest command naming each selected file', () => {
    const result = selectTests(chainGraph(), ['src/a.ts']);
    expect(result.command).toBe('pnpm vitest run tests/a.test.ts tests/b.test.ts');
  });

  it('builds a jest command', () => {
    const result = selectTests(chainGraph(), ['src/a.ts'], { runner: 'jest', maxDistance: 1 });
    expect(result.command).toBe('pnpm jest tests/a.test.ts');
  });

  it('builds a pytest command with paths', () => {
    const graph = graphOf(
      [fileNode('app/main.py'), fileNode('tests/test_main.py'), fileNode('pytest.ini')],
      [edge('file:tests/test_main.py', 'file:app/main.py')],
    );
    const result = selectTests(graph, ['app/main.py']);
    expect(result.command).toBe('pytest tests/test_main.py');
  });

  it('builds a go test command over package directories', () => {
    const graph = graphOf(
      [fileNode('pkg/a.go'), fileNode('pkg/a_test.go'), fileNode('go.mod')],
      [edge('file:pkg/a_test.go', 'file:pkg/a.go')],
    );
    const result = selectTests(graph, ['pkg/a.go']);
    expect(result.command).toBe('go test ./pkg');
  });

  it('runs the whole cargo suite because cargo selects by target, not path', () => {
    const graph = graphOf(
      [fileNode('src/lib.rs'), fileNode('tests/lib_test.rs'), fileNode('Cargo.toml')],
      [edge('file:tests/lib_test.rs', 'file:src/lib.rs')],
    );
    const result = selectTests(graph, ['src/lib.rs']);
    expect(result.command).toBe('cargo test');
  });

  it('returns a null command when the runner cannot be inferred', () => {
    const graph = graphOf(
      [fileNode('src/a.ts'), fileNode('tests/a.test.ts')],
      [edge('file:tests/a.test.ts', 'file:src/a.ts')],
    );
    const result = selectTests(graph, ['src/a.ts']);
    expect(result.command).toBeNull();
    expect(result.guidance).toContain('could not be inferred');
  });

  it('returns a null command for an unknown explicit runner rather than guessing', () => {
    const result = selectTests(chainGraph(), ['src/a.ts'], { runner: 'bazel' });
    expect(result.command).toBeNull();
  });

  it('returns a null command when no tests were selected', () => {
    const graph = graphOf([fileNode('src/lonely.ts'), fileNode('vitest.config.ts')], []);
    expect(selectTests(graph, ['src/lonely.ts']).command).toBeNull();
  });
});
