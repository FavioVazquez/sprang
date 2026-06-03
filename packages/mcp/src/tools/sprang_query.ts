import type { GraphLoader } from '../graph-loader.js';

export interface SprangQueryInput {
  query: string;
  node_types?: string[];
  limit?: number;
}

export interface SprangQueryResult {
  nodes: Array<{
    id: string;
    type: string;
    label: string;
    summary?: string;
    risk_score?: number;
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
  const { query, node_types } = input;
  const lowerQuery = query.toLowerCase();

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

    const labelLower = node.label.toLowerCase();
    const summaryLower = node.summary?.toLowerCase() ?? '';

    const labelMatch = labelLower.includes(lowerQuery);
    const summaryMatch = summaryLower.includes(lowerQuery);

    if (!labelMatch && !summaryMatch) {
      continue;
    }

    // Score: label exact match = 3, label contains = 2, summary match = 1
    let score = 0;
    if (labelLower === lowerQuery) {
      score = 3;
    } else if (labelMatch) {
      score = 2;
    } else if (summaryMatch) {
      score = 1;
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
