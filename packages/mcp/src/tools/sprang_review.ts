import type { KnowledgeGraph } from '@sprang/core';
import type { GraphLoader } from '../graph-loader.js';
import { loadAllReadPaths } from '../receipt.js';

export interface SprangReviewInput {
  /** Files the change touches. */
  changed_files: string[];
  /** Include nodes this far from the change. Defaults to 2. */
  depth?: number;
}

export interface SprangReviewResult {
  changed_files: string[];
  /** Files reachable from the change that could be affected. */
  blast_radius_size: number;
  /** Fraction of the blast radius the agent actually opened, 0–1. */
  context_coverage: number;
  /** Impacted files never read in any session, riskiest first. */
  unread: Array<{
    path: string;
    risk_score: number;
    hops: number;
    reason: string;
  }>;
  sessions_considered: number;
  verdict: 'looks_complete' | 'gaps_found' | 'no_receipts';
  guidance: string;
}

/** BFS outward over dependency edges, recording distance. */
function blastRadius(
  graph: KnowledgeGraph,
  changed: Set<string>,
  depth: number,
): Map<string, number> {
  const incoming = new Map<string, Set<string>>();
  for (const edge of graph.edges) {
    if (edge.type !== 'imports' && edge.type !== 'depends_on' && edge.type !== 'calls') continue;
    // Who depends on the target: those are the files a change can break.
    const set = incoming.get(edge.target) ?? new Set<string>();
    set.add(edge.source);
    incoming.set(edge.target, set);
  }

  const fileOf = (id: string) => (id.startsWith('file:') ? id.slice(5) : id);
  const result = new Map<string, number>();
  let frontier = new Set<string>();
  for (const path of changed) frontier.add(`file:${path}`);

  for (let hop = 1; hop <= depth; hop++) {
    const next = new Set<string>();
    for (const id of frontier) {
      for (const dependent of incoming.get(id) ?? []) {
        const path = fileOf(dependent);
        if (changed.has(path) || result.has(path)) continue;
        result.set(path, hop);
        next.add(dependent);
      }
    }
    if (next.size === 0) break;
    frontier = next;
  }
  return result;
}

/**
 * Did the agent look at enough before deciding it was done?
 *
 * This inverts what every other tool in this space does. Retrieval tools help
 * an agent find code; this one checks, afterwards, what it never opened —
 * comparing the blast radius of the change against the set of files actually
 * read during the session.
 *
 * The output is deliberately blunt: a coverage fraction and a ranked list of
 * impacted files the agent never saw. "You changed `charge` but never opened
 * three of its seven callers, including `RefundJob` at risk 0.81" is a
 * statement a human can act on in seconds.
 */
export async function sprangReview(
  loader: GraphLoader,
  input: SprangReviewInput,
  sprangRoot: string,
): Promise<SprangReviewResult | { error: string; code: string; remedy: string }> {
  const graph = await loader.getGraph();
  if (!graph) {
    const err = loader.getError();
    return { error: err.error, code: err.code, remedy: err.remedy };
  }

  const changed = new Set(
    input.changed_files.map((f) => (f.startsWith('file:') ? f.slice(5) : f)),
  );
  const depth = input.depth ?? 2;
  const radius = blastRadius(graph, changed, depth);

  const { paths: read, sessions } = loadAllReadPaths(sprangRoot);

  const riskOf = new Map<string, number>();
  for (const node of graph.nodes) {
    if (node.type !== 'file') continue;
    const path = node.location?.file ?? node.id.replace(/^file:/, '');
    riskOf.set(path, node.risk_score ?? 0);
  }

  const unread = Array.from(radius.entries())
    .filter(([path]) => !read.has(path))
    .map(([path, hops]) => ({
      path,
      risk_score: Math.round((riskOf.get(path) ?? 0) * 100) / 100,
      hops,
      reason:
        hops === 1
          ? 'directly depends on a file you changed'
          : `depends on it ${hops} hops away`,
    }))
    .sort((a, b) => b.risk_score - a.risk_score || a.hops - b.hops);

  const covered = radius.size - unread.length;
  const coverage = radius.size === 0 ? 1 : Math.round((covered / radius.size) * 100) / 100;

  // With no receipts we know nothing, and must not imply the change is fine.
  if (sessions === 0) {
    return {
      changed_files: Array.from(changed),
      blast_radius_size: radius.size,
      context_coverage: 0,
      unread: unread.slice(0, 20),
      sessions_considered: 0,
      verdict: 'no_receipts',
      guidance:
        'No read receipts were found, so coverage cannot be measured — this is not evidence the ' +
        'change is complete. Receipts accumulate as the agent calls Sprang tools during a session. ' +
        `${radius.size} file(s) are in the blast radius and are listed for review regardless.`,
    };
  }

  const highRiskUnread = unread.filter((u) => u.risk_score >= 0.5);
  return {
    changed_files: Array.from(changed),
    blast_radius_size: radius.size,
    context_coverage: coverage,
    unread: unread.slice(0, 20),
    sessions_considered: sessions,
    verdict: unread.length === 0 ? 'looks_complete' : 'gaps_found',
    guidance:
      unread.length === 0
        ? `Every one of the ${radius.size} impacted file(s) was opened during this work.`
        : `${unread.length} of ${radius.size} impacted file(s) were never opened` +
          (highRiskUnread.length > 0
            ? `, including ${highRiskUnread.length} at risk ≥ 0.5. Review those before calling this done.`
            : '. Review them before calling this done.'),
  };
}
