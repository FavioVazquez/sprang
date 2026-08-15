import { readRepoHistory, computeOwnership } from '@sprang/core';

export interface SprangOwnersInput {
  file: string;
  since_months?: number;
}

export interface SprangOwnersResult {
  file: string;
  window_months: number;
  main_developer: string | null;
  /** Share held by the top contributor, 0–1, recency-weighted. */
  top_share: number;
  /** People needed to cover more than half the contribution. 1 is a risk. */
  bus_factor: number;
  /** 0 = one owner, 1 = perfectly diffused. Both extremes are risks. */
  knowledge_diffusion: number;
  /** Contributors with under 5% each — correlated with defects (Bird et al.). */
  minor_contributors: number;
  authors: Array<{ name: string; commits: number; share: number; last_touched: string }>;
  guidance: string;
}

/**
 * Who actually knows this code.
 *
 * Contributions are weighted by recency with a nine-month half-life: someone
 * who wrote a file three years ago and has not touched it since is not really
 * its owner any more, and treating them as one sends reviewers to the wrong
 * person.
 */
export async function sprangOwners(
  input: SprangOwnersInput,
  sprangRoot: string,
): Promise<SprangOwnersResult | { error: string; code: string; remedy: string }> {
  const file = input.file.startsWith('file:') ? input.file.slice('file:'.length) : input.file;
  const history = await readRepoHistory(sprangRoot, { sinceMonths: input.since_months ?? 24 });
  if (history.empty) {
    return {
      error: 'No git history available for this project.',
      code: 'NO_HISTORY',
      remedy: 'Ownership is derived from git. Ensure this is a repository with commits.',
    };
  }

  const own = computeOwnership(history).get(file);
  if (!own) {
    return {
      error: `No commits touching ${file} in the last ${history.sinceMonths} months.`,
      code: 'NO_HISTORY_FOR_FILE',
      remedy: 'Widen the window with since_months, or check the path is correct.',
    };
  }

  const guidance =
    own.busFactor === 1 && own.topShare > 0.8
      ? `${own.mainDeveloper} holds ${Math.round(own.topShare * 100)}% of the knowledge here. ` +
        `Bus factor 1 — changes should be reviewed by someone else deliberately.`
      : own.knowledgeDiffusion > 0.9
        ? `Knowledge is highly diffused (${own.authors.length} contributors, none dominant). ` +
          `Nobody clearly owns this; expect inconsistent conventions.`
        : `${own.mainDeveloper} is the primary owner. Bus factor ${own.busFactor}.`;

  return {
    file,
    window_months: history.sinceMonths,
    main_developer: own.mainDeveloper,
    top_share: own.topShare,
    bus_factor: own.busFactor,
    knowledge_diffusion: own.knowledgeDiffusion,
    minor_contributors: own.minorContributors,
    authors: own.authors.slice(0, 8).map((a) => ({
      name: a.name,
      commits: a.commits,
      share: Math.round(a.share * 100) / 100,
      last_touched: a.lastDate.slice(0, 10),
    })),
    guidance,
  };
}
