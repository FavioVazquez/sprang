import { BaseAgent } from './base.js';
import type { AgentContext, AgentResult } from './base.js';
import { readRepoHistory } from '../behavioral/history.js';
import {
  computeChurn,
  computeChangeCoupling,
  computeOwnership,
  computeHotspots,
  detectTraps,
} from '../behavioral/analysis.js';

/**
 * Attach behavioural signals from git to the graph.
 *
 * The graph describes how the code is wired; git describes how it has actually
 * behaved. The two disagree constantly, and the disagreements are the
 * interesting part: files that always change together with no dependency
 * between them, code that has been reverted twice, a module only one person
 * has touched in two years.
 *
 * This runs in Phase 2 alongside the other deterministic analysers. It is
 * language-agnostic — it works on files no parser understands — and costs one
 * `git log` traversal for the whole repository rather than one per file.
 */
export class BehavioralAnalyzerAgent extends BaseAgent {
  readonly id = 'behavioral-analyzer';
  readonly phase = 2 as const;

  async run(ctx: AgentContext): Promise<AgentResult> {
    const graph = ctx.graph;
    const history = await readRepoHistory(ctx.projectRoot, { sinceMonths: 12 });

    if (history.empty) {
      // Not a git repository, or no commits in the window. Behavioural
      // analysis simply does not apply; that is not a failure.
      await this.writeIntermediate(ctx, 'behavioral.json', {
        available: false,
        reason: 'no git history in window',
      });
      return this.success(ctx, graph);
    }

    const churn = computeChurn(history);
    const ownership = computeOwnership(history);
    const traps = detectTraps(history);

    // Lines of code is the complexity proxy: it correlates strongly with
    // cyclomatic complexity, costs nothing, and — unlike a parser-derived
    // metric — is available for every language including the ones Sprang
    // cannot parse.
    const complexityByPath = new Map<string, number>();
    for (const node of graph.nodes) {
      if (node.type !== 'file' || !node.location?.file) continue;
      // Source only. A lockfile is enormous and churns constantly, so it wins
      // any complexity-times-churn ranking outright while telling you nothing;
      // the same is true of a changelog. Ranking them as hotspots buries the
      // handful of files that genuinely are.
      const category = node.metadata?.['fileCategory'];
      if (category !== undefined && category !== 'source') continue;
      const loc = Number(node.metadata?.['sizeLines'] ?? 0);
      if (loc > 0) complexityByPath.set(node.location.file, loc);
    }
    const hotspots = computeHotspots(churn, complexityByPath, { limit: 50 });
    const hotspotScores = new Map(hotspots.map((h) => [h.path, h.score]));

    let annotated = 0;
    for (const node of graph.nodes) {
      if (node.type !== 'file' || !node.location?.file) continue;
      const path = node.location.file;
      const c = churn.get(path);
      if (!c) continue;

      const own = ownership.get(path);
      const trapList = traps.get(path) ?? [];

      node.metadata = {
        ...node.metadata,
        behavioral: {
          revisions: c.revisions,
          lines_added: c.linesAdded,
          lines_deleted: c.linesDeleted,
          bug_fixes: c.bugFixes,
          age_months: c.ageMonths,
          last_change: c.lastChange.slice(0, 10),
          hotspot_score: hotspotScores.get(path) ?? 0,
          ...(own
            ? {
                main_developer: own.mainDeveloper,
                top_share: own.topShare,
                bus_factor: own.busFactor,
                knowledge_diffusion: own.knowledgeDiffusion,
                minor_contributors: own.minorContributors,
              }
            : {}),
          ...(trapList.length > 0
            ? {
                trap_count: trapList.length,
                traps: trapList.slice(0, 3).map((t) => ({
                  kind: t.kind,
                  subject: t.subject,
                  hours_to_correction: Math.round(t.hoursToCorrection * 10) / 10,
                })),
              }
            : {}),
        },
      };
      annotated += 1;
    }

    // Coupling is a property of a pair, not a node, so it is stored alongside
    // the graph rather than on it. Capped: the full matrix on a large repo is
    // enormous and the tail is uninteresting.
    const coupling = computeChangeCoupling(history, { limit: 500 });

    await this.writeIntermediate(ctx, 'behavioral.json', {
      available: true,
      window_months: history.sinceMonths,
      commits_analysed: history.commits.length,
      files_annotated: annotated,
      hotspots,
      coupling,
      trap_files: traps.size,
    });

    return this.success(ctx, graph);
  }
}
