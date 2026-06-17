import { join } from 'node:path';
import { readJsonFileOrNull, semanticSearch } from '@sprang/core';
import type { GraphLoader } from '../graph-loader.js';
import type { EmbeddingStore } from '@sprang/core';

export interface SprangQueryInput {
  query: string;
  node_types?: string[];
  limit?: number;
  /**
   * mode?: "keyword" | "text" | "semantic"
   *   keyword/text (default) for TF-IDF text match,
   *   semantic for concept similarity (uses embeddings if available, TF-IDF fallback otherwise)
   */
  mode?: 'keyword' | 'text' | 'semantic';
}

export interface SprangQueryResult {
  nodes: Array<{
    id: string;
    type: string;
    label: string;
    summary?: string;
    risk_score?: number;
    score?: number; // cosine similarity score (semantic mode only)
  }>;
  total: number;
  query: string;
}

export async function sprangQuery(
  loader: GraphLoader,
  input: SprangQueryInput
): Promise<SprangQueryResult> {
  const graph = await loader.getGraph();
  if (!graph) {
    return { nodes: [], total: 0, query: input.query };
  }

  const rawLimit = typeof input.limit === 'number' ? input.limit : 10;
  const limit = Math.max(1, Math.min(rawLimit, 500));
  const { query, node_types, mode } = input;

  if (mode === 'semantic') {
    // ── Semantic mode ────────────────────────────────────────────────────────
    const sprangRoot = loader.getRoot();
    const embeddingStorePath = join(sprangRoot, '.sprang', 'cache', 'embeddings.json');
    const embeddingStore = await readJsonFileOrNull<EmbeddingStore>(embeddingStorePath);

    const candidates = node_types && node_types.length > 0
      ? graph.nodes.filter((n) => node_types.includes(n.type))
      : graph.nodes;

    const searchResults = semanticSearch(
      query,
      candidates,
      embeddingStore?.embeddings ?? null,
      { limit, threshold: 0.25 }
    );

    // Build a lookup map for node data
    const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));

    const nodes = searchResults.map((r) => {
      const node = nodeMap.get(r.nodeId);
      return {
        id: r.nodeId,
        type: node?.type ?? 'unknown',
        label: node?.label ?? r.nodeId,
        summary: node?.summary,
        risk_score: node?.risk_score,
        score: r.score,
      };
    });

    return { nodes, total: searchResults.length, query };
  }

  // ── Text mode (default) ───────────────────────────────────────────────────
  const lowerQuery = query.toLowerCase();
  // Split on whitespace so multi-word queries ("schema types") match individual tokens
  const tokens = lowerQuery.split(/\s+/).filter(Boolean);

  type ScoredNode = {
    id: string;
    type: string;
    label: string;
    summary?: string;
    risk_score?: number;
    _score: number;
  };

  const scored: ScoredNode[] = [];

  for (const node of graph.nodes) {
    if (node_types && node_types.length > 0 && !node_types.includes(node.type)) {
      continue;
    }

    const idLower = node.id.toLowerCase();
    const labelLower = node.label.toLowerCase();
    const summaryLower = node.summary?.toLowerCase() ?? '';

    // Full-phrase matching (highest priority)
    const phraseLabelExact = labelLower === lowerQuery;
    const phraseLabelMatch = labelLower.includes(lowerQuery);
    const phraseIdMatch = idLower.includes(lowerQuery);
    const phraseSummaryMatch = summaryLower.includes(lowerQuery);

    // Token matching — any token matches the field
    const tokenMatchLabel = tokens.filter((t) => labelLower.includes(t)).length;
    const tokenMatchId = tokens.filter((t) => idLower.includes(t)).length;
    const tokenMatchSummary = tokens.filter((t) => summaryLower.includes(t)).length;

    const anyMatch =
      phraseLabelMatch || phraseIdMatch || phraseSummaryMatch ||
      tokenMatchLabel > 0 || tokenMatchId > 0 || tokenMatchSummary > 0;

    if (!anyMatch) continue;

    // Score: exact match > phrase match > token match; label > id > summary
    let score = 0;
    if (phraseLabelExact) {
      score = 5;
    } else if (phraseLabelMatch) {
      score = 4;
    } else if (phraseIdMatch || phraseSummaryMatch) {
      score = 3;
    } else if (tokenMatchLabel > 0) {
      // Reward matching more tokens (all tokens = 2, partial = 1.x)
      score = 1 + tokenMatchLabel / tokens.length;
    } else if (tokenMatchId > 0) {
      score = 0.5 + tokenMatchId / tokens.length;
    } else {
      score = 0.5; // summary-only token match
    }

    scored.push({
      id: node.id,
      type: node.type,
      label: node.label,
      summary: node.summary,
      risk_score: node.risk_score,
      _score: score,
    });
  }

  scored.sort((a, b) => {
    if (b._score !== a._score) return b._score - a._score;
    return (b.risk_score ?? 0) - (a.risk_score ?? 0);
  });

  const top = scored.slice(0, limit);

  return {
    nodes: top.map(({ _score: _s, ...rest }) => rest),
    total: scored.length,
    query,
  };
}
