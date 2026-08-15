/**
 * Behavioural-metric helpers shared by the Hotspot and Knowledge views.
 *
 * All of it is derived from `metadata.behavioral`, which the git layer writes
 * onto file nodes during `sprang scan`. Older graphs simply do not carry it —
 * every helper here is written so that "no behavioural data" is a first-class
 * answer rather than a crash.
 */
import { hierarchy, treemap as d3Treemap, type HierarchyRectangularNode } from 'd3-hierarchy';
import type { KnowledgeGraph, SprangNode } from '../types';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface BehavioralTrap {
  kind: string;
  subject?: string;
  hours_to_correction?: number;
}

export interface BehavioralMetrics {
  revisions?: number;
  lines_added?: number;
  lines_deleted?: number;
  bug_fixes?: number;
  age_months?: number;
  last_change?: string;
  hotspot_score?: number;
  main_developer?: string;
  top_share?: number;
  bus_factor?: number;
  knowledge_diffusion?: number;
  minor_contributors?: number;
  trap_count?: number;
  traps?: BehavioralTrap[];
}

// ─── Node accessors ──────────────────────────────────────────────────────────

/** Read `metadata.behavioral` off a node, or null when the graph predates it. */
export function getBehavioral(node: SprangNode | null | undefined): BehavioralMetrics | null {
  const raw = node?.metadata?.['behavioral'];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return raw as BehavioralMetrics;
}

/** Lines of code for a file node — `metadata.sizeLines`, with fallbacks. */
export function getSizeLines(node: SprangNode | null | undefined): number {
  const meta = node?.metadata;
  const size = meta?.['sizeLines'] ?? meta?.['lines'];
  return typeof size === 'number' && Number.isFinite(size) && size > 0 ? size : 0;
}

/** Normalised repo-relative path for a node, or '' when it has none. */
export function getNodePath(node: SprangNode): string {
  const raw = node.filePath ?? node.location?.file ?? '';
  return raw.replace(/\\/g, '/').replace(/^\/+/, '').replace(/^\.\//, '');
}

/** File nodes that actually carry behavioural metrics. */
export function behavioralFileNodes(graph: KnowledgeGraph | null | undefined): SprangNode[] {
  if (!graph) return [];
  return graph.nodes.filter((n) => n.type === 'file' && getBehavioral(n) !== null);
}

/** True when at least one file node carries `metadata.behavioral`. */
export function hasBehavioralData(graph: KnowledgeGraph | null | undefined): boolean {
  return behavioralFileNodes(graph).length > 0;
}

// ─── Treemap layout (area = lines of code) ───────────────────────────────────

export interface BehavioralCell {
  nodeId: string;
  name: string;
  path: string;
  lines: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  width: number;
  height: number;
  node: SprangNode;
  behavioral: BehavioralMetrics;
}

interface LayoutDatum {
  name: string;
  path: string;
  node?: SprangNode;
  lines?: number;
  children?: LayoutDatum[];
}

/** Minimum area a file gets so tiny-but-hot files never vanish entirely. */
export const MIN_CELL_VALUE = 10;

/**
 * Lay out file nodes as a treemap where **area is lines of code**.
 *
 * Files are grouped by their top-level directory so the picture keeps some of
 * the repo's shape; only leaves (files) are returned.
 */
export function layoutBehavioralTreemap(
  nodes: SprangNode[],
  width: number,
  height: number,
): BehavioralCell[] {
  if (width < 10 || height < 10 || nodes.length === 0) return [];

  const root: LayoutDatum = { name: 'root', path: '', children: [] };
  const groups = new Map<string, LayoutDatum>();

  for (const node of nodes) {
    const path = getNodePath(node);
    if (!path) continue;
    const parts = path.split('/');
    const groupKey = parts.length > 1 ? parts[0] ?? '' : '';
    let group = groups.get(groupKey);
    if (!group) {
      group = { name: groupKey || '.', path: groupKey, children: [] };
      groups.set(groupKey, group);
      root.children?.push(group);
    }
    group.children?.push({
      name: parts[parts.length - 1] ?? path,
      path,
      node,
      lines: Math.max(getSizeLines(node), MIN_CELL_VALUE),
    });
  }

  if (!root.children || root.children.length === 0) return [];

  const h = hierarchy<LayoutDatum>(root)
    .sum((d) => (d.children && d.children.length > 0 ? 0 : d.lines ?? MIN_CELL_VALUE))
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

  d3Treemap<LayoutDatum>()
    .size([width, height])
    .paddingOuter(3)
    .paddingTop(14)
    .paddingInner(1)
    .round(true)(h);

  const cells: BehavioralCell[] = [];
  h.each((n) => {
    const rect = n as HierarchyRectangularNode<LayoutDatum>;
    const node = rect.data.node;
    if (!node) return;
    const behavioral = getBehavioral(node);
    if (!behavioral) return;
    cells.push({
      nodeId: node.id,
      name: rect.data.name,
      path: rect.data.path,
      lines: getSizeLines(node),
      x0: rect.x0,
      y0: rect.y0,
      x1: rect.x1,
      y1: rect.y1,
      width: rect.x1 - rect.x0,
      height: rect.y1 - rect.y0,
      node,
      behavioral,
    });
  });
  return cells;
}

// ─── Hotspot colour ramp ─────────────────────────────────────────────────────

/**
 * Plasma-style ramp: monotonically increasing in lightness as well as hue, so
 * it stays readable under deuteranopia (nothing here depends on telling red
 * from green).
 */
export const HOTSPOT_STOPS: Array<{ at: number; color: string }> = [
  { at: 0.0, color: '#0d0887' },
  { at: 0.25, color: '#7e03a8' },
  { at: 0.5, color: '#cc4778' },
  { at: 0.75, color: '#f89540' },
  { at: 1.0, color: '#f0f921' },
];

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  const to = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

/** Map a 0–1 hotspot score onto the ramp. Out-of-range values clamp. */
export function hotspotColor(score: number): string {
  const s = Number.isFinite(score) ? Math.max(0, Math.min(1, score)) : 0;
  const first = HOTSPOT_STOPS[0];
  const last = HOTSPOT_STOPS[HOTSPOT_STOPS.length - 1];
  /* c8 ignore next */
  if (!first || !last) return '#0d0887';
  if (s <= first.at) return first.color;
  if (s >= last.at) return last.color;
  for (let i = 0; i < HOTSPOT_STOPS.length - 1; i++) {
    const lo = HOTSPOT_STOPS[i];
    const hi = HOTSPOT_STOPS[i + 1];
    if (!lo || !hi) break;
    if (s >= lo.at && s <= hi.at) {
      const t = (s - lo.at) / (hi.at - lo.at);
      const [r1, g1, b1] = hexToRgb(lo.color);
      const [r2, g2, b2] = hexToRgb(hi.color);
      return rgbToHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
    }
  }
  return last.color;
}

/** Coarse band used for the text badge next to the colour (redundant encoding). */
export function hotspotBand(score: number): 'cold' | 'warm' | 'hot' | 'critical' {
  const s = Number.isFinite(score) ? Math.max(0, Math.min(1, score)) : 0;
  if (s >= 0.75) return 'critical';
  if (s >= 0.5) return 'hot';
  if (s >= 0.25) return 'warm';
  return 'cold';
}

// ─── Knowledge / bus-factor classification ───────────────────────────────────

export type KnowledgeRiskLevel = 'critical' | 'concentrated' | 'shared' | 'unknown';

/**
 * Classify knowledge-loss risk.
 *
 * - `critical`      — one author has touched it and it is not a one-off file
 *                     (`bus_factor === 1 && revisions >= 5`)
 * - `concentrated`  — one author holds more than 80% of the recency-weighted
 *                     authorship (`top_share > 0.8`)
 * - `shared`        — authorship is spread
 * - `unknown`       — the graph carries no authorship signal for this file
 */
export function knowledgeRiskLevel(b: BehavioralMetrics | null | undefined): KnowledgeRiskLevel {
  if (!b) return 'unknown';
  const hasSignal = typeof b.bus_factor === 'number' || typeof b.top_share === 'number';
  if (!hasSignal) return 'unknown';
  if (b.bus_factor === 1 && (b.revisions ?? 0) >= 5) return 'critical';
  if ((b.top_share ?? 0) > 0.8) return 'concentrated';
  return 'shared';
}

export interface KnowledgeStyle {
  fill: string;
  label: string;
  description: string;
  /** Redundant, non-colour encoding for deuteranopia / greyscale printing. */
  pattern: 'hatch' | 'dots' | 'none';
}

/**
 * Deliberately not a red/amber/green ramp: deep red, mid amber and light teal
 * differ in lightness as well as hue, and `critical` also carries a hatch.
 */
export const KNOWLEDGE_STYLES: Record<KnowledgeRiskLevel, KnowledgeStyle> = {
  critical: {
    fill: '#b91c1c',
    label: 'Single author',
    description: 'One author, five or more revisions — if they leave, nobody has touched this.',
    pattern: 'hatch',
  },
  concentrated: {
    fill: '#f59e0b',
    label: 'Concentrated',
    description: 'One author holds over 80% of recent authorship.',
    pattern: 'dots',
  },
  shared: {
    fill: '#2dd4bf',
    label: 'Spread',
    description: 'Authorship is spread across several people.',
    pattern: 'none',
  },
  unknown: {
    fill: '#3f3f46',
    label: 'No git signal',
    description: 'No authorship data for this file in the analysed window.',
    pattern: 'none',
  },
};

export function knowledgeColor(b: BehavioralMetrics | null | undefined): string {
  return KNOWLEDGE_STYLES[knowledgeRiskLevel(b)].fill;
}

/** Format a 0–1 share as a percentage string; '—' when absent. */
export function formatShare(share: number | undefined): string {
  if (typeof share !== 'number' || !Number.isFinite(share)) return '—';
  return `${Math.round(Math.max(0, Math.min(1, share)) * 100)}%`;
}

/** Compact lines label, matching the Treemap view's idiom. */
export function formatLines(lines: number | undefined): string {
  if (!lines) return '0L';
  if (lines < 1000) return `${lines}L`;
  return `${(lines / 1000).toFixed(1)}kL`;
}
