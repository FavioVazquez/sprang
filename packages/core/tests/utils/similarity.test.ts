import { describe, it, expect } from 'vitest';
import { lcsLength, lcsSimilarity, structuralFingerprint } from '../../src/utils/similarity.js';

describe('lcsLength', () => {
  it('returns 3 for identical strings "abc"', () => {
    expect(lcsLength('abc', 'abc')).toBe(3);
  });

  it('returns 0 for completely different strings "abc" and "xyz"', () => {
    expect(lcsLength('abc', 'xyz')).toBe(0);
  });

  it('returns 0 for empty first string', () => {
    expect(lcsLength('', 'abc')).toBe(0);
  });

  it('returns 0 for empty second string', () => {
    expect(lcsLength('abc', '')).toBe(0);
  });

  it('returns 0 for both empty strings', () => {
    expect(lcsLength('', '')).toBe(0);
  });

  it('handles a classic LCS example: "abcde" and "ace"', () => {
    // LCS is "ace" = 3
    expect(lcsLength('abcde', 'ace')).toBe(3);
  });

  it('handles single character match', () => {
    expect(lcsLength('a', 'a')).toBe(1);
  });

  it('handles single character non-match', () => {
    expect(lcsLength('a', 'b')).toBe(0);
  });

  it('is symmetric', () => {
    const a = 'hello world';
    const b = 'world hello';
    expect(lcsLength(a, b)).toBe(lcsLength(b, a));
  });

  it('handles longer code-like strings', () => {
    const a = 'function foo() { return 1; }';
    const b = 'function bar() { return 1; }';
    // They share a lot of characters
    expect(lcsLength(a, b)).toBeGreaterThan(20);
  });
});

describe('lcsSimilarity', () => {
  it('returns 1.0 for identical strings', () => {
    expect(lcsSimilarity('hello', 'hello')).toBe(1.0);
  });

  it('returns 0.0 for completely different strings "abc" and "xyz"', () => {
    expect(lcsSimilarity('abc', 'xyz')).toBe(0.0);
  });

  it('returns 1.0 for two empty strings', () => {
    expect(lcsSimilarity('', '')).toBe(1);
  });

  it('returns 0.0 if one string is empty', () => {
    expect(lcsSimilarity('abc', '')).toBe(0);
    expect(lcsSimilarity('', 'abc')).toBe(0);
  });

  it('returns a value between 0 and 1 for partially similar strings', () => {
    const sim = lcsSimilarity('abcdef', 'abcxyz');
    expect(sim).toBeGreaterThan(0);
    expect(sim).toBeLessThan(1);
  });

  it('returns 0.5 for "abcd" vs "ab" (lcs=2, max=4)', () => {
    expect(lcsSimilarity('abcd', 'ab')).toBe(0.5);
  });

  it('is symmetric', () => {
    const a = 'hello';
    const b = 'world';
    expect(lcsSimilarity(a, b)).toBeCloseTo(lcsSimilarity(b, a));
  });
});

describe('structuralFingerprint', () => {
  it('strips line comments', () => {
    const code = 'const x = 1; // this is a comment\nconst y = 2;';
    const fp = structuralFingerprint(code);
    expect(fp).not.toContain('//');
    expect(fp).not.toContain('this is a comment');
  });

  it('strips block comments', () => {
    const code = 'const x = /* block comment */ 1;';
    const fp = structuralFingerprint(code);
    expect(fp).not.toContain('/*');
    expect(fp).not.toContain('block comment');
  });

  it('normalizes double-quoted strings to "S"', () => {
    const code = 'const msg = "hello world";';
    const fp = structuralFingerprint(code);
    expect(fp).toContain('"S"');
    expect(fp).not.toContain('hello world');
  });

  it('normalizes single-quoted strings', () => {
    const code = "const msg = 'hello world';";
    const fp = structuralFingerprint(code);
    expect(fp).toContain("'S'");
  });

  it('normalizes template literals', () => {
    const code = 'const msg = `hello ${name}`;';
    const fp = structuralFingerprint(code);
    expect(fp).toContain('`S`');
  });

  it('normalizes numbers to N', () => {
    const code = 'const x = 42; const y = 3.14;';
    const fp = structuralFingerprint(code);
    expect(fp).not.toContain('42');
    expect(fp).not.toContain('3.14');
    expect(fp).toContain('N');
  });

  it('collapses whitespace', () => {
    const code = 'const   x   =   1;';
    const fp = structuralFingerprint(code);
    expect(fp).not.toMatch(/\s{2,}/);
  });

  it('trims leading and trailing whitespace', () => {
    const code = '   const x = 1;   ';
    const fp = structuralFingerprint(code);
    expect(fp).toBe(fp.trim());
  });

  it('produces the same fingerprint for structurally identical code with different literals', () => {
    const code1 = 'function greet(name) { return "Hello, " + name; }';
    const code2 = 'function greet(name) { return "Goodbye, " + name; }';
    const fp1 = structuralFingerprint(code1);
    const fp2 = structuralFingerprint(code2);
    expect(fp1).toBe(fp2);
  });

  it('produces different fingerprints for structurally different code', () => {
    const code1 = 'function add(a, b) { return a + b; }';
    const code2 = 'function multiply(a, b) { return a * b; }';
    const fp1 = structuralFingerprint(code1);
    const fp2 = structuralFingerprint(code2);
    // Operators differ, so fingerprints should differ
    expect(fp1).not.toBe(fp2);
  });
});
