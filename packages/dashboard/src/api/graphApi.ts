import type { KnowledgeGraph } from '../types';

export type { KnowledgeGraph };

export async function loadGraph(_graphPath?: string): Promise<KnowledgeGraph | null> {
  // Try the flat path first (Vite serves public/ at root)
  const attempts = [
    '/knowledge-graph.json',
    '/.sprang/knowledge-graph.json',
    '/sprang/knowledge-graph.json',
  ];

  for (const path of attempts) {
    try {
      const res = await fetch(path);
      if (res.ok) {
        const data: unknown = await res.json();
        if (
          data !== null &&
          typeof data === 'object' &&
          !Array.isArray(data) &&
          'nodes' in data &&
          'edges' in data &&
          Array.isArray((data as Record<string, unknown>)['nodes']) &&
          Array.isArray((data as Record<string, unknown>)['edges'])
        ) {
          return data as KnowledgeGraph;
        }
      }
    } catch {
      // Try next path
    }
  }

  return null;
}

export interface GraphStatus {
  ok: boolean;
  code: 'GRAPH_OK' | 'GRAPH_NOT_FOUND' | 'GRAPH_INVALID' | 'GRAPH_READ_ERROR';
  error?: string;
  graph_path?: string;
  /** Condensed Zod issues — only present for GRAPH_INVALID. */
  validation_issues?: string;
  remedy?: string;
}

/**
 * Ask the server *why* the graph is unusable.
 *
 * `loadGraph()` returning null is ambiguous — no graph yet vs. a graph that
 * exists but fails schema validation. Only the latter means a re-scan is the
 * wrong remedy, so the UI needs to tell them apart.
 */
export async function loadGraphStatus(): Promise<GraphStatus | null> {
  try {
    const res = await fetch('/graph-status');
    const data: unknown = await res.json();
    if (data && typeof data === 'object' && 'code' in data) return data as GraphStatus;
  } catch {
    // Endpoint unavailable (e.g. static hosting) — caller falls back to generic messaging.
  }
  return null;
}

export function getRiskColor(score: number): string {
  if (score >= 0.7) return '#ef4444'; // risk.high
  if (score >= 0.4) return '#f59e0b'; // risk.medium
  return '#22c55e';                   // risk.low
}

export function getRiskLabel(score: number): 'Low Risk' | 'Medium Risk' | 'High Risk' {
  if (score >= 0.7) return 'High Risk';
  if (score >= 0.4) return 'Medium Risk';
  return 'Low Risk';
}

export function formatNodeId(id: string): string {
  // Strip common prefixes like 'file:', 'fn:', 'class:', etc.
  return id.replace(/^[a-z_]+:/, '');
}
