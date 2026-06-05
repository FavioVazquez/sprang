import { describe, it, expect } from 'vitest';
import {
  cosineSimilarity,
  buildTfIdfEmbedding,
  buildVocabulary,
  semanticSearch,
} from '../../src/utils/embedding-search.js';
import type { SprangNode } from '../../src/schema/types.js';

// ─── cosineSimilarity ─────────────────────────────────────────────────────────

describe('cosineSimilarity', () => {
  it('returns 1.0 for identical vectors', () => {
    expect(cosineSimilarity([1, 0, 1], [1, 0, 1])).toBeCloseTo(1.0);
  });

  it('returns 0.0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0.0);
  });

  it('returns 0.0 for zero vector', () => {
    expect(cosineSimilarity([0, 0, 0], [1, 0, 1])).toBe(0);
  });

  it('returns value between 0 and 1 for related vectors', () => {
    const score = cosineSimilarity([1, 1, 0], [1, 0, 1]);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it('returns 0 when the second vector is all zeros', () => {
    expect(cosineSimilarity([1, 2, 3], [0, 0, 0])).toBe(0);
  });

  it('is symmetric', () => {
    const a = [0.5, 0.3, 0.2];
    const b = [0.1, 0.8, 0.4];
    expect(cosineSimilarity(a, b)).toBeCloseTo(cosineSimilarity(b, a));
  });
});

// ─── buildTfIdfEmbedding ──────────────────────────────────────────────────────

describe('buildTfIdfEmbedding', () => {
  it('produces non-zero vector for matching vocabulary words', () => {
    const vocab = ['auth', 'login', 'user', 'password'];
    const v = buildTfIdfEmbedding('user login authentication', vocab);
    expect(v.some((x) => x > 0)).toBe(true);
  });

  it('filters stopwords', () => {
    // "the" and "is" should not affect result
    const vocab = ['auth'];
    const v1 = buildTfIdfEmbedding('the auth is working', vocab);
    const v2 = buildTfIdfEmbedding('auth', vocab);
    expect(v1).toEqual(v2);
  });

  it('returns L2-normalized vector', () => {
    const vocab = ['auth', 'login'];
    const v = buildTfIdfEmbedding('auth login', vocab);
    const magnitude = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    expect(magnitude).toBeCloseTo(1.0, 5);
  });

  it('returns all-zeros for text with no vocabulary words', () => {
    const vocab = ['auth', 'login'];
    const v = buildTfIdfEmbedding('xyz qwerty', vocab);
    expect(v.every((x) => x === 0)).toBe(true);
  });

  it('returns zero vector for empty vocabulary', () => {
    const v = buildTfIdfEmbedding('auth login user', []);
    expect(v).toHaveLength(0);
  });

  it('higher TF for repeated words', () => {
    const vocab = ['auth', 'login'];
    const v = buildTfIdfEmbedding('auth auth auth login', vocab);
    const authIdx = vocab.indexOf('auth');
    const loginIdx = vocab.indexOf('login');
    expect(v[authIdx]).toBeGreaterThan(v[loginIdx] ?? 0);
  });
});

// ─── buildVocabulary ──────────────────────────────────────────────────────────

describe('buildVocabulary', () => {
  it('returns words from labels and summaries', () => {
    const nodes: SprangNode[] = [
      { id: 'file:auth.ts', type: 'file', label: 'auth.ts', summary: 'Authentication logic' },
    ];
    const vocab = buildVocabulary(nodes);
    expect(vocab).toContain('authentication');
    expect(vocab).toContain('logic');
  });

  it('excludes stopwords', () => {
    const nodes: SprangNode[] = [
      { id: 'file:a.ts', type: 'file', label: 'the file', summary: 'this is a test' },
    ];
    const vocab = buildVocabulary(nodes);
    expect(vocab).not.toContain('the');
    expect(vocab).not.toContain('this');
    expect(vocab).not.toContain('is');
    expect(vocab).not.toContain('a');
  });

  it('returns at most 500 words', () => {
    // Generate >500 unique words
    const nodes: SprangNode[] = Array.from({ length: 600 }, (_, i) => ({
      id: `file:${i}.ts`,
      type: 'file' as const,
      label: `uniqueword${i}`,
    }));
    const vocab = buildVocabulary(nodes);
    expect(vocab.length).toBeLessThanOrEqual(500);
  });

  it('returns sorted unique list', () => {
    const nodes: SprangNode[] = [
      { id: 'file:b.ts', type: 'file', label: 'beta alpha', summary: 'gamma alpha' },
    ];
    const vocab = buildVocabulary(nodes);
    const sorted = [...vocab].sort();
    expect(vocab).toEqual(sorted);
    // Each word should appear only once
    expect(new Set(vocab).size).toBe(vocab.length);
  });

  it('returns empty array for empty nodes', () => {
    expect(buildVocabulary([])).toHaveLength(0);
  });
});

// ─── semanticSearch ───────────────────────────────────────────────────────────

describe('semanticSearch', () => {
  const nodes: SprangNode[] = [
    { id: 'file:auth.ts', type: 'file', label: 'auth.ts', summary: 'Authentication and login' },
    { id: 'file:cart.ts', type: 'file', label: 'cart.ts', summary: 'Shopping cart logic' },
    { id: 'file:user.ts', type: 'file', label: 'user.ts', summary: 'User profile management' },
  ];

  it('returns auth-related nodes for "authentication" query', () => {
    const results = semanticSearch('authentication login', nodes, null);
    expect(results[0]?.nodeId).toBe('file:auth.ts');
  });

  it('respects limit option', () => {
    const results = semanticSearch('user', nodes, null, { limit: 1 });
    expect(results.length).toBeLessThanOrEqual(1);
  });

  it('uses stored embeddings when provided', () => {
    // Pre-computed embedding for auth node that matches "login" perfectly
    const stored = { 'file:auth.ts': [1, 0, 0], 'file:cart.ts': [0, 1, 0] };
    const results = semanticSearch('login', nodes, stored, { threshold: 0 });
    // Should use stored embeddings, not recompute
    expect(results.length).toBeGreaterThan(0);
  });

  it('falls back to TF-IDF when no stored embeddings', () => {
    const results = semanticSearch('cart shopping', nodes, null, { threshold: 0 });
    expect(results.length).toBeGreaterThan(0);
  });

  it('respects threshold option — returns nothing below threshold', () => {
    // Set extremely high threshold so nothing passes
    const results = semanticSearch('authentication', nodes, null, { threshold: 0.9999 });
    // Either empty or every result is above threshold
    for (const r of results) {
      expect(r.score).toBeGreaterThanOrEqual(0.9999);
    }
  });

  it('returns results sorted by score descending', () => {
    const results = semanticSearch('user profile', nodes, null, { threshold: 0 });
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1]!.score).toBeGreaterThanOrEqual(results[i]!.score);
    }
  });

  it('returns score between 0 and 1', () => {
    const results = semanticSearch('authentication', nodes, null, { threshold: 0 });
    for (const r of results) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1);
    }
  });

  it('returns empty array for empty nodes', () => {
    const results = semanticSearch('auth', [], null, { threshold: 0 });
    expect(results).toHaveLength(0);
  });

  it('falls back gracefully when storedEmbeddings is empty object', () => {
    const results = semanticSearch('cart', nodes, {}, { threshold: 0 });
    // Empty stored → TF-IDF fallback
    expect(results.length).toBeGreaterThan(0);
  });
});
