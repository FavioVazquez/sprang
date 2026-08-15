import { describe, it, expect } from 'vitest';
import {
  runLineParser,
  exportedIfCapitalised,
  exportedUnlessUnderscored,
  isHashComment,
  isSlashComment,
} from '../../src/agents/language-parsers/line-parser.js';
import { parseSymbols } from '../../src/agents/language-parsers/index.js';

/**
 * This helper exists because Sprang's own clone detector reported `parseC` and
 * `parseGo` at similarity 1.0. These tests pin the shared behaviour; the
 * per-language tests elsewhere pin that the refactor changed no output.
 */
describe('runLineParser', () => {
  it('captures a function name from group 1', () => {
    const { functions } = runLineParser('func Hello() {}\n', {
      rules: [{ kind: 'function', pattern: /^func\s+(\w+)/ }],
    });
    expect(functions).toEqual([{ name: 'Hello', startLine: 1, exported: true, isAsync: false }]);
  });

  it('reports 1-based line numbers', () => {
    const { functions } = runLineParser('\n\nfunc Hello() {}\n', {
      rules: [{ kind: 'function', pattern: /^func\s+(\w+)/ }],
    });
    expect(functions[0]?.startLine).toBe(3);
  });

  it('honours rule order, so a loose pattern cannot pre-empt a specific one', () => {
    // This is exactly the C case: the function pattern matches `class Foo {`.
    const source = 'class Foo {\n';
    const classFirst = runLineParser(source, {
      rules: [
        { kind: 'class', pattern: /^class\s+(\w+)/ },
        { kind: 'function', pattern: /^\w+\s+(\w+)/ },
      ],
    });
    expect(classFirst.classes.map((c) => c.name)).toEqual(['Foo']);
    expect(classFirst.functions).toEqual([]);

    const functionFirst = runLineParser(source, {
      rules: [
        { kind: 'function', pattern: /^\w+\s+(\w+)/ },
        { kind: 'class', pattern: /^class\s+(\w+)/ },
      ],
    });
    expect(functionFirst.functions.map((f) => f.name)).toEqual(['Foo']);
  });

  it('a matched-but-skipped line does not fall through to a looser rule', () => {
    // The hand-written parsers `continue`d after a match, not after a push.
    const { functions, classes } = runLineParser('func init() {}\n', {
      rules: [
        { kind: 'function', pattern: /^func\s+(\w+)/, skip: new Set(['init']) },
        { kind: 'class', pattern: /^func\s+(\w+)/ },
      ],
    });
    expect(functions).toEqual([]);
    expect(classes).toEqual([]);
  });

  it('applies the skip set', () => {
    const { functions } = runLineParser('if (x) {\n', {
      rules: [{ kind: 'function', pattern: /^(\w+)\s*\(/, skip: new Set(['if']) }],
    });
    expect(functions).toEqual([]);
  });

  it('uses transform to rewrite the captured name', () => {
    const { functions } = runLineParser('function &getRef() {}\n', {
      rules: [
        {
          kind: 'function',
          pattern: /^function\s+(&?\s*\w+)/,
          transform: (m) => (m[1] ?? '').replace(/^&\s*/, ''),
        },
      ],
    });
    expect(functions[0]?.name).toBe('getRef');
  });

  it('treats a transform returning null as no match', () => {
    const { functions } = runLineParser('func 9bad() {}\n', {
      rules: [{ kind: 'function', pattern: /^func\s+(\w+)/, transform: () => null }],
    });
    expect(functions).toEqual([]);
  });

  it('detects async by default and lets a language override it', () => {
    const spec = { rules: [{ kind: 'function' as const, pattern: /^\w*\s*fun\s+(\w+)/ }] };
    expect(runLineParser('async fun a()\n', spec).functions[0]?.isAsync).toBe(true);

    const kotlinish = runLineParser('suspend fun a()\n', {
      rules: [
        {
          kind: 'function' as const,
          pattern: /^\w*\s*fun\s+(\w+)/,
          isAsync: (line: string) => /\bsuspend\b/.test(line),
        },
      ],
    });
    expect(kotlinish.functions[0]?.isAsync).toBe(true);
  });

  it('uses the exported predicate, defaulting to true', () => {
    const { functions } = runLineParser('func lower() {}\nfunc Upper() {}\n', {
      rules: [{ kind: 'function', pattern: /^func\s+(\w+)/, exported: exportedIfCapitalised }],
    });
    expect(functions.map((f) => f.exported)).toEqual([false, true]);
  });

  it('skips ignored lines entirely', () => {
    const { functions } = runLineParser('# func Ghost() {}\nfunc Real() {}\n', {
      ignoreLine: isHashComment,
      rules: [{ kind: 'function', pattern: /^\s*func\s+(\w+)/ }],
    });
    expect(functions.map((f) => f.name)).toEqual(['Real']);
  });

  it('skips blank lines without consulting any rule', () => {
    const { functions } = runLineParser('\n   \n', {
      rules: [{ kind: 'function', pattern: /(.*)/ }],
    });
    expect(functions).toEqual([]);
  });

  it('resets lastIndex, so a global regex does not skip alternate matches', () => {
    // A /g regex retains lastIndex between calls and would match every other
    // line — a subtle bug the shared runner has to prevent once, not per file.
    const { functions } = runLineParser('func a()\nfunc b()\nfunc c()\n', {
      rules: [{ kind: 'function', pattern: /^func\s+(\w+)/g }],
    });
    expect(functions.map((f) => f.name)).toEqual(['a', 'b', 'c']);
  });

  it('returns empty results for empty source', () => {
    expect(runLineParser('', { rules: [] })).toEqual({ functions: [], classes: [] });
  });

  it('handles a spec with no rules', () => {
    expect(runLineParser('anything\n', { rules: [] })).toEqual({ functions: [], classes: [] });
  });
});

describe('shared visibility predicates', () => {
  it('exportedIfCapitalised follows the Go convention', () => {
    expect(exportedIfCapitalised('Public')).toBe(true);
    expect(exportedIfCapitalised('private')).toBe(false);
  });

  it('exportedUnlessUnderscored follows the widest convention', () => {
    expect(exportedUnlessUnderscored('visible')).toBe(true);
    expect(exportedUnlessUnderscored('_internal')).toBe(false);
  });

  it('recognises both comment styles', () => {
    expect(isHashComment('# note')).toBe(true);
    expect(isSlashComment('// note')).toBe(true);
    expect(isSlashComment('* jsdoc')).toBe(true);
    expect(isSlashComment('code();')).toBe(false);
  });
});

describe('refactored parsers keep their behaviour', () => {
  it('Go still reports capitalisation-based visibility and skips init', () => {
    const { functions, classes } = parseSymbols(
      'go',
      'package m\nfunc Exported() {}\nfunc unexported() {}\nfunc init() {}\ntype T struct {\n}\n',
    );
    expect(functions.map((f) => [f.name, f.exported])).toEqual([
      ['Exported', true],
      ['unexported', false],
    ]);
    expect(classes.map((c) => c.name)).toEqual(['T']);
  });

  it('C still prefers the class rule over the looser function rule', () => {
    const { functions, classes } = parseSymbols('cpp', 'class Account {\n};\nint main() {\n}\n');
    expect(classes.map((c) => c.name)).toEqual(['Account']);
    expect(functions.map((f) => f.name)).toEqual(['main']);
  });

  it('PHP still strips the by-reference ampersand and reads access modifiers', () => {
    const { functions } = parseSymbols(
      'php',
      '<?php\nprivate function hidden() {}\npublic function &getRef() {}\n',
    );
    expect(functions.map((f) => [f.name, f.exported])).toEqual([
      ['hidden', false],
      ['getRef', true],
    ]);
  });

  it('Ruby still uses top-level indentation as visibility', () => {
    const { functions } = parseSymbols('ruby', 'def top\nend\nclass A\n  def inner\n  end\nend\n');
    expect(functions.map((f) => [f.name, f.exported])).toEqual([
      ['top', true],
      ['inner', false],
    ]);
  });

  it('Bash still handles both function forms', () => {
    const { functions } = parseSymbols('bash', 'deploy() {\n echo\n}\nfunction _helper {\n echo\n}\n');
    expect(functions.map((f) => [f.name, f.exported])).toEqual([
      ['deploy', true],
      ['_helper', false],
    ]);
  });

  it('Kotlin still treats suspend as async and private as hidden', () => {
    const { functions } = parseSymbols('kotlin', 'private suspend fun load() {}\nfun open() {}\n');
    expect(functions.map((f) => [f.name, f.exported, f.isAsync])).toEqual([
      ['load', false, true],
      ['open', true, false],
    ]);
  });

  it('Java still prefers types over the permissive method pattern', () => {
    const { functions, classes } = parseSymbols(
      'java',
      'public class A {\n  public void go() {}\n  private int calc() { return 1; }\n}\n',
    );
    expect(classes.map((c) => c.name)).toEqual(['A']);
    expect(functions.map((f) => [f.name, f.exported])).toEqual([
      ['go', true],
      ['calc', false],
    ]);
  });
});
