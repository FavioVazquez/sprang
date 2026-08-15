import { describe, it, expect } from 'vitest';
import {
  parseWithTreeSitter,
  treeSitterAvailable,
  treeSitterLanguages,
} from '../../src/agents/language-parsers/tree-sitter.js';
import { parseSymbolsBest } from '../../src/agents/language-parsers/index.js';

/**
 * Tree-sitter is an optional upgrade over the regex parsers, so every test here
 * has to tolerate it being unavailable — that is the whole point of the
 * fallback. Where a test asserts AST-specific behaviour it skips rather than
 * fails when no grammar loaded.
 */
const available = await treeSitterAvailable();
const astOnly = available ? it : it.skip;

describe('tree-sitter backend', () => {
  it('reports availability without throwing', async () => {
    expect(typeof (await treeSitterAvailable())).toBe('boolean');
  });

  it('declines languages it has no grammar for', async () => {
    expect(await parseWithTreeSitter('cobol', 'IDENTIFICATION DIVISION.')).toBeNull();
  });

  it('lists the languages it can handle', () => {
    expect(treeSitterLanguages()).toContain('typescript');
    expect(treeSitterLanguages()).toContain('python');
  });

  astOnly('finds methods inside a class, which line regexes miss', async () => {
    const res = await parseWithTreeSitter(
      'typescript',
      'export class Account {\n  async charge(n: number) { return n; }\n  refund() {}\n}\n',
    );
    expect(res).not.toBeNull();
    const names = res!.functions.map((f) => f.name);
    expect(names).toContain('charge');
    expect(names).toContain('refund');
    expect(res!.functions.find((f) => f.name === 'charge')?.isAsync).toBe(true);
  });

  astOnly('finds interfaces and enums, not just classes', async () => {
    const res = await parseWithTreeSitter(
      'typescript',
      'interface Payable { pay(): void }\nenum Status { Open, Closed }\n',
    );
    const names = res!.classes.map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(['Payable', 'Status']));
  });

  astOnly('ignores declarations inside strings and comments', async () => {
    // The regex parsers cannot do this, and it is the most common source of
    // phantom symbols on files that document their own API.
    const res = await parseWithTreeSitter(
      'python',
      'x = "def not_a_function():"\n# def also_not_one():\ndef real_one():\n    pass\n',
    );
    expect(res!.functions.map((f) => f.name)).toEqual(['real_one']);
  });

  astOnly('handles a multi-line signature', async () => {
    const res = await parseWithTreeSitter(
      'python',
      'def wide(\n    a,\n    b,\n    c,\n):\n    return a\n',
    );
    expect(res!.functions.map((f) => f.name)).toEqual(['wide']);
  });

  astOnly('parses Go methods with receivers', async () => {
    const res = await parseWithTreeSitter(
      'go',
      'package m\ntype T struct{}\nfunc (t *T) Do() {}\nfunc Free() {}\n',
    );
    const names = res!.functions.map((f) => f.name);
    expect(names).toEqual(expect.arrayContaining(['Do', 'Free']));
    expect(res!.classes.map((c) => c.name)).toContain('T');
  });

  astOnly('parses Rust traits and impls', async () => {
    const res = await parseWithTreeSitter(
      'rust',
      'pub trait Pay { fn pay(&self); }\npub struct A;\nimpl A { pub fn go(&self) {} }\n',
    );
    expect(res!.functions.map((f) => f.name)).toEqual(expect.arrayContaining(['pay', 'go']));
    expect(res!.classes.map((c) => c.name)).toEqual(expect.arrayContaining(['Pay', 'A']));
  });

  astOnly('survives syntactically broken source', async () => {
    // Tree-sitter has error recovery; a half-written file during a watch run
    // must not take the scan down.
    const res = await parseWithTreeSitter('typescript', 'function ok() {}\nfunction broken( {\n');
    expect(res).not.toBeNull();
    expect(res!.functions.map((f) => f.name)).toContain('ok');
  });

  astOnly('returns an empty result for a file with no symbols, not null', async () => {
    // Empty and "parse failed" must be distinguishable, or a failure silently
    // looks like a file with nothing in it.
    const res = await parseWithTreeSitter('typescript', 'const x = 1;\n');
    expect(res).not.toBeNull();
    expect(res!.functions).toEqual([]);
  });
});

describe('parseSymbolsBest', () => {
  it('always returns symbols and a provenance label', async () => {
    const { symbols, provenance } = await parseSymbolsBest('python', 'def a():\n    pass\n');
    expect(symbols.functions.map((f) => f.name)).toContain('a');
    expect(['tree-sitter', 'heuristic-regex']).toContain(provenance);
  });

  it('falls back to regex for a language with no grammar', async () => {
    // Terraform has no tree-sitter grammar in our set, but does have a parser.
    const { symbols, provenance } = await parseSymbolsBest(
      'terraform',
      'resource "aws_s3_bucket" "logs" {\n}\n',
    );
    expect(provenance).toBe('heuristic-regex');
    expect(symbols.classes.map((c) => c.name)).toContain('aws_s3_bucket.logs');
  });

  it('never throws for an unknown language', async () => {
    const { symbols } = await parseSymbolsBest('brainfuck', '++++.');
    expect(symbols).toEqual({ functions: [], classes: [] });
  });
});
