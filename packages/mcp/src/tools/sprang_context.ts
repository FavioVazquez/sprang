import { selectContext, type ContextItem } from '@sprang/core';
import type { GraphLoader } from '../graph-loader.js';

export interface SprangContextInput {
  task: string;
  budget_tokens?: number;
  seed_files?: string[];
  mentioned_idents?: string[];
  limit?: number;
}

export interface SprangContextResult {
  task: string;
  budget_tokens: number;
  used_tokens: number;
  items: Array<{
    node_id: string;
    path: string;
    kind: string;
    score: number;
    /** Which retrieval channels surfaced this — the reason it is here. */
    found_by: string[];
    hops_from_seed?: number;
    risk_score?: number;
  }>;
  omitted: number;
  guidance: string;
}

/**
 * Choose what to read, within a token budget.
 *
 * Retrieval is a commodity; allocation is not. A repository holds millions of
 * tokens and the window holds a hundred thousand, and models measurably
 * degrade as context grows even inside their nominal limit. Fewer, better
 * chosen files beat more files.
 *
 * Four channels propose candidates — exact symbol name, keyword overlap,
 * dependency-graph proximity to the seeds, and files that historically change
 * with them — merged by reciprocal-rank fusion and reranked by personalized
 * PageRank so that a file nothing depends on does not outrank the module at
 * the centre of the system.
 *
 * Every item says which channels found it. That is the part a vector database
 * cannot offer, and it is what lets an engineer tell a good answer from a
 * lucky one.
 */
export async function sprangContext(
  loader: GraphLoader,
  input: SprangContextInput,
): Promise<SprangContextResult | { error: string; code: string; remedy: string }> {
  const graph = await loader.getGraph();
  if (!graph) {
    const err = loader.getError();
    return { error: err.error, code: err.code, remedy: err.remedy };
  }

  const result = selectContext(graph, {
    task: input.task,
    ...(input.budget_tokens !== undefined ? { budgetTokens: input.budget_tokens } : {}),
    ...(input.seed_files ? { seedFiles: input.seed_files } : {}),
    ...(input.mentioned_idents ? { mentionedIdents: input.mentioned_idents } : {}),
    ...(input.limit !== undefined ? { limit: input.limit } : {}),
  });

  return {
    task: result.task,
    budget_tokens: result.budgetTokens,
    used_tokens: result.usedTokens,
    items: result.items.map((i: ContextItem) => ({
      node_id: i.nodeId,
      path: i.path,
      kind: i.kind,
      score: i.score,
      found_by: i.channels,
      ...(i.hopsFromSeed !== undefined ? { hops_from_seed: i.hopsFromSeed } : {}),
      ...(i.riskScore !== undefined ? { risk_score: i.riskScore } : {}),
    })),
    omitted: result.omitted,
    guidance: result.explanation,
  };
}
