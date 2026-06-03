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
        const data = await res.json();
        return data as KnowledgeGraph;
      }
    } catch {
      // Try next path
    }
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
