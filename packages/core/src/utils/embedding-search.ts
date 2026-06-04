import { join } from 'node:path';
import { readJsonFileOrNull } from './fs.js';
import type { SprangNode } from '../schema/types.js';
import { CACHE_DIR } from '../schema/constants.js';

// ─── Public interfaces ────────────────────────────────────────────────────────

export interface EmbeddingStore {
  version: '1.0';
  model: string;         // e.g. "tfidf-local" or "text-embedding-3-small"
  generatedAt: string;
  embeddings: Record<string, number[]>; // node_id → float vector
}

export interface EmbeddingSearchOptions {
  limit?: number;     // default 10
  threshold?: number; // minimum similarity score, default 0.3
}

export interface EmbeddingSearchResult {
  nodeId: string;
  score: number; // 0.0-1.0 cosine similarity
}

// ─── Math ─────────────────────────────────────────────────────────────────────

/**
 * Standard cosine similarity: dot(a, b) / (|a| * |b|).
 * Returns 0 if either vector has zero magnitude.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    magA += ai * ai;
    magB += bi * bi;
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

// ─── TF-IDF helpers ───────────────────────────────────────────────────────────

const STOPWORDS = new Set([
  'the', 'a', 'is', 'in', 'of', 'and', 'or', 'to', 'for',
  'with', 'this', 'that', 'from', 'are', 'was', 'it',
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\W+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

/**
 * Build a TF vector over vocabulary from text, then L2-normalize it.
 */
export function buildTfIdfEmbedding(text: string, vocabulary: string[]): number[] {
  const tokens = tokenize(text);
  const total = tokens.length;

  if (total === 0 || vocabulary.length === 0) {
    return new Array(vocabulary.length).fill(0) as number[];
  }

  // Count occurrences of each vocab word in tokens
  const counts = new Map<string, number>();
  for (const tok of tokens) {
    counts.set(tok, (counts.get(tok) ?? 0) + 1);
  }

  // Build TF vector
  const vec: number[] = vocabulary.map((word) => (counts.get(word) ?? 0) / total);

  // L2-normalize
  const magnitude = Math.sqrt(vec.reduce((s, x) => s + x * x, 0));
  if (magnitude === 0) return vec;
  return vec.map((x) => x / magnitude);
}

/**
 * Collect all words from node labels and summaries, keep top 500 by frequency
 * (excluding stopwords, tokens shorter than 2 chars), return sorted unique list.
 */
export function buildVocabulary(nodes: SprangNode[]): string[] {
  const freq = new Map<string, number>();

  for (const node of nodes) {
    const text = node.label + ' ' + (node.summary ?? '');
    for (const tok of tokenize(text)) {
      freq.set(tok, (freq.get(tok) ?? 0) + 1);
    }
  }

  // Sort by frequency descending, take top 500
  const sorted = [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 500)
    .map(([word]) => word);

  // Return sorted unique list (alphabetical)
  return sorted.sort();
}

// ─── Semantic search ──────────────────────────────────────────────────────────

/**
 * Search nodes by semantic similarity to query text.
 *
 * - If storedEmbeddings has entries, uses those vectors for nodes.
 * - Otherwise, falls back to TF-IDF: builds vocabulary from nodes, computes
 *   embeddings on the fly.
 */
export function semanticSearch(
  queryText: string,
  nodes: SprangNode[],
  storedEmbeddings: Record<string, number[]> | null,
  options?: EmbeddingSearchOptions
): EmbeddingSearchResult[] {
  const limit = options?.limit ?? 10;
  const threshold = options?.threshold ?? 0.3;

  const useStored =
    storedEmbeddings !== null &&
    Object.keys(storedEmbeddings).length > 0;

  let queryEmbedding: number[];
  const nodeEmbeddingMap = new Map<string, number[]>();

  if (useStored) {
    // Build vocabulary from the dimensionality of stored embeddings
    // (query must be embedded in the same space — use TF-IDF over node labels/summaries
    // to produce same-length vector as stored embeddings, OR just embed the query
    // via the same dimension as stored)
    //
    // Since stored embeddings can come from an external model (unknown vocabulary),
    // we use the stored vectors for nodes directly and build a TF-IDF query
    // embedding over the nodes' text content to approximate similarity.
    // For nodes without a stored embedding, skip them.
    const vocab = buildVocabulary(nodes);
    queryEmbedding = buildTfIdfEmbedding(queryText, vocab);

    for (const node of nodes) {
      const stored = storedEmbeddings[node.id];
      if (stored !== undefined) {
        nodeEmbeddingMap.set(node.id, stored);
      }
    }

    // If stored embeddings have the same dimension as vocab, use them directly.
    // Otherwise, compute TF-IDF embeddings for nodes too so dimensions match.
    const firstStored = nodeEmbeddingMap.values().next().value as number[] | undefined;
    if (firstStored !== undefined && firstStored.length !== queryEmbedding.length) {
      // Dimension mismatch — re-embed everything with TF-IDF
      queryEmbedding = buildTfIdfEmbedding(queryText, vocab);
      nodeEmbeddingMap.clear();
      for (const node of nodes) {
        const text = node.label + ' ' + (node.summary ?? '');
        nodeEmbeddingMap.set(node.id, buildTfIdfEmbedding(text, vocab));
      }
    }
  } else {
    // TF-IDF fallback
    const vocab = buildVocabulary(nodes);
    queryEmbedding = buildTfIdfEmbedding(queryText, vocab);
    for (const node of nodes) {
      const text = node.label + ' ' + (node.summary ?? '');
      nodeEmbeddingMap.set(node.id, buildTfIdfEmbedding(text, vocab));
    }
  }

  const results: EmbeddingSearchResult[] = [];

  for (const node of nodes) {
    const nodeEmbedding = nodeEmbeddingMap.get(node.id);
    if (nodeEmbedding === undefined) continue;
    const score = cosineSimilarity(queryEmbedding, nodeEmbedding);
    if (score >= threshold) {
      results.push({ nodeId: node.id, score });
    }
  }

  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// ─── Storage ──────────────────────────────────────────────────────────────────

/**
 * Load embedding store from `.sprang/cache/embeddings.json`.
 * Returns null if the file does not exist.
 */
export async function loadEmbeddingStore(sprangDir: string): Promise<EmbeddingStore | null> {
  const filePath = join(sprangDir, CACHE_DIR, 'embeddings.json');
  return readJsonFileOrNull<EmbeddingStore>(filePath);
}
