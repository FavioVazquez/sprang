import type { KnowledgeGraph, SprangNode } from '../schema/types.js';
import { rankGraph } from '../graph/rank.js';

/**
 * Multi-channel context selection with a hard token budget.
 *
 * The problem this solves is not retrieval — an agent with grep can find code.
 * It is *allocation*: a repository holds millions of tokens, the window holds
 * a hundred thousand, and models measurably degrade as context grows even
 * within their nominal limit (the "lost in the middle" effect). Putting less,
 * better-chosen material in the window beats putting more.
 *
 * So the job is to spend a budget well, and to be able to explain how it was
 * spent. Four channels propose candidates, reciprocal-rank fusion merges them
 * without needing their scores to be comparable, personalized PageRank reranks
 * by structural importance, and the result is packed to fit.
 *
 * Every returned item carries the channels that found it and its distance from
 * a seed. A vector database cannot tell you why something surfaced; a graph
 * can, and that explainability is the difference between a tool an engineer
 * trusts and one they second-guess.
 */

export interface ContextRequest {
  /** What the agent is trying to do, in its own words. */
  task: string;
  /** Rough token ceiling for the returned material. */
  budgetTokens?: number;
  /** Files already open or being edited. Strong relevance prior. */
  seedFiles?: string[];
  /** Identifiers named in the task, if the caller has already extracted them. */
  mentionedIdents?: string[];
  /** Maximum items to return regardless of budget. */
  limit?: number;
}

export type Channel = 'exact-symbol' | 'keyword' | 'graph' | 'behavioral' | 'seed';

export interface ContextItem {
  nodeId: string;
  path: string;
  kind: string;
  /** Fused relevance, 0–1 after normalisation. */
  score: number;
  /** Which channels proposed this. Explains why it is here. */
  channels: Channel[];
  /** Hops from the nearest seed file, when reached through the graph. */
  hopsFromSeed?: number;
  riskScore?: number;
  estimatedTokens: number;
}

export interface ContextResult {
  task: string;
  budgetTokens: number;
  usedTokens: number;
  items: ContextItem[];
  /** Candidates that did not fit, so the caller knows what was cut. */
  omitted: number;
  /** How the budget was spent, for the agent and for debugging. */
  explanation: string;
}

/**
 * Words that carry no locating power in a task description.
 *
 * A task reads like "add a new MCP tool that reports change coupling". Without
 * this list, "add" matches every `add` function in the repository — and there
 * are dozens, mostly in fixtures — which buries the one file the query is
 * actually about. English stopwords plus the generic verbs and nouns that
 * appear in almost every engineering request.
 */
const QUERY_STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'to', 'of', 'in', 'on', 'at', 'for', 'with', 'from',
  'that', 'this', 'these', 'those', 'it', 'is', 'are', 'was', 'be', 'been', 'as', 'by', 'so',
  'add', 'new', 'make', 'create', 'update', 'change', 'fix', 'remove', 'delete', 'set', 'get',
  'use', 'using', 'should', 'need', 'want', 'please', 'can', 'will', 'when', 'where', 'how',
  'code', 'file', 'files', 'function', 'method', 'class', 'test', 'tests', 'value', 'data',
  'run', 'call', 'return', 'init', 'main', 'handle', 'do', 'does', 'work', 'works', 'thing',
]);

/**
 * An identifier defined in more than this many files is generic noise.
 *
 * `add`, `run`, `parse` and friends appear everywhere; a match on one says
 * nothing about where the answer is. Aider applies the same demotion for the
 * same reason.
 */
const GENERIC_SYMBOL_THRESHOLD = 3;

/** RRF constant from Cormack et al. (SIGIR 2009). Robust; rarely worth tuning. */
const RRF_K = 60;

const DEFAULT_BUDGET = 8000;

/** Channel weights. Exact symbol matches dominate; behavioural is a nudge. */
const CHANNEL_WEIGHTS: Record<Channel, number> = {
  'exact-symbol': 2.0,
  seed: 1.8,
  graph: 1.5,
  keyword: 1.0,
  behavioral: 0.8,
};

/**
 * Split an identifier the way a developer reads it.
 *
 * `parseConfigFile` has to match a query saying "config" or "parse", and
 * `snake_case_name` the same. Keeping the whole token as well means an exact
 * match still outranks a partial one.
 */
export function tokenizeIdentifier(text: string): string[] {
  const out = new Set<string>();
  for (const raw of text.split(/[^A-Za-z0-9_$-]+/)) {
    if (!raw) continue;
    const lower = raw.toLowerCase();
    out.add(lower);
    for (const part of raw.split(/[_\-.]|(?<=[a-z0-9])(?=[A-Z])/)) {
      const p = part.toLowerCase();
      if (p.length >= 2) out.add(p);
    }
  }
  return Array.from(out);
}

function pathOf(node: SprangNode): string {
  return node.location?.file ?? node.id.replace(/^(file|function|class):/, '').split(':')[0] ?? '';
}

function nameOf(node: SprangNode): string {
  return (node as { name?: string }).name ?? node.label ?? node.id;
}

/** Reciprocal-rank fusion: rank-based, so channel scores need no calibration. */
function fuse(rankings: Array<{ channel: Channel; ordered: string[] }>): Map<
  string,
  { score: number; channels: Channel[] }
> {
  const fused = new Map<string, { score: number; channels: Channel[] }>();
  for (const { channel, ordered } of rankings) {
    const weight = CHANNEL_WEIGHTS[channel];
    for (let i = 0; i < ordered.length; i++) {
      const id = ordered[i];
      if (!id) continue;
      const entry = fused.get(id) ?? { score: 0, channels: [] };
      entry.score += weight / (RRF_K + i + 1);
      if (!entry.channels.includes(channel)) entry.channels.push(channel);
      fused.set(id, entry);
    }
  }
  return fused;
}

/** Nodes whose name matches a query token exactly. Highest-precision channel. */
function exactSymbolChannel(graph: KnowledgeGraph, tokens: Set<string>): string[] {
  // How many distinct files define each name, so generic ones can be dropped.
  const definedIn = new Map<string, Set<string>>();
  for (const node of graph.nodes) {
    if (node.type !== 'function' && node.type !== 'class') continue;
    const name = nameOf(node).toLowerCase();
    const files = definedIn.get(name) ?? new Set<string>();
    files.add(pathOf(node));
    definedIn.set(name, files);
  }

  const hits: Array<{ id: string; len: number }> = [];
  for (const node of graph.nodes) {
    if (node.type !== 'function' && node.type !== 'class') continue;
    const name = nameOf(node).toLowerCase();
    if (!tokens.has(name)) continue;
    if ((definedIn.get(name)?.size ?? 0) > GENERIC_SYMBOL_THRESHOLD) continue;
    hits.push({ id: node.id, len: name.length });
  }
  // Longer names are more distinctive, so a match on one means more.
  hits.sort((a, b) => b.len - a.len || a.id.localeCompare(b.id));
  return hits.map((h) => h.id);
}

/** Token overlap against name, path and summary. The cheap broad net. */
function keywordChannel(graph: KnowledgeGraph, tokens: Set<string>): string[] {
  const scored: Array<{ id: string; score: number }> = [];
  for (const node of graph.nodes) {
    // Path tokens are weighted separately below: a query mentioning "mcp" and
    // "coupling" should find `packages/mcp/src/tools/sprang_coupled.ts` on the
    // strength of its location alone, which is usually the strongest signal a
    // developer gives without realising it.
    const pathTokens = new Set(tokenizeIdentifier(pathOf(node)));
    const haystack = tokenizeIdentifier(
      `${nameOf(node)} ${pathOf(node)} ${node.summary ?? ''} ${(node.tags ?? []).join(' ')}`,
    );
    let overlap = 0;
    for (const t of haystack) {
      if (tokens.has(t)) {
        // Exact match beats a prefix; a match in the path beats one in a summary.
        overlap += pathTokens.has(t) ? 4 : 2;
        continue;
      }
      // Prefix match, so "config" reaches `config0.ts` and `configLoader`.
      // Only for tokens of four characters or more: shorter prefixes match
      // most of a codebase and would flatten the ranking.
      for (const q of tokens) {
        if (q.length >= 4 && (t.startsWith(q) || q.startsWith(t))) {
          overlap += 1;
          break;
        }
      }
    }
    if (overlap > 0) scored.push({ id: node.id, score: overlap });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.id);
}

/** BFS outward from the seeds over dependency edges. */
function graphChannel(
  graph: KnowledgeGraph,
  seeds: string[],
  maxHops: number,
): { ordered: string[]; hops: Map<string, number> } {
  const adjacency = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    const set = adjacency.get(a) ?? new Set<string>();
    set.add(b);
    adjacency.set(a, set);
  };
  for (const edge of graph.edges) {
    if (edge.type === 'contains') continue;
    link(edge.source, edge.target);
    link(edge.target, edge.source);
  }

  const hops = new Map<string, number>();
  let frontier = new Set(seeds.map((p) => `file:${p}`));
  for (const id of frontier) hops.set(id, 0);

  for (let hop = 1; hop <= maxHops; hop++) {
    const next = new Set<string>();
    for (const id of frontier) {
      for (const neighbour of adjacency.get(id) ?? []) {
        if (hops.has(neighbour)) continue;
        hops.set(neighbour, hop);
        next.add(neighbour);
      }
    }
    if (next.size === 0) break;
    frontier = next;
  }

  const ordered = Array.from(hops.entries())
    .filter(([, h]) => h > 0)
    .sort((a, b) => a[1] - b[1])
    .map(([id]) => id);
  return { ordered, hops };
}

/**
 * Files that historically change with the seeds.
 *
 * The only channel that can surface a file with no textual or structural
 * relationship to the task — which is exactly the file an agent forgets.
 */
function behavioralChannel(graph: KnowledgeGraph, seeds: Set<string>): string[] {
  if (seeds.size === 0) return [];
  const scored: Array<{ id: string; score: number }> = [];
  for (const node of graph.nodes) {
    if (node.type !== 'file') continue;
    const path = pathOf(node);
    if (seeds.has(path)) continue;
    const behavioral = node.metadata?.['behavioral'] as { hotspot_score?: number } | undefined;
    const hotspot = behavioral?.hotspot_score ?? 0;
    if (hotspot > 0) scored.push({ id: node.id, score: hotspot });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 20).map((s) => s.id);
}

/** Rough size of a node in tokens, without reading the file. */
function estimateNodeTokens(node: SprangNode): number {
  const lines = Number(node.metadata?.['sizeLines'] ?? node.metadata?.['loc'] ?? 0);
  if (lines > 0) return Math.max(20, Math.round(lines * 9));
  // A signature plus a summary line is the floor for anything we would emit.
  return 60;
}

/**
 * Choose what the agent should look at, within a budget.
 *
 * Returns items ordered most-relevant-first. Callers that render this into a
 * prompt should keep that order and place the task statement both before and
 * after: attention degrades in the middle of a long context, so the ends are
 * the valuable positions.
 */
export function selectContext(graph: KnowledgeGraph, request: ContextRequest): ContextResult {
  const budget = request.budgetTokens ?? DEFAULT_BUDGET;
  const limit = request.limit ?? 40;
  const seedFiles = request.seedFiles ?? [];
  const seedSet = new Set(seedFiles);

  const tokens = new Set(
    [
      ...tokenizeIdentifier(request.task).filter((t) => !QUERY_STOPWORDS.has(t) && t.length >= 3),
      // Explicit identifiers are never filtered: if the caller named it, it matters.
      ...(request.mentionedIdents ?? []).map((i) => i.toLowerCase()),
    ],
  );

  if (graph.nodes.length === 0) {
    return {
      task: request.task,
      budgetTokens: budget,
      usedTokens: 0,
      items: [],
      omitted: 0,
      explanation: 'The graph is empty — run `sprang scan` first.',
    };
  }

  const { ordered: graphOrdered, hops } = graphChannel(graph, seedFiles, 2);
  const rankings: Array<{ channel: Channel; ordered: string[] }> = [
    { channel: 'exact-symbol', ordered: exactSymbolChannel(graph, tokens) },
    { channel: 'keyword', ordered: keywordChannel(graph, tokens).slice(0, 100) },
    { channel: 'graph', ordered: graphOrdered.slice(0, 60) },
    { channel: 'behavioral', ordered: behavioralChannel(graph, seedSet) },
    { channel: 'seed', ordered: seedFiles.map((p) => `file:${p}`) },
  ];

  const fused = fuse(rankings);
  if (fused.size === 0) {
    return {
      task: request.task,
      budgetTokens: budget,
      usedTokens: 0,
      items: [],
      omitted: 0,
      explanation:
        'Nothing in the graph matched this task by name, path, summary or dependency. ' +
        'Try naming a specific symbol or passing seed_files.',
    };
  }

  // Structural rerank. A file nothing depends on is rarely the right place to
  // start, however well its name matches.
  const rank = rankGraph(graph, {
    ...(seedFiles.length > 0 ? { seedFiles } : {}),
    ...(request.mentionedIdents ? { mentionedIdents: request.mentionedIdents } : {}),
  });
  const maxFused = Math.max(...Array.from(fused.values(), (v) => v.score)) || 1;
  const maxRank = Math.max(...rank.fileRank.values(), Number.EPSILON);

  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const candidates: ContextItem[] = [];
  for (const [id, entry] of fused) {
    const node = byId.get(id);
    if (!node) continue;
    const path = pathOf(node);
    const structural = (rank.fileRank.get(path) ?? 0) / maxRank;
    const score = 0.65 * (entry.score / maxFused) + 0.35 * structural;
    const hop = hops.get(id);
    candidates.push({
      nodeId: id,
      path,
      kind: node.type,
      score: Math.round(score * 1000) / 1000,
      channels: entry.channels,
      ...(hop !== undefined && hop > 0 ? { hopsFromSeed: hop } : {}),
      ...(node.risk_score !== undefined ? { riskScore: node.risk_score } : {}),
      estimatedTokens: estimateNodeTokens(node),
    });
  }
  candidates.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));

  // Greedy pack. Greedy rather than knapsack on purpose: relevance ordering is
  // the point, and a knapsack would happily drop the single most relevant item
  // to fit three marginal ones.
  const items: ContextItem[] = [];
  let used = 0;
  for (const candidate of candidates) {
    if (items.length >= limit) break;
    if (used + candidate.estimatedTokens > budget) continue;
    items.push(candidate);
    used += candidate.estimatedTokens;
  }

  const channelCounts = new Map<Channel, number>();
  for (const item of items) {
    for (const channel of item.channels) {
      channelCounts.set(channel, (channelCounts.get(channel) ?? 0) + 1);
    }
  }
  const breakdown = Array.from(channelCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([channel, count]) => `${channel} ${count}`)
    .join(', ');

  return {
    task: request.task,
    budgetTokens: budget,
    usedTokens: used,
    items,
    omitted: candidates.length - items.length,
    explanation:
      `${items.length} item(s) in ~${used} of ${budget} tokens (${breakdown}). ` +
      `${candidates.length - items.length} further candidate(s) did not fit. ` +
      `Ordered by relevance — keep that order, and restate the task after the context.`,
  };
}
