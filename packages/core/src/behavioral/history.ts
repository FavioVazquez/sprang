import { simpleGit } from 'simple-git';

/** One commit, with the files it touched and how much of each. */
export interface HistoryCommit {
  sha: string;
  /** Full ISO-8601 author timestamp. Day precision is not enough: the
   *  repeat-mistake detector reasons about hours between a change and its
   *  correction, and `--date=short` collapses every same-day gap to zero. */
  date: string;
  author: string;
  email: string;
  subject: string;
  files: Array<{ path: string; added: number; deleted: number }>;
  /** Commit message looks like a bug fix (SZZ-style heuristic). */
  isBugFix: boolean;
  /** `Revert "..."` — git's own generated subject for a revert. */
  isRevert: boolean;
  /** For a revert commit, the subject line it claims to be reverting. */
  revertsSubject?: string;
}

export interface RepoHistory {
  commits: HistoryCommit[];
  /** The window actually used, so callers can report it honestly. */
  sinceMonths: number;
  /** True when git was unavailable or the repo has no history. */
  empty: boolean;
}

/**
 * Commit subjects that indicate a fix.
 *
 * This is the SZZ heuristic (Śliwerski, Zimmermann & Zeller, MSR 2005) and it
 * is the single strongest defect predictor available from history alone: files
 * that have been fixed before get fixed again.
 *
 * Deliberately anchored with word boundaries. An unanchored /fix/ matches
 * "prefix", "suffix" and "fixture", which on a test-heavy repo would classify
 * most of the history as bug fixes.
 */
const BUG_FIX_RE =
  /\b(fix(e[sd])?|bugfix|hotfix|bug|defect|patch(e[sd])?|resolve[sd]?|repair(ed)?|correct(ed)?|regression|crash|broken)\b/i;

/** An issue or ticket reference — weaker evidence, used only as a tiebreak. */
const ISSUE_REF_RE = /(#\d+|\b[A-Z][A-Z0-9]+-\d+\b)/;

const REVERT_RE = /^Revert\s+"(.+)"\s*$/;

export function classifySubject(subject: string): {
  isBugFix: boolean;
  isRevert: boolean;
  revertsSubject?: string;
} {
  const revertMatch = REVERT_RE.exec(subject.trim());
  if (revertMatch) {
    return { isBugFix: false, isRevert: true, revertsSubject: revertMatch[1] };
  }
  return { isBugFix: BUG_FIX_RE.test(subject), isRevert: false };
}

export function hasIssueReference(subject: string): boolean {
  return ISSUE_REF_RE.test(subject);
}

/**
 * Read the whole repository history in a single `git log` pass.
 *
 * Everything behavioural — hotspots, change coupling, ownership, bus factor,
 * code age, bug-fix counts, revert archaeology — is derived from this one
 * traversal. Running a separate `git log` per file (which is what the existing
 * per-node decision-context layer does) costs one process per file; this costs
 * one process for the repository.
 *
 * Notes on the flags, each of which matters:
 *   --numstat      per-file added/deleted counts, the basis for churn and ownership
 *   --use-mailmap  collapses "Jane Doe" / "jane.doe" / "jdoe@corp" into one person
 *   --no-renames   keeps changesets intact; rename-following distorts co-change
 *   --since        bounded window; mixing pre- and post-rewrite history is the
 *                  most common way these metrics end up meaningless
 *   -z is NOT used: numstat's record layout is easier to parse line-wise, and
 *                  the custom `--` prefix disambiguates headers from numstat rows
 */
export async function readRepoHistory(
  repoRoot: string,
  options: { sinceMonths?: number; maxCommits?: number } = {},
): Promise<RepoHistory> {
  const sinceMonths = options.sinceMonths ?? 12;
  const maxCommits = options.maxCommits ?? 20_000;

  let raw: string;
  try {
    const git = simpleGit(repoRoot);
    raw = await git.raw([
      'log',
      '--all',
      '--numstat',
      '--use-mailmap',
      '--no-renames',
      `--since=${sinceMonths} months ago`,
      `--max-count=${maxCommits}`,
      // A leading marker no numstat line can produce, so the parser never has
      // to guess whether a line is a header or a file record.
      '--pretty=format:\u0001%H\u0001%aI\u0001%aN\u0001%aE\u0001%s',
    ]);
  } catch {
    return { commits: [], sinceMonths, empty: true };
  }

  const commits = parseGitLog(raw);
  return { commits, sinceMonths, empty: commits.length === 0 };
}

/** Exported for testing: parse the output of the log invocation above. */
export function parseGitLog(raw: string): HistoryCommit[] {
  const commits: HistoryCommit[] = [];
  let current: HistoryCommit | null = null;

  for (const line of raw.split('\n')) {
    if (line.startsWith('\u0001')) {
      if (current) commits.push(current);
      const [sha, date, author, email, ...rest] = line.slice(1).split('\u0001');
      const subject = rest.join('\u0001');
      const cls = classifySubject(subject ?? '');
      current = {
        sha: sha ?? '',
        date: date ?? '',
        author: author ?? '',
        email: email ?? '',
        subject: subject ?? '',
        files: [],
        isBugFix: cls.isBugFix,
        isRevert: cls.isRevert,
        ...(cls.revertsSubject !== undefined ? { revertsSubject: cls.revertsSubject } : {}),
      };
      continue;
    }

    if (!current || line.trim() === '') continue;

    // numstat: "<added>\t<deleted>\t<path>"; binary files report "-\t-\tpath".
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const [addedRaw, deletedRaw, ...pathParts] = parts;
    const path = pathParts.join('\t').trim();
    if (!path) continue;
    current.files.push({
      path,
      added: addedRaw === '-' ? 0 : Number.parseInt(addedRaw ?? '0', 10) || 0,
      deleted: deletedRaw === '-' ? 0 : Number.parseInt(deletedRaw ?? '0', 10) || 0,
    });
  }

  if (current) commits.push(current);
  return commits;
}
