import {
  readRepoHistory,
  computeChangeCoupling,
  type ChangeCoupling,
  type KnowledgeGraph,
} from '@sprang/core';
import type { GraphLoader } from '../graph-loader.js';

export interface SprangCoupledInput {
  /** File path to look up. Accepts a path or a `file:<path>` node id. */
  file: string;
  /** Months of history to consider. */
  since_months?: number;
  limit?: number;
}

export interface CoupledFile {
  path: string;
  /** Percentage of this file's changes that also touched the queried file. */
  co_change_percent: number;
  /** Number of commits touching both. The trustworthiness of the percentage. */
  shared_commits: number;
  /** Above 1 means they co-change more than chance would predict. */
  lift: number;
  /** True when nothing in the dependency graph connects the two files. */
  hidden: boolean;
  /** Why it is worth knowing, in one line. */
  note: string;
}

export interface SprangCoupledResult {
  file: string;
  window_months: number;
  commits_analysed: number;
  coupled: CoupledFile[];
  /** Couplings with no static path — the ones static analysis cannot find. */
  hidden_coupling_count: number;
  guidance: string;
}

/** Is there any dependency path between two files within `maxHops`? */
function hasStaticPath(
  graph: KnowledgeGraph,
  fromPath: string,
  toPath: string,
  maxHops = 2,
): boolean {
  const idFor = (p: string) => `file:${p}`;
  const start = idFor(fromPath);
  const goal = idFor(toPath);

  const adjacency = new Map<string, Set<string>>();
  for (const edge of graph.edges) {
    if (edge.type !== 'imports' && edge.type !== 'depends_on' && edge.type !== 'calls') continue;
    // Undirected: coupling is symmetric, and "A imports B" makes them related
    // in either direction for this question.
    (adjacency.get(edge.source) ?? adjacency.set(edge.source, new Set()).get(edge.source)!).add(edge.target);
    (adjacency.get(edge.target) ?? adjacency.set(edge.target, new Set()).get(edge.target)!).add(edge.source);
  }

  let frontier = new Set([start]);
  const seen = new Set([start]);
  for (let hop = 0; hop < maxHops; hop++) {
    const next = new Set<string>();
    for (const id of frontier) {
      for (const neighbour of adjacency.get(id) ?? []) {
        if (neighbour === goal) return true;
        if (seen.has(neighbour)) continue;
        seen.add(neighbour);
        next.add(neighbour);
      }
    }
    if (next.size === 0) break;
    frontier = next;
  }
  return false;
}

/**
 * Files that historically change together with the given file.
 *
 * This answers a question no static analyser can: two files with no import
 * between them, that nonetheless change together 80% of the time, have a real
 * dependency that exists only in the team's heads. A schema and its migration,
 * a client and a server contract, two parallel class hierarchies, a fixture and
 * the code it mirrors. Those are exactly the edits an agent forgets to make,
 * and the resulting change looks complete right up until it isn't.
 */
export async function sprangCoupled(
  loader: GraphLoader,
  input: SprangCoupledInput,
  sprangRoot: string,
): Promise<SprangCoupledResult | { error: string; code: string; remedy: string }> {
  const target = input.file.startsWith('file:') ? input.file.slice('file:'.length) : input.file;
  const sinceMonths = input.since_months ?? 12;
  const limit = input.limit ?? 10;

  const history = await readRepoHistory(sprangRoot, { sinceMonths });
  if (history.empty) {
    return {
      error: 'No git history available for this project.',
      code: 'NO_HISTORY',
      remedy:
        'Change coupling is derived from git. Ensure this is a git repository with commits in the selected window.',
    };
  }

  const all: ChangeCoupling[] = computeChangeCoupling(history);
  const relevant = all
    .filter((c) => c.a === target || c.b === target)
    .slice(0, limit);

  if (relevant.length === 0) {
    return {
      file: target,
      window_months: history.sinceMonths,
      commits_analysed: history.commits.length,
      coupled: [],
      hidden_coupling_count: 0,
      guidance:
        `No file co-changes with ${target} often enough to be meaningful ` +
        `(at least 5 shared commits and 30% co-change). That is a good sign: ` +
        `this file's changes appear to be self-contained.`,
    };
  }

  // The graph is optional here — coupling stands on its own — but when it is
  // available it lets us say which couplings are invisible to static analysis.
  const graph = await loader.getGraph().catch(() => null);

  const coupled: CoupledFile[] = relevant.map((c) => {
    const other = c.a === target ? c.b : c.a;
    const pOtherGivenTarget = c.a === target ? c.pBGivenA : c.pAGivenB;
    const hidden = graph ? !hasStaticPath(graph, target, other) : false;
    return {
      path: other,
      co_change_percent: Math.round(pOtherGivenTarget * 100),
      shared_commits: c.support,
      lift: c.lift,
      hidden,
      note: hidden
        ? 'No dependency path in the graph — this coupling is invisible to static analysis.'
        : 'Also connected in the dependency graph.',
    };
  });

  const hiddenCount = coupled.filter((c) => c.hidden).length;

  return {
    file: target,
    window_months: history.sinceMonths,
    commits_analysed: history.commits.length,
    coupled,
    hidden_coupling_count: hiddenCount,
    guidance:
      hiddenCount > 0
        ? `${hiddenCount} of these have no dependency path to ${target}. Historically they still ` +
          `had to change with it, so check them before considering the change complete.`
        : `All couplings are also visible in the dependency graph.`,
  };
}
