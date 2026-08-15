import { readRepoHistory, detectTraps, type Trap } from '@sprang/core';

export interface SprangTrapsInput {
  /** File path or `file:<path>` node id. Omit for a repo-wide report. */
  file?: string;
  since_months?: number;
  limit?: number;
}

export interface SprangTrapsResult {
  scope: string;
  window_months: number;
  files_with_history: number;
  traps: Array<{
    file: string;
    kind: 'reverted' | 'quick_fix';
    what_happened: string;
    hours_to_correction: number;
    commit: string;
    corrected_by: string;
  }>;
  guidance: string;
}

/**
 * Changes to this code that had to be undone.
 *
 * An agent about to edit a file benefits enormously from knowing that the last
 * three attempts were reverted within a day. This is pure git archaeology — no
 * model, no inference — and it is the cheapest way to stop an agent walking
 * into a hole the team has already fallen into twice.
 *
 * `reverted` is unambiguous: an explicit `Revert "..."` matched back to its
 * target. `quick_fix` is weaker — a fix-shaped commit landing on the same file
 * within a day of a non-fix change — so it is reported as such rather than
 * being presented with the same confidence.
 */
export async function sprangTraps(
  input: SprangTrapsInput,
  sprangRoot: string,
): Promise<SprangTrapsResult | { error: string; code: string; remedy: string }> {
  const target = input.file
    ? input.file.startsWith('file:')
      ? input.file.slice('file:'.length)
      : input.file
    : undefined;
  const sinceMonths = input.since_months ?? 12;
  const limit = input.limit ?? 15;

  const history = await readRepoHistory(sprangRoot, { sinceMonths });
  if (history.empty) {
    return {
      error: 'No git history available for this project.',
      code: 'NO_HISTORY',
      remedy: 'Trap history is derived from git. Ensure this is a repository with commits.',
    };
  }

  const all = detectTraps(history);
  const rows: SprangTrapsResult['traps'] = [];
  for (const [file, traps] of all) {
    if (target && file !== target) continue;
    for (const t of traps as Trap[]) {
      rows.push({
        file,
        kind: t.kind,
        what_happened:
          t.kind === 'reverted'
            ? `"${t.subject}" was reverted`
            : `"${t.subject}" needed a fix ${t.hoursToCorrection.toFixed(1)}h later`,
        hours_to_correction: Math.round(t.hoursToCorrection * 10) / 10,
        commit: t.sha.slice(0, 8),
        corrected_by: t.correctedBySubject,
      });
    }
  }
  rows.sort((a, b) => a.hours_to_correction - b.hours_to_correction);

  const scope = target ?? '(whole repository)';
  return {
    scope,
    window_months: history.sinceMonths,
    files_with_history: all.size,
    traps: rows.slice(0, limit),
    guidance:
      rows.length === 0
        ? `No changes to ${scope} were reverted or urgently fixed in the last ${history.sinceMonths} months.`
        : `${rows.length} past change(s) here went wrong. Read what was corrected before making a similar edit. ` +
          `"reverted" is definitive; "quick_fix" is a weaker heuristic and may be ordinary iteration.`,
  };
}
