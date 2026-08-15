/**
 * Build a retrieval evaluation dataset out of a repository's own git history.
 *
 * The idea, and why it is worth having:
 *
 * Every merged bug-fix commit is a free, uncontaminated, labelled retrieval
 * example. The commit message is the query a developer would have typed
 * ("crash when the session token expires mid-upload"); the files the commit
 * actually changed are the ground truth an ideal retriever would have handed
 * back. Nobody had to hand-label anything, and — critically — the labels come
 * from the user's *own* repository, so the benchmark measures whether Sprang
 * helps on their code rather than on someone's curated public set.
 *
 * Two things have to be right or the benchmark is worthless:
 *
 *  1. **No leakage through the query.** If the subject line says
 *     "fix null deref in userProfile.ts" then `grep` scores 100% and the
 *     benchmark measures nothing. Every filename, basename, basename stem,
 *     directory name and camelCase/snake_case spelling thereof is redacted to
 *     `<file>` before the example is emitted. See {@link redactPaths}.
 *
 *  2. **No leakage through the index.** The retriever must be indexed at the
 *     commit *before* the fix. Indexing at the fix means the answer is already
 *     in the corpus — often as the literal changed lines. Each example carries
 *     a {@link EvalExample.parentSha} so a caller can
 *     `git worktree add <tmp> <parentSha>` and index that.
 */

import type { HistoryCommit, RepoHistory } from '../behavioral/history.js';
import { hasIssueReference } from '../behavioral/history.js';

/** One labelled retrieval example derived from a single bug-fix commit. */
export interface EvalExample {
  sha: string;
  /** The query, with filenames redacted. */
  query: string;
  /** Ground truth: files the commit actually changed. */
  groundTruth: string[];
  /** Commit to index at — the PARENT. Indexing at the fix leaks the answer. */
  parentSha: string;
  date: string;
}

export interface DatasetOptions {
  /**
   * Window, in months back from now, that commits must fall inside.
   *
   * This mirrors the `sinceMonths` passed to `readRepoHistory`, and is applied
   * again here because a caller may hand in a wider history than they want to
   * evaluate over. Old commits make poor examples: the files they name may not
   * exist any more, so the ground truth is unretrievable by construction.
   */
  sinceMonths?: number;
  minFiles?: number;
  maxFiles?: number;
  minQueryLength?: number;
  limit?: number;
  sourceExtensions?: string[];
}

/**
 * Extensions that count as "source".
 *
 * A commit that only touches lockfiles, snapshots, generated protobufs or
 * changelogs is not a localizable code-retrieval task, and including it
 * silently drags every metric down for reasons that have nothing to do with
 * the retriever.
 */
export const DEFAULT_SOURCE_EXTENSIONS: readonly string[] = [
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.kts',
  '.rb',
  '.php',
  '.cs',
  '.c',
  '.h',
  '.cc',
  '.cpp',
  '.hpp',
  '.m',
  '.mm',
  '.swift',
  '.scala',
  '.sh',
  '.sql',
  '.vue',
  '.svelte',
  '.ex',
  '.exs',
  '.dart',
];

const DEFAULTS = {
  sinceMonths: 24,
  minFiles: 1,
  maxFiles: 5,
  minQueryLength: 40,
  limit: 200,
} as const;

/**
 * Placeholder used while redacting.
 *
 * A NUL is used rather than the literal `<file>` so that a later, shorter
 * token (say the stem `file`, from a path `src/file.ts`) cannot match inside
 * text this function itself produced. It is swapped for `<file>` at the end.
 */
const HOLE = '\u0000';

/** Tokens shorter than this are only redacted on a whole-word match. */
const SUBSTRING_MIN_LENGTH = 4;

/** Mean Gregorian month, used only for the `sinceMonths` window. */
const AVERAGE_MONTH_MS = 30.436875 * 24 * 60 * 60 * 1000;

// ─── Redaction ───────────────────────────────────────────────────────────────

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Split an identifier into lowercase words across camelCase, snake_case,
 *  kebab-case, dots and spaces. `HTTPServerV2` → ["http","server","v2"]. */
function splitWords(input: string): string[] {
  return input
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter((w) => w.length > 0)
    .map((w) => w.toLowerCase());
}

function capitalize(w: string): string {
  return w.length === 0 ? w : `${w.charAt(0).toUpperCase()}${w.slice(1)}`;
}

/** Every plausible written spelling of a multi-word identifier. */
function caseVariants(words: string[]): string[] {
  if (words.length === 0) return [];
  const flat = words.join('');
  const camel = words
    .map((w, i) => (i === 0 ? w : capitalize(w)))
    .join('');
  const pascal = words.map(capitalize).join('');
  return [
    flat,
    camel,
    pascal,
    words.join('_'),
    words.join('-'),
    words.join(' '),
    words.join('.'),
    words.join('_').toUpperCase(),
  ];
}

/** All the strings that, if left in a query, would leak `path`. */
function leakTokens(path: string): string[] {
  const clean = path.replace(/^\.\//, '').trim();
  if (clean.length === 0) return [];

  const tokens = new Set<string>();
  tokens.add(clean);

  const segments = clean.split('/').filter((s) => s.length > 0);
  const basename = segments[segments.length - 1] ?? clean;
  const dotIndex = basename.lastIndexOf('.');
  const stem = dotIndex > 0 ? basename.slice(0, dotIndex) : basename;

  tokens.add(basename);
  tokens.add(stem);

  // The path without its extension, e.g. `src/user/profile`.
  const withoutExt = clean.slice(0, clean.length - (basename.length - stem.length));
  tokens.add(withoutExt);

  // Directory names: `src`, `user`. A subject saying "fix the crash in
  // behavioral/history" leaks just as surely as one naming the file.
  for (const dir of segments.slice(0, -1)) {
    tokens.add(dir);
    for (const v of caseVariants(splitWords(dir))) tokens.add(v);
  }

  // camelCase / snake_case / kebab-case rewrites of the stem, so that a
  // subject saying "user profile" or "user_profile" is caught for a file
  // called `userProfile.ts`.
  for (const v of caseVariants(splitWords(stem))) tokens.add(v);

  return [...tokens].filter((t) => t.length >= 2);
}

/**
 * Remove every trace of `paths` from `subject`, replacing each hit with
 * `<file>`.
 *
 * Matching is case-insensitive. Tokens of four characters or more are removed
 * even when they appear inside a larger identifier (`updateUserProfile` →
 * `update<file>`), because a retriever that string-matches on a substring is
 * just as much of a cheat as one that matches the whole word. Shorter tokens
 * (`db`, `api`, `fs`) are only removed on a whole-word match, otherwise a file
 * called `db.ts` would shred every query containing the letters "db".
 *
 * Longest tokens are applied first so that the full path is consumed before
 * its own basename can carve it up.
 */
export function redactPaths(subject: string, paths: string[]): string {
  let out = subject;
  if (out.length === 0) return '';

  const tokens = new Set<string>();
  for (const p of paths) for (const t of leakTokens(p)) tokens.add(t);

  const ordered = [...tokens].sort((a, b) => b.length - a.length || a.localeCompare(b));

  for (const token of ordered) {
    const escaped = escapeRegExp(token);
    const pattern =
      token.length >= SUBSTRING_MIN_LENGTH
        ? new RegExp(escaped, 'gi')
        : new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, 'gi');
    out = out.replace(pattern, HOLE);
  }

  // `<file> and <file>` / `<file>, <file>` / `<file>/<file>` all collapse to a
  // single hole; the count of redacted files is not part of the query.
  let previous: string;
  do {
    previous = out;
    out = out.replace(
      new RegExp(`${HOLE}(?:[\\s,/&+]|and\\b|in\\b|the\\b)*${HOLE}`, 'gi'),
      HOLE,
    );
  } while (out !== previous);

  return out
    .split(HOLE)
    .join('<file>')
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── Dataset construction ────────────────────────────────────────────────────

function isMergeCommit(commit: HistoryCommit): boolean {
  return commit.subject.trimStart().startsWith('Merge ');
}

function uniquePaths(commit: HistoryCommit): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const f of commit.files) {
    const p = f.path.trim();
    if (p.length === 0 || seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}

function hasSourceExtension(path: string, extensions: readonly string[]): boolean {
  const lower = path.toLowerCase();
  return extensions.some((ext) => lower.endsWith(ext.toLowerCase()));
}

/** Oldest-first, with sha as a deterministic tiebreak for equal timestamps. */
function byDateAscending(a: HistoryCommit, b: HistoryCommit): number {
  return a.date.localeCompare(b.date) || a.sha.localeCompare(b.sha);
}

/**
 * Turn a {@link RepoHistory} into a set of labelled retrieval examples.
 *
 * A commit is kept only if all of the following hold:
 *  - it is not a merge commit (merges own no changes of their own);
 *  - it looks like a fix (`isBugFix`) or references an issue/ticket;
 *  - it touches between `minFiles` and `maxFiles` distinct files — a 40-file
 *    refactor is not a localizable retrieval task and would reward a retriever
 *    that returns everything;
 *  - every file it touches looks like source;
 *  - the redacted subject is still at least `minQueryLength` characters, so
 *    "fix typo" and subjects that were *entirely* filenames are dropped.
 *
 * Output is deterministic: newest first, sha as tiebreak, then `limit`.
 */
export function buildEvalDataset(history: RepoHistory, opts: DatasetOptions = {}): EvalExample[] {
  const sinceMonths = opts.sinceMonths ?? DEFAULTS.sinceMonths;
  const minFiles = opts.minFiles ?? DEFAULTS.minFiles;
  const maxFiles = opts.maxFiles ?? DEFAULTS.maxFiles;
  const minQueryLength = opts.minQueryLength ?? DEFAULTS.minQueryLength;
  const limit = opts.limit ?? DEFAULTS.limit;
  const extensions = opts.sourceExtensions ?? DEFAULT_SOURCE_EXTENSIONS;

  // `git log --pretty` as configured in behavioral/history.ts does not emit
  // %P, so the true parent sha is not available here.
  //
  // APPROXIMATION: sort the window oldest-first and treat the preceding commit
  // as the parent. This is exact for linear history (rebase/squash workflows,
  // which is what most repos with a merge queue produce) and merely
  // *approximate* across merges and topic branches, where the preceding commit
  // by date may live on another branch. It is still a commit that predates the
  // fix, which is what matters for avoiding leakage — it is just not
  // guaranteed to be the immediate ancestor. Callers who need exactness should
  // resolve `<sha>^` themselves; `parentSha` is exposed precisely so that a
  // caller can `git worktree add <dir> <parentSha>` and index there.
  const cutoff = Date.now() - sinceMonths * AVERAGE_MONTH_MS;
  const inWindow = history.commits.filter((c) => {
    const t = Date.parse(c.date);
    // An unparseable timestamp is kept rather than silently dropped: losing
    // examples to a date-format quirk is worse than a slightly wider window.
    return Number.isNaN(t) || t >= cutoff;
  });
  const ascending = [...inWindow].sort(byDateAscending);

  const examples: EvalExample[] = [];

  for (let i = 0; i < ascending.length; i += 1) {
    const commit = ascending[i];
    if (!commit) continue;

    // The oldest commit in the window has no predecessor to index at, so it
    // cannot be turned into a leak-free example.
    const parent = ascending[i - 1];
    if (!parent) continue;

    if (isMergeCommit(commit)) continue;
    if (!commit.isBugFix && !hasIssueReference(commit.subject)) continue;

    const groundTruth = uniquePaths(commit);
    if (groundTruth.length < minFiles || groundTruth.length > maxFiles) continue;
    if (!groundTruth.every((p) => hasSourceExtension(p, extensions))) continue;

    const query = redactPaths(commit.subject, groundTruth);
    if (query.length < minQueryLength) continue;

    examples.push({
      sha: commit.sha,
      query,
      groundTruth,
      parentSha: parent.sha,
      date: commit.date,
    });
  }

  examples.sort((a, b) => b.date.localeCompare(a.date) || a.sha.localeCompare(b.sha));
  // Deduplicate by (query, ground truth).
  //
  // `git log --all` walks every ref, so a cherry-picked or rebased branch
  // contributes the same logical change under two shas — and a rewritten
  // history leaves the pre-rewrite commits reachable from a backup ref. Two
  // identical examples would silently double-weight one query in every metric.
  const seenExamples = new Set<string>();
  const deduped = examples.filter((example) => {
    const key = `${example.query}\u0000${[...example.groundTruth].sort().join('|')}`;
    if (seenExamples.has(key)) return false;
    seenExamples.add(key);
    return true;
  });

  return limit >= 0 ? deduped.slice(0, limit) : deduped;
}
