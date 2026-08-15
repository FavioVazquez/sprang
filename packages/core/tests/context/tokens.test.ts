import { describe, it, expect } from 'vitest';
import { estimateTokens, estimateTokensSampled } from '../../src/context/tokens.js';

/** A chunk of realistic TypeScript, repeated to build large fixtures. */
const CODE_CHUNK = [
  'export async function loadUserProfile(userId: string): Promise<UserProfile | null> {',
  '  const cached = this.cache.get(userId);',
  '  if (cached !== undefined) {',
  '    return cached;',
  '  }',
  '',
  '  const row = await this.db.query(`SELECT * FROM users WHERE id = $1`, [userId]);',
  '  if (row === null) return null;',
  '',
  '  const profile = { id: row.id, name: row.name, email: row.email, createdAt: row.created_at };',
  '  this.cache.set(userId, profile);',
  '  return profile;',
  '}',
  '',
].join('\n');

function buildFile(lines: number): string {
  // CODE_CHUNK ends with a newline, so each repetition adds `length - 1` lines.
  const perChunk = CODE_CHUNK.split('\n').length - 1;
  return CODE_CHUNK.repeat(Math.ceil(lines / perChunk) + 1);
}

// ─── estimateTokens ───────────────────────────────────────────────────────────

describe('estimateTokens', () => {
  it('returns 0 for the empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('returns at least 1 for any non-empty string', () => {
    for (const s of ['a', ' ', '\n', '.', '_', '🙂']) {
      expect(estimateTokens(s)).toBeGreaterThanOrEqual(1);
    }
  });

  it('is monotonic — appending text never decreases the estimate', () => {
    let previous = 0;
    let text = '';
    for (let i = 0; i < 200; i++) {
      text += i % 3 === 0 ? `const value${i} = ` : `compute(${i});\n`;
      const current = estimateTokens(text);
      expect(current).toBeGreaterThanOrEqual(previous);
      previous = current;
    }
  });

  it('is strictly increasing over meaningfully longer inputs', () => {
    const a = estimateTokens(CODE_CHUNK);
    const b = estimateTokens(CODE_CHUNK.repeat(2));
    expect(b).toBeGreaterThan(a);
  });

  it('scales roughly linearly with repeated content', () => {
    const one = estimateTokens(CODE_CHUNK);
    const ten = estimateTokens(CODE_CHUNK.repeat(10));
    expect(ten / one).toBeGreaterThan(9);
    expect(ten / one).toBeLessThan(11);
  });

  it('estimates English prose near the chars/4 rule of thumb', () => {
    const prose =
      'The quick brown fox jumps over the lazy dog. ' +
      'Pack my box with five dozen liquor jugs, and then rest a while.';
    const estimate = estimateTokens(prose);
    const ruleOfThumb = prose.length / 4;
    expect(estimate).toBeGreaterThan(ruleOfThumb * 0.7);
    expect(estimate).toBeLessThan(ruleOfThumb * 1.3);
  });

  it('counts source code denser than the chars/4 rule of thumb', () => {
    // Code is punctuation-heavy, so a good estimator must exceed chars/4 here.
    const dense = 'if (a[i] === b[j] && (c || d)) { return { x: 1, y: 2 }; }';
    expect(estimateTokens(dense)).toBeGreaterThan(dense.length / 4);
  });

  it('stays within the documented +/-20% band on a hand-tokenized sample', () => {
    // cl100k_base emits 18 tokens for this snippet (hand-counted):
    // export| function| estimate|Tokens|(|text|:| string|):| number| {|\n  |
    // return| 0|;|\n|}|\n
    const line = 'export function estimateTokens(text: string): number {\n  return 0;\n}\n';
    const reference = 18;
    const estimate = estimateTokens(line);
    expect(estimate).toBeGreaterThan(reference * 0.8);
    expect(estimate).toBeLessThan(reference * 1.2);
  });

  it('does not blow up on deep indentation', () => {
    const shallow = estimateTokens('x();');
    const deep = estimateTokens(' '.repeat(64) + 'x();');
    expect(deep).toBeGreaterThan(shallow);
    expect(deep).toBeLessThan(shallow + 20);
  });

  it('handles whitespace-only input', () => {
    expect(estimateTokens('   \n\n   ')).toBeGreaterThanOrEqual(1);
  });
});

// ─── estimateTokensSampled ────────────────────────────────────────────────────

describe('estimateTokensSampled', () => {
  it('returns 0 for the empty string', () => {
    expect(estimateTokensSampled('')).toBe(0);
  });

  it('takes the exact path for text under 200 characters', () => {
    const short = 'const x = 1;\n'.repeat(5);
    expect(short.length).toBeLessThan(200);
    expect(estimateTokensSampled(short)).toBe(estimateTokens(short));
  });

  it('takes the exact path for a long-but-few-lines input', () => {
    // 10 lines: floor(10 / 100) === 0, so sampling is skipped.
    const text = 'const someRatherLongIdentifierName = computeSomething(1, 2, 3);\n'.repeat(10);
    expect(text.length).toBeGreaterThan(200);
    expect(estimateTokensSampled(text)).toBe(estimateTokens(text));
  });

  it('never returns 0 for non-empty text', () => {
    const inputs = ['a', '.', ' ', '\n'.repeat(5000), 'x\n'.repeat(10000), buildFile(2000)];
    for (const input of inputs) {
      expect(estimateTokensSampled(input)).toBeGreaterThan(0);
    }
  });

  it('never returns 0 when every sampled line is blank', () => {
    const blanks = '\n'.repeat(20000);
    expect(estimateTokensSampled(blanks)).toBeGreaterThan(0);
  });

  it('agrees with the exact estimate within 25% on a 2000-line file', () => {
    const file = buildFile(2000);
    expect(file.split('\n').length).toBeGreaterThanOrEqual(2000);
    const exact = estimateTokens(file);
    const sampled = estimateTokensSampled(file);
    const error = Math.abs(sampled - exact) / exact;
    expect(error).toBeLessThan(0.25);
  });

  it('agrees with the exact estimate within 25% on a ragged 2000-line file', () => {
    const lines: string[] = [];
    for (let i = 0; i < 2000; i++) {
      lines.push(i % 7 === 0 ? '' : `${'  '.repeat(i % 4)}call_${i}(argument_${i}, ${i});`);
    }
    const file = lines.join('\n');
    const exact = estimateTokens(file);
    const sampled = estimateTokensSampled(file);
    expect(Math.abs(sampled - exact) / exact).toBeLessThan(0.25);
  });

  it('is monotonic across growing files', () => {
    const small = estimateTokensSampled(buildFile(500));
    const large = estimateTokensSampled(buildFile(5000));
    expect(large).toBeGreaterThan(small);
  });

  it('samples a 50k-line file in under 50ms', () => {
    const file = buildFile(50_000);
    expect(file.split('\n').length).toBeGreaterThanOrEqual(50_000);

    // Warm up so the measurement is not dominated by first-call JIT.
    estimateTokensSampled(file);

    const start = performance.now();
    const result = estimateTokensSampled(file);
    const elapsed = performance.now() - start;

    expect(result).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(50);
  });

  it('is substantially cheaper than the exact estimate on a large file', () => {
    const file = buildFile(50_000);
    estimateTokens(file);
    estimateTokensSampled(file);

    const t0 = performance.now();
    estimateTokens(file);
    const exactMs = performance.now() - t0;

    const t1 = performance.now();
    estimateTokensSampled(file);
    const sampledMs = performance.now() - t1;

    expect(sampledMs).toBeLessThanOrEqual(Math.max(exactMs, 1));
  });
});
