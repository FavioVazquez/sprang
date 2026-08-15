/**
 * Temporal-coupling helpers.
 *
 * The knowledge graph does not carry co-change data, so the dashboard fetches
 * it from `/coupling.json`, which the dev/preview/standalone server serves out
 * of `.sprang/intermediate/` (structure.json first, then behavioral.json).
 *
 * When that endpoint is unreachable — static hosting, an old `.sprang/` — we
 * fall back to a much weaker signal derived from `last_change` proximity. The
 * UI is required to say so; see `CouplingSource`.
 */
import type { KnowledgeGraph, SprangNode } from '../types';
import { getBehavioral, getNodePath } from './behavioral';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CouplingPair {
  a: string;
  b: string;
  /** Co-change degree, 0–100. */
  degree: number;
  /** Number of commits containing both files (git source only). */
  support?: number;
  lift?: number;
}

/** Where the numbers came from — the UI must surface this verbatim. */
export type CouplingSource = 'git' | 'derived' | 'none';

export interface CouplingPayload {
  available: boolean;
  /** Which intermediate file supplied the pairs. */
  source?: 'structure' | 'behavioral';
  window_months?: number;
  pairs: CouplingPair[];
}

/** Fetch git-derived coupling. Returns null when the endpoint is unreachable. */
export async function loadCoupling(): Promise<CouplingPayload | null> {
  try {
    const res = await fetch('/coupling.json');
    if (!res.ok) return null;
    const data: unknown = await res.json();
    if (!data || typeof data !== 'object') return null;
    const payload = data as Partial<CouplingPayload>;
    if (!Array.isArray(payload.pairs)) return null;
    const pairs = payload.pairs.filter(
      (p): p is CouplingPair =>
        !!p && typeof p.a === 'string' && typeof p.b === 'string' && typeof p.degree === 'number',
    );
    if (pairs.length === 0) return null;
    return {
      available: true,
      ...(payload.source ? { source: payload.source } : {}),
      ...(typeof payload.window_months === 'number' ? { window_months: payload.window_months } : {}),
      pairs,
    };
  } catch {
    return null;
  }
}

// ─── Fallback: derive from last_change proximity ─────────────────────────────

/** Groups larger than this are mass edits (renames, formatting) — no signal. */
export const MAX_DERIVED_GROUP = 12;

/**
 * A deliberately weak stand-in for real co-change: files whose behavioural
 * `last_change` date is identical probably moved together. Degree falls off as
 * the same-day group grows, because a 12-file day says far less than a 2-file
 * day.
 */
export function deriveCouplingFromLastChange(
  graph: KnowledgeGraph | null | undefined,
  limit = 120,
): CouplingPair[] {
  if (!graph) return [];
  const byDate = new Map<string, string[]>();
  for (const node of graph.nodes) {
    if (node.type !== 'file') continue;
    const b = getBehavioral(node);
    const date = b?.last_change;
    const path = getNodePath(node);
    if (!date || !path) continue;
    const bucket = byDate.get(date);
    if (bucket) bucket.push(path);
    else byDate.set(date, [path]);
  }

  const pairs: CouplingPair[] = [];
  for (const [, paths] of byDate) {
    const k = paths.length;
    if (k < 2 || k > MAX_DERIVED_GROUP) continue;
    const degree = Math.max(1, Math.round(100 / (k - 1)));
    const sorted = [...paths].sort();
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const a = sorted[i];
        const b = sorted[j];
        if (!a || !b) continue;
        pairs.push({ a, b, degree });
      }
    }
  }
  pairs.sort((x, y) => y.degree - x.degree || x.a.localeCompare(y.a));
  return pairs.slice(0, limit);
}

// ─── Dependency-edge lookup ──────────────────────────────────────────────────

/** Order-independent key for a file pair. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}

/**
 * Every unordered file pair joined by a *dependency* edge in the graph.
 *
 * Anything not in this set that still changes together is a hidden coupling —
 * the whole reason this view exists.
 */
export function buildDependencyPairs(graph: KnowledgeGraph | null | undefined): Set<string> {
  const set = new Set<string>();
  if (!graph) return set;
  const pathById = new Map<string, string>();
  for (const node of graph.nodes) {
    const p = getNodePath(node);
    if (p) pathById.set(node.id, p);
  }
  for (const edge of graph.edges) {
    const a = pathById.get(edge.source);
    const b = pathById.get(edge.target);
    if (!a || !b || a === b) continue;
    set.add(pairKey(a, b));
  }
  return set;
}

export function hasDependencyEdge(deps: Set<string>, a: string, b: string): boolean {
  return deps.has(pairKey(a, b));
}

// ─── Model ───────────────────────────────────────────────────────────────────

export interface CouplingArc {
  a: string;
  b: string;
  aNodeId: string | null;
  bNodeId: string | null;
  degree: number;
  support?: number;
  /** True when the two files change together but nothing connects them. */
  hidden: boolean;
}

export interface CouplingFile {
  path: string;
  label: string;
  nodeId: string | null;
  /** Sum of the degrees of every arc touching this file. */
  weight: number;
  hiddenCount: number;
}

export interface CouplingModel {
  arcs: CouplingArc[];
  files: CouplingFile[];
  hiddenCount: number;
  totalCount: number;
}

/**
 * Turn raw pairs into an arc-diagram model: files ordered by path, arcs
 * flagged `hidden` when no dependency edge joins the two files.
 *
 * Pairs whose files are not in the graph at all are dropped — an arc we cannot
 * click through to is noise.
 */
export function buildCouplingModel(
  graph: KnowledgeGraph | null | undefined,
  pairs: CouplingPair[],
  limit = 80,
): CouplingModel {
  const deps = buildDependencyPairs(graph);
  const nodeByPath = new Map<string, SprangNode>();
  for (const node of graph?.nodes ?? []) {
    if (node.type !== 'file') continue;
    const p = getNodePath(node);
    if (p && !nodeByPath.has(p)) nodeByPath.set(p, node);
  }

  const seen = new Set<string>();
  const arcs: CouplingArc[] = [];
  const ranked = [...pairs].sort((x, y) => y.degree - x.degree || x.a.localeCompare(y.a));

  for (const p of ranked) {
    if (arcs.length >= limit) break;
    if (!p.a || !p.b || p.a === p.b) continue;
    const key = pairKey(p.a, p.b);
    if (seen.has(key)) continue;
    const aNode = nodeByPath.get(p.a);
    const bNode = nodeByPath.get(p.b);
    if (!aNode || !bNode) continue;
    seen.add(key);
    arcs.push({
      a: p.a,
      b: p.b,
      aNodeId: aNode.id,
      bNodeId: bNode.id,
      degree: p.degree,
      ...(typeof p.support === 'number' ? { support: p.support } : {}),
      hidden: !deps.has(key),
    });
  }

  const fileMap = new Map<string, CouplingFile>();
  for (const arc of arcs) {
    for (const [path, nodeId] of [
      [arc.a, arc.aNodeId] as const,
      [arc.b, arc.bNodeId] as const,
    ]) {
      let f = fileMap.get(path);
      if (!f) {
        f = {
          path,
          label: path.split('/').pop() ?? path,
          nodeId,
          weight: 0,
          hiddenCount: 0,
        };
        fileMap.set(path, f);
      }
      f.weight += arc.degree;
      if (arc.hidden) f.hiddenCount += 1;
    }
  }

  const files = [...fileMap.values()].sort((x, y) => x.path.localeCompare(y.path));
  return {
    arcs,
    files,
    hiddenCount: arcs.filter((a) => a.hidden).length,
    totalCount: arcs.length,
  };
}

/** Stroke width for an arc, from its co-change degree. */
export function arcStrokeWidth(degree: number): number {
  const d = Number.isFinite(degree) ? Math.max(0, Math.min(100, degree)) : 0;
  return 0.6 + (d / 100) * 3.4;
}

/** Hidden couplings get their own hue *and* a dash — never colour alone. */
export const ARC_COLORS = {
  hidden: '#f0f921',
  visible: '#5b8def',
} as const;
