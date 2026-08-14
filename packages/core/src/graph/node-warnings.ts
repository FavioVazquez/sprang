/**
 * Per-node warning carry-over between Phase 1 and the agent-driven merge.
 *
 * Phase 1 computes `structural_warnings`, `security_warnings`, `risk_score` and
 * `risk_factors` for every node, but historically only persisted *summaries*
 * (`smells.json`, `security-scan.json`). When `/sprang-analyze` later rebuilt the
 * graph from agent chunks, those per-node fields were gone — so `sprang_health`
 * reported a dramatically better grade for identical code (observed: F/49 → B/82,
 * security findings 7 → 0) purely because the evidence had been dropped.
 *
 * `node-warnings.json` is that missing channel: Phase 1 writes the per-node
 * findings, and both merge implementations re-attach them as a baseline that
 * agent-supplied values may override.
 */

import type { KnowledgeGraph, SprangNode } from '../schema/types.js';

export interface NodeWarningEntry {
  structural_warnings?: SprangNode['structural_warnings'];
  security_warnings?: SprangNode['security_warnings'];
  risk_score?: number;
  risk_factors?: SprangNode['risk_factors'];
}

/** nodeId → findings. Only nodes with at least one finding are included. */
export type NodeWarningsIndex = Record<string, NodeWarningEntry>;

export const NODE_WARNINGS_FILE = 'node-warnings.json';

/** Extract every per-node finding Phase 1 computed, so merge can restore them. */
export function buildNodeWarningsIndex(graph: KnowledgeGraph): NodeWarningsIndex {
  const index: NodeWarningsIndex = {};
  for (const node of graph.nodes) {
    const entry: NodeWarningEntry = {};
    if (node.structural_warnings?.length) entry.structural_warnings = node.structural_warnings;
    if (node.security_warnings?.length) entry.security_warnings = node.security_warnings;
    if (typeof node.risk_score === 'number' && node.risk_score > 0) entry.risk_score = node.risk_score;
    if (node.risk_factors?.length) entry.risk_factors = node.risk_factors;
    if (Object.keys(entry).length > 0) index[node.id] = entry;
  }
  return index;
}

/**
 * Re-attach Phase 1 findings to agent-assembled nodes, in place.
 *
 * Existing values win: if the agent produced its own `structural_warnings` for a
 * node, that is a deliberate enrichment and must not be clobbered by the older
 * static scan. Returns how many nodes were touched.
 */
export function applyNodeWarnings(
  nodes: Array<Record<string, unknown>>,
  index: NodeWarningsIndex,
): number {
  let applied = 0;
  for (const node of nodes) {
    const id = typeof node['id'] === 'string' ? node['id'] : null;
    if (!id) continue;
    const entry = index[id];
    if (!entry) continue;
    let touched = false;
    for (const key of ['structural_warnings', 'security_warnings', 'risk_score', 'risk_factors'] as const) {
      const value = entry[key];
      if (value === undefined) continue;
      const existing = node[key];
      const isEmpty = existing == null || (Array.isArray(existing) && existing.length === 0);
      if (isEmpty) {
        node[key] = value;
        touched = true;
      }
    }
    if (touched) applied++;
  }
  return applied;
}
