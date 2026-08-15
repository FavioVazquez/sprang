import { describe, it, expect } from 'vitest';
import { renderSkeleton, skeletonForSymbols } from '../../src/context/skeleton.js';

const TS_CLASS = [
  'export class UserService {',
  '  private readonly repo: Repo;',
  '',
  '  constructor(repo: Repo) {',
  '    this.repo = repo;',
  '  }',
  '',
  '  async findUser(id: string): Promise<User | null> {',
  '    return this.repo.findById(id);',
  '  }',
  '}',
].join('\n');

const PY_CLASS = [
  'class Foo:',
  '    def bar(self):',
  '        return 1',
  '',
  '    def baz(self):',
  '        return 2',
].join('\n');

const NESTED_TS = [
  'namespace Outer {',
  '  export namespace Inner {',
  '    export class Thing {',
  '      method() {',
  '        doWork();',
  '      }',
  '    }',
  '  }',
  '}',
].join('\n');

// ─── exact rendered output ────────────────────────────────────────────────────

describe('renderSkeleton — exact output', () => {
  it('renders a small TypeScript class exactly', () => {
    const out = renderSkeleton(TS_CLASS, { linesOfInterest: [4, 8] });
    expect(out).toBe(
      [
        'export class UserService {',
        '  ⋮',
        '  constructor(repo: Repo) {',
        '  ⋮',
        '  async findUser(id: string): Promise<User | null> {',
        '  ⋮',
      ].join('\n'),
    );
  });

  it('renders Python indentation exactly', () => {
    const out = renderSkeleton(PY_CLASS, { linesOfInterest: [5] });
    expect(out).toBe(['class Foo:', '    ⋮', '    def baz(self):', '    ⋮'].join('\n'));
  });

  it('renders with padding, including trailing context lines', () => {
    const out = renderSkeleton(PY_CLASS, { linesOfInterest: [5], padding: 1 });
    expect(out).toBe(
      ['class Foo:', '    ⋮', '    def baz(self):', '        return 2'].join('\n'),
    );
  });
});

// ─── enclosing scope ──────────────────────────────────────────────────────────

describe('renderSkeleton — enclosing scope headers', () => {
  it('emits two levels of scope for a method body inside a class', () => {
    const out = renderSkeleton(TS_CLASS, { linesOfInterest: [9] });
    const lines = out.split('\n');
    expect(lines).toContain('export class UserService {');
    expect(lines).toContain('  async findUser(id: string): Promise<User | null> {');
    expect(lines).toContain('    return this.repo.findById(id);');
  });

  it('emits three levels of scope for namespace > namespace > class > method', () => {
    const out = renderSkeleton(NESTED_TS, { linesOfInterest: [5] });
    expect(out).toBe(
      [
        '  ⋮',
        '  export namespace Inner {',
        '    export class Thing {',
        '      method() {',
        '        doWork();',
        '        ⋮',
      ].join('\n'),
    );
  });

  it('caps scope headers at three levels (outermost namespace is dropped)', () => {
    const out = renderSkeleton(NESTED_TS, { linesOfInterest: [5] });
    expect(out).not.toContain('namespace Outer {');
  });

  it('omits scope headers when showEnclosingScope is false', () => {
    const out = renderSkeleton(TS_CLASS, { linesOfInterest: [9], showEnclosingScope: false });
    expect(out).toBe(['    ⋮', '    return this.repo.findById(id);', '    ⋮'].join('\n'));
  });

  it('skips blank lines when walking backward for scope', () => {
    const src = ['class A {', '', '', '  method() {', '    x();', '  }', '}'].join('\n');
    const out = renderSkeleton(src, { linesOfInterest: [5] });
    expect(out.split('\n')[0]).toBe('class A {');
  });

  it('gives a top-level line no scope headers', () => {
    const out = renderSkeleton(TS_CLASS, { linesOfInterest: [1] });
    expect(out).toBe(['export class UserService {', '⋮'].join('\n'));
  });
});

// ─── dedup ────────────────────────────────────────────────────────────────────

describe('renderSkeleton — deduplication', () => {
  it('emits a line only once when it is both an LOI and a scope header', () => {
    const out = renderSkeleton(TS_CLASS, { linesOfInterest: [1, 9] });
    const occurrences = out.split('\n').filter((l) => l === 'export class UserService {');
    expect(occurrences).toHaveLength(1);
  });

  it('collapses duplicate line numbers in linesOfInterest', () => {
    const a = renderSkeleton(TS_CLASS, { linesOfInterest: [4, 4, 4] });
    const b = renderSkeleton(TS_CLASS, { linesOfInterest: [4] });
    expect(a).toBe(b);
  });
});

// ─── truncation ───────────────────────────────────────────────────────────────

describe('renderSkeleton — truncation', () => {
  it('truncates long lines and appends an ellipsis', () => {
    const src = `const minified = ${'"x"+'.repeat(100)}"end";`;
    const out = renderSkeleton(src, { linesOfInterest: [1], maxLineLength: 20 });
    expect(out).toBe('const minified = "x"…');
    expect(out.replace('…', '')).toHaveLength(20);
  });

  it('does not append an ellipsis to a line at or under the limit', () => {
    const out = renderSkeleton('abcde', { linesOfInterest: [1], maxLineLength: 5 });
    expect(out).toBe('abcde');
  });

  it('defaults maxLineLength to 200', () => {
    const src = 'y'.repeat(500);
    const out = renderSkeleton(src, { linesOfInterest: [1] });
    expect(out).toBe('y'.repeat(200) + '…');
  });
});

// ─── edge cases ───────────────────────────────────────────────────────────────

describe('renderSkeleton — edge cases', () => {
  it('returns empty string for empty source', () => {
    expect(renderSkeleton('', { linesOfInterest: [1, 2, 3] })).toBe('');
  });

  it('returns empty string for empty linesOfInterest', () => {
    expect(renderSkeleton(TS_CLASS, { linesOfInterest: [] })).toBe('');
  });

  it('ignores out-of-range line numbers silently', () => {
    const out = renderSkeleton(TS_CLASS, { linesOfInterest: [0, -5, 4, 999] });
    expect(out).toBe(renderSkeleton(TS_CLASS, { linesOfInterest: [4] }));
  });

  it('returns empty string when every line number is out of range', () => {
    expect(renderSkeleton(TS_CLASS, { linesOfInterest: [500, 600] })).toBe('');
  });

  it('emits no elision marker when every line is a line of interest', () => {
    const src = ['a', 'b', 'c'].join('\n');
    const out = renderSkeleton(src, { linesOfInterest: [1, 2, 3] });
    expect(out).toBe('a\nb\nc');
    expect(out).not.toContain('⋮');
  });

  it('emits no elision marker for a fully covered file with a trailing newline', () => {
    const out = renderSkeleton('a\nb\n', { linesOfInterest: [1, 2] });
    expect(out).toBe('a\nb');
  });

  it('handles CRLF line endings and never emits a carriage return', () => {
    const crlf = TS_CLASS.replace(/\n/g, '\r\n');
    const out = renderSkeleton(crlf, { linesOfInterest: [4, 8] });
    expect(out).not.toContain('\r');
    expect(out).toBe(renderSkeleton(TS_CLASS, { linesOfInterest: [4, 8] }));
  });

  it('treats a tab as one indentation unit', () => {
    const src = ['class A {', '\tfoo() {', '\t\tbar();', '\t}', '}'].join('\n');
    const out = renderSkeleton(src, { linesOfInterest: [3] });
    expect(out).toBe(
      ['class A {', '\tfoo() {', '\t\tbar();', '\t\t⋮'].join('\n'),
    );
  });

  it('handles a single-line source with no trailing newline', () => {
    expect(renderSkeleton('solo', { linesOfInterest: [1] })).toBe('solo');
  });

  it('gives the elision marker the indentation of the following kept line', () => {
    const out = renderSkeleton(NESTED_TS, { linesOfInterest: [5] });
    expect(out.split('\n')[0]).toBe('  ⋮');
  });
});

// ─── skeletonForSymbols ───────────────────────────────────────────────────────

describe('skeletonForSymbols', () => {
  it('renders the same output as renderSkeleton with the same lines', () => {
    const out = skeletonForSymbols(TS_CLASS, [
      { name: 'constructor', startLine: 4 },
      { name: 'findUser', startLine: 8 },
    ]);
    expect(out).toBe(renderSkeleton(TS_CLASS, { linesOfInterest: [4, 8] }));
  });

  it('collapses symbols that share a start line', () => {
    const out = skeletonForSymbols(TS_CLASS, [
      { name: 'get', startLine: 8 },
      { name: 'set', startLine: 8 },
    ]);
    expect(out).toBe(renderSkeleton(TS_CLASS, { linesOfInterest: [8] }));
  });

  it('forwards options through to renderSkeleton', () => {
    const out = skeletonForSymbols(TS_CLASS, [{ name: 'x', startLine: 8 }], {
      showEnclosingScope: false,
      maxLineLength: 10,
    });
    expect(out).toBe(renderSkeleton(TS_CLASS, { linesOfInterest: [8], showEnclosingScope: false, maxLineLength: 10 }));
    expect(out).toContain('…');
  });

  it('returns empty string for no symbols', () => {
    expect(skeletonForSymbols(TS_CLASS, [])).toBe('');
  });
});
