import type { KnowledgeGraph } from '../schema/types.js';
import { selectContext } from '../context/select.js';
import { rankGraph } from '../graph/rank.js';
import { aggregate, type Aggregate, type RetrievalResult } from './metrics.js';
import type { EvalExample } from './dataset.js';

/**
 * The ablation ladder.
 *
 * Sprang has four layers — keyword matching, the dependency graph, behavioural
 * history, and PageRank reranking — and no evidence about which of them earn
 * their keep. Reporting a single number for "Sprang" would hide that. Running
 * the same examples through progressively richer arms shows exactly where the
 * value comes from, and would show just as clearly if a layer contributed
 * nothing.
 *
 * Every arm receives an identical dataset and is scored identically, so the
 * only variable is the retrieval strategy.
 */
export type ArmName =
  | 'random'
  | 'keyword'
  | 'pagerank'
  | 'keyword+graph'
  | 'full';

export interface ArmResult {
  arm: ArmName;
  aggregate: Aggregate;
  /** Mean milliseconds per query. A slower arm has to earn it. */
  meanLatencyMs: number;
}

export interface EvalRunResult {
  examples: number;
  arms: ArmResult[];
  ks: number[];
}

/** Deterministic pseudo-random ordering, so the floor arm is reproducible. */
function seededShuffle<T>(items: T[], seed: number): T[] {
  const out = [...items];
  let state = seed || 1;
  for (let i = out.length - 1; i > 0; i--) {
    // xorshift32 — tiny, deterministic, good enough for a control arm.
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    const j = Math.abs(state) % (i + 1);
    const a = out[i];
    const b = out[j];
    if (a !== undefined && b !== undefined) {
      out[i] = b;
      out[j] = a;
    }
  }
  return out;
}

function filePaths(graph: KnowledgeGraph): string[] {
  const paths: string[] = [];
  for (const node of graph.nodes) {
    if (node.type !== 'file') continue;
    const path = node.location?.file ?? node.id.replace(/^file:/, '');
    if (path) paths.push(path);
  }
  return paths.sort();
}

/**
 * Naive path-substring search — what an agent does with grep and no index.
 *
 * This is the arm everything else has to beat. If a graph, a ranking algorithm
 * and a history analysis cannot outperform substring matching on file paths,
 * none of it is worth the complexity.
 */
function keywordArm(graph: KnowledgeGraph, query: string): string[] {
  const tokens = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 4);
  const scored: Array<{ path: string; score: number }> = [];
  for (const path of filePaths(graph)) {
    const lower = path.toLowerCase();
    let score = 0;
    for (const token of tokens) if (lower.includes(token)) score += 1;
    if (score > 0) scored.push({ path, score });
  }
  scored.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  return scored.map((s) => s.path);
}

/** Structural importance alone, ignoring the query entirely. */
function pagerankArm(graph: KnowledgeGraph): string[] {
  const { fileRank } = rankGraph(graph);
  return Array.from(fileRank.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([path]) => path);
}

/** Keyword hits, then their dependency neighbours. No ranking, no history. */
function keywordGraphArm(graph: KnowledgeGraph, query: string): string[] {
  const seeds = keywordArm(graph, query).slice(0, 10);
  const seen = new Set(seeds);
  const adjacency = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    const set = adjacency.get(a) ?? new Set<string>();
    set.add(b);
    adjacency.set(a, set);
  };
  for (const edge of graph.edges) {
    if (edge.type !== 'imports' && edge.type !== 'calls') continue;
    const from = edge.source.replace(/^file:/, '').split(':')[0] ?? '';
    const to = edge.target.replace(/^file:/, '').split(':')[0] ?? '';
    if (!from || !to) continue;
    link(from, to);
    link(to, from);
  }
  const out = [...seeds];
  for (const seed of seeds) {
    for (const neighbour of adjacency.get(seed) ?? []) {
      if (seen.has(neighbour)) continue;
      seen.add(neighbour);
      out.push(neighbour);
    }
  }
  return out;
}

const ARM_ORDER: ArmName[] = ['random', 'keyword', 'pagerank', 'keyword+graph', 'full'];

/** Run every arm over the dataset and score them identically. */
export function runEval(
  graph: KnowledgeGraph,
  examples: EvalExample[],
  opts: { ks?: number[]; arms?: ArmName[]; budgetTokens?: number } = {},
): EvalRunResult {
  const ks = opts.ks ?? [1, 5, 10, 20];
  const arms = opts.arms ?? ARM_ORDER;
  const budget = opts.budgetTokens ?? 100_000;
  const allPaths = filePaths(graph);

  const results: ArmResult[] = [];
  for (const arm of arms) {
    const perQuery: RetrievalResult[] = [];
    const start = Date.now();

    for (let i = 0; i < examples.length; i++) {
      const example = examples[i];
      if (!example) continue;
      let retrieved: string[];
      switch (arm) {
        case 'random':
          retrieved = seededShuffle(allPaths, i + 1);
          break;
        case 'keyword':
          retrieved = keywordArm(graph, example.query);
          break;
        case 'pagerank':
          retrieved = pagerankArm(graph);
          break;
        case 'keyword+graph':
          retrieved = keywordGraphArm(graph, example.query);
          break;
        case 'full':
          retrieved = selectContext(graph, {
            task: example.query,
            budgetTokens: budget,
            limit: 50,
          }).items.map((item) => item.path);
          break;
      }
      perQuery.push({
        query: example.query,
        retrieved: Array.from(new Set(retrieved)),
        groundTruth: example.groundTruth,
      });
    }

    const elapsed = Date.now() - start;
    results.push({
      arm,
      aggregate: aggregate(perQuery, ks),
      meanLatencyMs: examples.length > 0 ? Math.round((elapsed / examples.length) * 100) / 100 : 0,
    });
  }

  return { examples: examples.length, arms: results, ks };
}

/** Markdown table. The point is that a user can paste it into an issue. */
export function formatEvalReport(result: EvalRunResult): string {
  const { ks } = result;
  const header = ['arm', ...ks.map((k) => `R@${k}`), 'MRR', ...ks.map((k) => `nDCG@${k}`), 'ms/query'];
  const rows = result.arms.map((a) => [
    a.arm,
    ...ks.map((k) => (a.aggregate.recallAt[k] ?? 0).toFixed(3)),
    a.aggregate.mrr.toFixed(3),
    ...ks.map((k) => (a.aggregate.ndcgAt[k] ?? 0).toFixed(3)),
    String(a.meanLatencyMs),
  ]);

  const widths = header.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)),
  );
  const line = (cells: string[]) =>
    '| ' + cells.map((c, i) => c.padEnd(widths[i] ?? c.length)).join(' | ') + ' |';

  const out = [
    line(header),
    '|' + widths.map((w) => '-'.repeat(w + 2)).join('|') + '|',
    ...rows.map(line),
  ];

  const full = result.arms.find((a) => a.arm === 'full');
  const keyword = result.arms.find((a) => a.arm === 'keyword');
  if (full && keyword) {
    const k = ks.includes(10) ? 10 : (ks[ks.length - 1] ?? 10);
    const gain = keyword.aggregate.recallAt[k]
      ? (full.aggregate.recallAt[k] ?? 0) / (keyword.aggregate.recallAt[k] ?? 1)
      : 0;
    out.push('');
    out.push(
      `n = ${result.examples} examples mined from this repository's own bug-fix history. ` +
        (gain > 0
          ? `Full pipeline is ${gain.toFixed(1)}x the keyword baseline at R@${k}.`
          : 'The keyword baseline was not beaten — investigate before shipping.'),
    );
    if (result.examples < 50) {
      out.push(
        `Sample is small (n < 50); treat the ordering as indicative and widen the window ` +
          `with --since-months before drawing conclusions.`,
      );
    }
  }
  return out.join('\n');
}
