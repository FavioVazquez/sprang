/**
 * Retrieval metrics for the self-hosted evaluation harness.
 *
 * Four of the five functions here are the standard IR battery — recall@k,
 * precision@k, MRR, nDCG@k. They are included because they are comparable
 * with published numbers and because they decompose a regression: if recall@50
 * holds but nDCG@10 falls, the retriever still finds the right files and has
 * merely stopped ranking them well.
 *
 * But the metric that actually predicts whether Sprang helps an agent is
 * {@link recallAtBudget}. An agent does not consume "the top 10 results"; it
 * consumes as much as fits in a context window. A retriever that puts the
 * right file at rank 3 behind two 4,000-token files has failed in practice
 * while scoring a perfect recall@5. Report recall@budget as the headline and
 * treat the rest as diagnostics.
 *
 * Conventions applied uniformly, so numbers are comparable across runs:
 *  - Retrieved lists are de-duplicated, first occurrence wins. A retriever
 *    cannot inflate recall@10 by returning the same file ten times.
 *  - Ground truth is de-duplicated the same way.
 *  - `k` larger than the list is fine: it degrades to "the whole list".
 *  - An empty ground truth scores 0 for every metric. There is nothing to
 *    find, so there is no credit to give; scoring it 1 (the other common
 *    convention) would let a dataset full of empty labels report perfection.
 *  - `k <= 0` scores 0.
 *  - Comparison is exact string equality on paths. Normalise before calling.
 */

export interface RetrievalResult {
  query: string;
  retrieved: string[];
  groundTruth: string[];
}

/** Aggregate over a whole dataset. Means, not micro-averages. */
export interface Aggregate {
  n: number;
  recallAt: Record<number, number>;
  mrr: number;
  ndcgAt: Record<number, number>;
}

/** The `k` values reported when a caller does not choose their own. */
export const DEFAULT_KS: readonly number[] = [1, 5, 10, 20];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** De-duplicate while preserving order; first occurrence wins. */
function dedupe(items: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

interface Normalized {
  retrieved: string[];
  truth: Set<string>;
  truthSize: number;
}

function normalize(r: RetrievalResult): Normalized {
  const truth = new Set(r.groundTruth);
  return { retrieved: dedupe(r.retrieved), truth, truthSize: truth.size };
}

// ─── Metrics ─────────────────────────────────────────────────────────────────

/**
 * Fraction of the ground truth present in the top `k` results.
 *
 * The ceiling metric: if recall@k is low, no amount of re-ranking can save the
 * pipeline, because the right file is not in the candidate set at all.
 */
export function recallAtK(r: RetrievalResult, k: number): number {
  const { retrieved, truth, truthSize } = normalize(r);
  if (truthSize === 0 || k <= 0) return 0;

  let hits = 0;
  for (const path of retrieved.slice(0, k)) {
    if (truth.has(path)) hits += 1;
  }
  return hits / truthSize;
}

/**
 * Fraction of the top `k` results that are relevant.
 *
 * The noise metric, and the counterweight to recall: returning the entire
 * repository gives perfect recall and precision near zero, and every token of
 * that noise displaces something useful from the agent's context.
 *
 * Denominator is `min(k, |retrieved|)`, so a retriever that returns 3 results
 * for k=10 is not punished for the 7 it did not fabricate.
 */
export function precisionAtK(r: RetrievalResult, k: number): number {
  const { retrieved, truth, truthSize } = normalize(r);
  if (truthSize === 0 || k <= 0 || retrieved.length === 0) return 0;

  const window = retrieved.slice(0, k);
  let hits = 0;
  for (const path of window) {
    if (truth.has(path)) hits += 1;
  }
  return hits / window.length;
}

/**
 * 1 / rank of the first relevant result, or 0 if none is relevant.
 *
 * Answers "how far down did the developer have to read before hitting
 * something useful?". Averaged over a dataset this is MRR.
 */
export function reciprocalRank(r: RetrievalResult): number {
  const { retrieved, truth, truthSize } = normalize(r);
  if (truthSize === 0) return 0;

  for (let i = 0; i < retrieved.length; i += 1) {
    const path = retrieved[i];
    if (path !== undefined && truth.has(path)) return 1 / (i + 1);
  }
  return 0;
}

/**
 * Normalised discounted cumulative gain at `k`, binary relevance.
 *
 * DCG = Σ rel_i / log2(i + 1) over ranks i = 1..k, normalised by the ideal
 * DCG (all relevant items packed at the top). Unlike recall@k it distinguishes
 * "right file at rank 1" from "right file at rank 10", which is exactly the
 * difference a re-ranker is supposed to make.
 */
export function ndcgAtK(r: RetrievalResult, k: number): number {
  const { retrieved, truth, truthSize } = normalize(r);
  if (truthSize === 0 || k <= 0) return 0;

  let dcg = 0;
  const window = retrieved.slice(0, k);
  for (let i = 0; i < window.length; i += 1) {
    const path = window[i];
    if (path !== undefined && truth.has(path)) dcg += 1 / Math.log2(i + 2);
  }
  if (dcg === 0) return 0;

  let idcg = 0;
  for (let i = 0; i < Math.min(k, truthSize); i += 1) idcg += 1 / Math.log2(i + 2);
  if (idcg === 0) return 0;

  return dcg / idcg;
}

/**
 * **The metric that matters.** Fill a token budget with the retrieved files in
 * rank order; what fraction of the ground truth got in?
 *
 * This is the only metric here that models what actually happens downstream:
 * a context window of finite size is packed greedily from the top of the
 * ranking, and whatever does not fit never reaches the model. It folds ranking
 * quality and result *size* into one number, so a retriever that ranks a
 * 5,000-token generated file above the 60-token fix site is correctly scored
 * as worse than one that does not.
 *
 * Greedy prefix semantics: items are taken in order and the walk stops at the
 * first item that does not fit. It does not skip ahead to pack smaller items,
 * because a real context assembler streaming results in rank order cannot see
 * the future either. Consequently a budget smaller than the first item scores
 * 0 — which is the honest answer.
 *
 * @param tokensOf token cost of a path; negative costs are clamped to 0.
 * @param budget   total tokens available.
 */
export function recallAtBudget(
  r: RetrievalResult,
  tokensOf: (path: string) => number,
  budget: number,
): number {
  const { retrieved, truth, truthSize } = normalize(r);
  if (truthSize === 0 || budget <= 0) return 0;

  let spent = 0;
  let hits = 0;
  for (const path of retrieved) {
    const raw = tokensOf(path);
    const cost = Number.isFinite(raw) ? Math.max(0, raw) : Number.POSITIVE_INFINITY;
    if (spent + cost > budget) break;
    spent += cost;
    if (truth.has(path)) hits += 1;
  }
  return hits / truthSize;
}

/**
 * Mean of the per-query metrics over a dataset.
 *
 * Macro-averaged: every query counts once, regardless of how many files it
 * touched. A micro-average would let the handful of five-file commits dominate
 * the score.
 */
export function aggregate(results: RetrievalResult[], ks: number[] = [...DEFAULT_KS]): Aggregate {
  const n = results.length;
  const recallAt: Record<number, number> = {};
  const ndcgAt: Record<number, number> = {};

  for (const k of ks) {
    recallAt[k] = 0;
    ndcgAt[k] = 0;
  }
  if (n === 0) return { n: 0, recallAt, mrr: 0, ndcgAt };

  let mrrSum = 0;
  for (const result of results) {
    mrrSum += reciprocalRank(result);
    for (const k of ks) {
      recallAt[k] = (recallAt[k] ?? 0) + recallAtK(result, k);
      ndcgAt[k] = (ndcgAt[k] ?? 0) + ndcgAtK(result, k);
    }
  }

  for (const k of ks) {
    recallAt[k] = (recallAt[k] ?? 0) / n;
    ndcgAt[k] = (ndcgAt[k] ?? 0) / n;
  }
  return { n, recallAt, mrr: mrrSum / n, ndcgAt };
}
