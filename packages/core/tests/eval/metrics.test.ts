import { describe, it, expect } from 'vitest';
import {
  recallAtK,
  precisionAtK,
  reciprocalRank,
  ndcgAtK,
  recallAtBudget,
  aggregate,
  DEFAULT_KS,
} from '../../src/eval/metrics.js';
import type { RetrievalResult } from '../../src/eval/metrics.js';

function result(retrieved: string[], groundTruth: string[], query = 'q'): RetrievalResult {
  return { query, retrieved, groundTruth };
}

/** Hand-computed discount weights, kept literal so a refactor cannot drift. */
const D1 = 1 / Math.log2(2); // 1
const D2 = 1 / Math.log2(3);
const D3 = 1 / Math.log2(4);

describe('recallAtK', () => {
  it('counts the fraction of ground truth inside the top k', () => {
    const r = result(['a', 'b', 'c', 'd'], ['a', 'd']);
    expect(recallAtK(r, 1)).toBe(0.5);
    expect(recallAtK(r, 4)).toBe(1);
  });

  it('is 0 when nothing relevant is in the window', () => {
    expect(recallAtK(result(['x', 'y'], ['a']), 2)).toBe(0);
  });

  it('treats k larger than the retrieved list as the whole list', () => {
    const r = result(['a', 'b'], ['a', 'z']);
    expect(recallAtK(r, 1000)).toBe(0.5);
  });

  it('returns 0 for empty ground truth', () => {
    expect(recallAtK(result(['a'], []), 5)).toBe(0);
  });

  it('returns 0 for an empty retrieved list', () => {
    expect(recallAtK(result([], ['a']), 5)).toBe(0);
  });

  it('returns 0 for k <= 0', () => {
    expect(recallAtK(result(['a'], ['a']), 0)).toBe(0);
    expect(recallAtK(result(['a'], ['a']), -3)).toBe(0);
  });

  it('cannot be inflated by duplicate retrieved paths', () => {
    // Ten copies of one correct file must not fill a k=10 window.
    const r = result(Array.from({ length: 10 }, () => 'a'), ['a', 'b']);
    expect(recallAtK(r, 10)).toBe(0.5);
  });

  it('de-duplicates the ground truth as well', () => {
    expect(recallAtK(result(['a'], ['a', 'a', 'a']), 5)).toBe(1);
  });
});

describe('precisionAtK', () => {
  it('divides hits by the size of the window actually returned', () => {
    // 2 of the 3 returned are relevant, even though k = 10.
    const r = result(['a', 'x', 'b'], ['a', 'b']);
    expect(precisionAtK(r, 10)).toBeCloseTo(2 / 3, 12);
  });

  it('uses k as the denominator when the list is longer than k', () => {
    const r = result(['a', 'x', 'b', 'y'], ['a', 'b']);
    expect(precisionAtK(r, 2)).toBe(0.5);
  });

  it('is 0 for empty retrieved, empty truth and k <= 0', () => {
    expect(precisionAtK(result([], ['a']), 5)).toBe(0);
    expect(precisionAtK(result(['a'], []), 5)).toBe(0);
    expect(precisionAtK(result(['a'], ['a']), 0)).toBe(0);
  });

  it('drops to near zero when the retriever returns the whole repo', () => {
    const everything = Array.from({ length: 100 }, (_, i) => `f${i}.ts`);
    const r = result(everything, ['f0.ts']);
    expect(recallAtK(r, 100)).toBe(1);
    expect(precisionAtK(r, 100)).toBe(0.01);
  });
});

describe('reciprocalRank', () => {
  it('is 1 / rank of the first relevant result', () => {
    expect(reciprocalRank(result(['a'], ['a']))).toBe(1);
    expect(reciprocalRank(result(['x', 'a'], ['a']))).toBe(0.5);
    expect(reciprocalRank(result(['x', 'y', 'a'], ['a']))).toBeCloseTo(1 / 3, 12);
  });

  it('is 0 when nothing relevant was retrieved, or truth is empty', () => {
    expect(reciprocalRank(result(['x'], ['a']))).toBe(0);
    expect(reciprocalRank(result([], ['a']))).toBe(0);
    expect(reciprocalRank(result(['a'], []))).toBe(0);
  });

  it('ignores duplicates when computing the rank', () => {
    // 'x' repeated three times occupies one rank, not three.
    expect(reciprocalRank(result(['x', 'x', 'x', 'a'], ['a']))).toBe(0.5);
  });
});

describe('ndcgAtK', () => {
  it('is 1 when all relevant items are packed at the top', () => {
    expect(ndcgAtK(result(['a', 'b', 'x'], ['a', 'b']), 3)).toBeCloseTo(1, 12);
  });

  it('matches a hand-computed value for an interleaved ranking', () => {
    // rel at ranks 1 and 3 → DCG = 1 + 1/log2(4); IDCG = 1 + 1/log2(3)
    const r = result(['a', 'x', 'b'], ['a', 'b']);
    expect(ndcgAtK(r, 3)).toBeCloseTo((D1 + D3) / (D1 + D2), 12);
  });

  it('penalises a late hit relative to an early one', () => {
    const early = ndcgAtK(result(['a', 'x', 'y'], ['a']), 3);
    const late = ndcgAtK(result(['x', 'y', 'a'], ['a']), 3);
    expect(early).toBe(1);
    expect(late).toBeCloseTo(D3, 12);
    expect(late).toBeLessThan(early);
  });

  it('caps the ideal DCG at k when there are more relevant files than k', () => {
    // 3 relevant files, k = 1, one hit at rank 1 → IDCG is a single item → 1.
    expect(ndcgAtK(result(['a', 'b', 'c'], ['a', 'b', 'c']), 1)).toBe(1);
  });

  it('is 0 for empty truth, empty retrieved, k <= 0 and no hits', () => {
    expect(ndcgAtK(result(['a'], []), 5)).toBe(0);
    expect(ndcgAtK(result([], ['a']), 5)).toBe(0);
    expect(ndcgAtK(result(['a'], ['a']), 0)).toBe(0);
    expect(ndcgAtK(result(['x', 'y'], ['a']), 5)).toBe(0);
  });

  it('handles k larger than the retrieved list', () => {
    expect(ndcgAtK(result(['a'], ['a']), 50)).toBe(1);
  });
});

describe('recallAtBudget', () => {
  const tokens: Record<string, number> = { small: 10, mid: 100, huge: 5000 };
  const cost = (p: string): number => tokens[p] ?? 50;

  it('measures recall among the items that fit', () => {
    const r = result(['small', 'mid', 'huge'], ['small', 'huge']);
    // Budget 200 fits small + mid (110); huge would overflow.
    expect(recallAtBudget(r, cost, 200)).toBe(0.5);
  });

  it('is 1 when the whole ground truth fits', () => {
    const r = result(['small', 'mid'], ['small', 'mid']);
    expect(recallAtBudget(r, cost, 1000)).toBe(1);
  });

  it('is 0 when the budget is smaller than the very first item', () => {
    const r = result(['huge', 'small'], ['small']);
    expect(recallAtBudget(r, cost, 10)).toBe(0);
  });

  it('stops at the first item that does not fit rather than packing ahead', () => {
    // 'small' is relevant and would fit in the leftover, but the greedy walk
    // halts at 'huge' — exactly what a rank-order context assembler does.
    const r = result(['huge', 'small'], ['small']);
    expect(recallAtBudget(r, cost, 4999)).toBe(0);
  });

  it('rewards the retriever that ranks the cheap correct file first', () => {
    const good = result(['small', 'huge'], ['small']);
    const bad = result(['huge', 'small'], ['small']);
    expect(recallAtBudget(good, cost, 1000)).toBe(1);
    expect(recallAtBudget(bad, cost, 1000)).toBe(0);
    // Both look identical to recall@5 — this is the point of the metric.
    expect(recallAtK(good, 5)).toBe(recallAtK(bad, 5));
  });

  it('is 0 for empty truth, empty retrieved and non-positive budgets', () => {
    expect(recallAtBudget(result(['small'], []), cost, 100)).toBe(0);
    expect(recallAtBudget(result([], ['small']), cost, 100)).toBe(0);
    expect(recallAtBudget(result(['small'], ['small']), cost, 0)).toBe(0);
    expect(recallAtBudget(result(['small'], ['small']), cost, -5)).toBe(0);
  });

  it('clamps negative token costs to zero and does not double-count duplicates', () => {
    const r = result(['small', 'small', 'mid'], ['small', 'mid']);
    expect(recallAtBudget(r, () => -1, 1)).toBe(1);
    expect(recallAtBudget(r, cost, 110)).toBe(1);
  });

  it('treats a non-finite token cost as unaffordable', () => {
    const r = result(['huge'], ['huge']);
    expect(recallAtBudget(r, () => Number.NaN, 1_000_000)).toBe(0);
  });
});

describe('aggregate', () => {
  it('macro-averages each metric over the dataset', () => {
    const results = [
      result(['a', 'x'], ['a']), // recall@1 = 1, rr = 1
      result(['x', 'b'], ['b']), // recall@1 = 0, rr = 0.5
    ];
    const agg = aggregate(results, [1, 2]);
    expect(agg.n).toBe(2);
    expect(agg.recallAt[1]).toBe(0.5);
    expect(agg.recallAt[2]).toBe(1);
    expect(agg.mrr).toBe(0.75);
    expect(agg.ndcgAt[2]).toBeCloseTo((1 + D2) / 2, 12);
  });

  it('returns zeroed buckets for an empty dataset without dividing by zero', () => {
    const agg = aggregate([], [1, 5]);
    expect(agg.n).toBe(0);
    expect(agg.mrr).toBe(0);
    expect(agg.recallAt[1]).toBe(0);
    expect(agg.ndcgAt[5]).toBe(0);
    expect(Number.isNaN(agg.mrr)).toBe(false);
  });

  it('uses the default k values when none are given', () => {
    const agg = aggregate([result(['a'], ['a'])]);
    for (const k of DEFAULT_KS) {
      expect(agg.recallAt[k]).toBe(1);
      expect(agg.ndcgAt[k]).toBe(1);
    }
  });

  it('does not mutate the caller ks array or the results', () => {
    const ks = [1, 3];
    const results = [result(['a', 'b'], ['b'])];
    const before = JSON.stringify(results);
    aggregate(results, ks);
    expect(ks).toEqual([1, 3]);
    expect(JSON.stringify(results)).toBe(before);
  });
});
