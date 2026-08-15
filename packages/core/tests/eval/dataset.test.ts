import { describe, it, expect } from 'vitest';
import { buildEvalDataset, redactPaths } from '../../src/eval/dataset.js';
import type { EvalExample } from '../../src/eval/dataset.js';
import { classifySubject } from '../../src/behavioral/history.js';
import type { HistoryCommit, RepoHistory } from '../../src/behavioral/history.js';

/** Days ago, as an ISO timestamp, so the `sinceMonths` window never expires. */
function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function commit(
  sha: string,
  subject: string,
  paths: string[],
  date = daysAgo(10),
): HistoryCommit {
  const cls = classifySubject(subject);
  return {
    sha,
    date,
    author: 'Ada',
    email: 'ada@example.com',
    subject,
    files: paths.map((path) => ({ path, added: 3, deleted: 1 })),
    isBugFix: cls.isBugFix,
    isRevert: cls.isRevert,
  };
}

function history(commits: HistoryCommit[]): RepoHistory {
  return { commits, sinceMonths: 24, empty: commits.length === 0 };
}

/** The oldest commit has no predecessor to index at, so every fixture needs a
 *  filler ancestor before the commit under test. */
const ANCHOR = commit('anchor0', 'chore: initial project scaffolding', ['src/boot.ts'], daysAgo(400));

function bySha(examples: EvalExample[], sha: string): EvalExample | undefined {
  return examples.find((e) => e.sha === sha);
}

// ─── redactPaths ─────────────────────────────────────────────────────────────

describe('redactPaths', () => {
  it('removes the full path', () => {
    expect(redactPaths('Fix crash in src/auth/session.ts on expiry', ['src/auth/session.ts'])).toBe(
      'Fix crash in <file> on expiry',
    );
  });

  it('removes the bare basename', () => {
    expect(redactPaths('Fix session.ts null deref', ['src/auth/session.ts'])).toBe(
      'Fix <file> null deref',
    );
  });

  it('removes the basename without its extension', () => {
    expect(redactPaths('Fix the session expiry handler', ['src/auth/session.ts'])).toBe(
      'Fix the <file> expiry handler',
    );
  });

  it('removes directory names', () => {
    const out = redactPaths('Fix the behavioral history parser', [
      'packages/core/src/behavioral/history.ts',
    ]);
    expect(out).not.toMatch(/behavioral/i);
    expect(out).not.toMatch(/history/i);
  });

  it('is case-insensitive', () => {
    expect(redactPaths('Fix SESSION handling', ['src/session.ts'])).toBe('Fix <file> handling');
  });

  it('removes the snake_case spelling of a camelCase basename', () => {
    const out = redactPaths('Fix the user_profile loader', ['src/userProfile.ts']);
    expect(out).toBe('Fix the <file> loader');
  });

  it('removes the spaced spelling of a camelCase basename', () => {
    const out = redactPaths('Fix a null deref in the user profile loader', [
      'src/userProfile.ts',
    ]);
    expect(out).not.toMatch(/user profile/i);
    expect(out).toContain('<file>');
  });

  it('removes the camelCase spelling of a snake_case basename', () => {
    const out = redactPaths('Fix parseGitLog output', ['src/parse_git_log.py']);
    expect(out).not.toMatch(/parsegitlog/i);
  });

  it('removes the kebab-case and PascalCase spellings too', () => {
    expect(redactPaths('Fix user-profile rendering', ['src/userProfile.ts'])).not.toMatch(
      /user-profile/i,
    );
    expect(redactPaths('Fix UserProfile rendering', ['src/userProfile.ts'])).not.toMatch(
      /UserProfile/,
    );
  });

  it('removes a token embedded inside a larger identifier', () => {
    const out = redactPaths('Fix updateUserProfileCache invalidation', ['src/userProfile.ts']);
    expect(out).not.toMatch(/userprofile/i);
  });

  it('handles multiple ground-truth paths and collapses adjacent holes', () => {
    const out = redactPaths('Fix session.ts and token.ts refresh race', [
      'src/session.ts',
      'src/token.ts',
    ]);
    expect(out).toBe('Fix <file> refresh race');
  });

  it('only redacts short tokens on a whole-word match', () => {
    // Basename "db" must not shred "dbg" or "adb" inside other words.
    const out = redactPaths('Fix db handling in the adbg subsystem', ['src/db.ts']);
    expect(out).toContain('adbg');
    expect(out).toContain('<file>');
  });

  it('leaves a subject with no leakage untouched apart from whitespace', () => {
    const subject = 'Fix a race condition when two writers flush concurrently';
    expect(redactPaths(subject, ['src/auth/session.ts'])).toBe(subject);
  });

  it('returns an empty string for an empty subject and is a no-op for no paths', () => {
    expect(redactPaths('', ['src/a.ts'])).toBe('');
    expect(redactPaths('Fix a thing', [])).toBe('Fix a thing');
  });

  it('does not let a later short token match inside the <file> marker it emitted', () => {
    // The stem of `file.ts` is "file"; a naive implementation replaces with
    // the literal "<file>" and then eats its own output.
    const out = redactPaths('Fix file.ts and the profile writer', ['src/file.ts']);
    expect(out).toContain('<file>');
    expect(out).not.toContain('<<');
  });
});

// ─── buildEvalDataset ────────────────────────────────────────────────────────

describe('buildEvalDataset', () => {
  const goodSubject = 'Fix a null dereference when the auth token expires mid upload';

  it('keeps bug-fix commits and redacts the query', () => {
    const c = commit('c1', `${goodSubject} in session.ts`, ['src/auth/session.ts']);
    const out = buildEvalDataset(history([ANCHOR, c]));
    expect(out).toHaveLength(1);
    expect(out[0]?.sha).toBe('c1');
    expect(out[0]?.groundTruth).toEqual(['src/auth/session.ts']);
    expect(out[0]?.query).not.toMatch(/session/i);
  });

  it('keeps a non-fix commit that references an issue', () => {
    const c = commit('c1', 'PROJ-1421 the retry loop never backs off under load', [
      'src/net/retry.ts',
    ]);
    expect(c.isBugFix).toBe(false);
    expect(buildEvalDataset(history([ANCHOR, c]))).toHaveLength(1);
  });

  it('drops commits that are neither fixes nor issue-referencing', () => {
    const c = commit('c1', 'Add a brand new streaming exporter for the analytics pipeline', [
      'src/export.ts',
    ]);
    expect(buildEvalDataset(history([ANCHOR, c]))).toHaveLength(0);
  });

  it('excludes merge commits', () => {
    const merge = commit('m1', 'Merge pull request #42 fixing the session expiry crash', [
      'src/auth/session.ts',
    ]);
    expect(merge.isBugFix).toBe(true);
    expect(buildEvalDataset(history([ANCHOR, merge]))).toHaveLength(0);
  });

  it('enforces the maximum changed-file count', () => {
    const many = Array.from({ length: 6 }, (_, i) => `src/mod${i}.ts`);
    const c = commit('c1', goodSubject, many);
    expect(buildEvalDataset(history([ANCHOR, c]))).toHaveLength(0);
    expect(buildEvalDataset(history([ANCHOR, c]), { maxFiles: 10 })).toHaveLength(1);
  });

  it('enforces the minimum changed-file count', () => {
    const c = commit('c1', goodSubject, ['src/a.ts', 'src/b.ts']);
    expect(buildEvalDataset(history([ANCHOR, c]), { minFiles: 3 })).toHaveLength(0);
    expect(buildEvalDataset(history([ANCHOR, c]), { minFiles: 2 })).toHaveLength(1);
  });

  it('drops commits with zero files', () => {
    expect(buildEvalDataset(history([ANCHOR, commit('c1', goodSubject, [])]))).toHaveLength(0);
  });

  it('drops a commit if any changed file is not source', () => {
    const c = commit('c1', goodSubject, ['src/auth/session.ts', 'pnpm-lock.yaml']);
    expect(buildEvalDataset(history([ANCHOR, c]))).toHaveLength(0);
  });

  it('honours a custom source extension list', () => {
    const c = commit('c1', goodSubject, ['config/app.yaml']);
    expect(buildEvalDataset(history([ANCHOR, c]))).toHaveLength(0);
    expect(
      buildEvalDataset(history([ANCHOR, c]), { sourceExtensions: ['.yaml'] }),
    ).toHaveLength(1);
  });

  it('drops queries that are too short after redaction', () => {
    const short = commit('c1', 'Fix session.ts', ['src/auth/session.ts']);
    expect(buildEvalDataset(history([ANCHOR, short]))).toHaveLength(0);
    expect(buildEvalDataset(history([ANCHOR, short]), { minQueryLength: 1 })).toHaveLength(1);
  });

  it('drops a subject that was nothing but a filename', () => {
    const c = commit('c1', 'src/auth/session.ts', ['src/auth/session.ts']);
    expect(buildEvalDataset(history([ANCHOR, c]), { minQueryLength: 1 })).toHaveLength(0);
  });

  it('de-duplicates repeated paths in the changeset', () => {
    const c = commit('c1', goodSubject, ['src/a.ts', 'src/a.ts', 'src/b.ts']);
    const out = buildEvalDataset(history([ANCHOR, c]));
    expect(out[0]?.groundTruth).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('uses the previous commit (oldest-first) as the approximate parent', () => {
    const older = commit('older', 'Add the exporter module', ['src/export.ts'], daysAgo(20));
    const fix = commit('fix', goodSubject, ['src/export.ts'], daysAgo(5));
    const out = buildEvalDataset(history([fix, older, ANCHOR]));
    expect(bySha(out, 'fix')?.parentSha).toBe('older');
  });

  it('never emits an example whose parentSha equals its own sha', () => {
    const commits = [
      ANCHOR,
      commit('c1', goodSubject, ['src/a.ts'], daysAgo(30)),
      commit('c2', goodSubject, ['src/b.ts'], daysAgo(20)),
    ];
    for (const e of buildEvalDataset(history(commits))) {
      expect(e.parentSha).not.toBe(e.sha);
      expect(e.parentSha.length).toBeGreaterThan(0);
    }
  });

  it('skips the very oldest commit, which has no ancestor to index at', () => {
    const only = commit('only', goodSubject, ['src/a.ts']);
    expect(buildEvalDataset(history([only]))).toHaveLength(0);
  });

  it('orders output newest first and applies the limit', () => {
    const commits = [
      ANCHOR,
      commit('c1', goodSubject, ['src/a.ts'], daysAgo(30)),
      commit('c2', goodSubject, ['src/b.ts'], daysAgo(20)),
      commit('c3', goodSubject, ['src/c.ts'], daysAgo(10)),
    ];
    const out = buildEvalDataset(history(commits));
    expect(out.map((e) => e.sha)).toEqual(['c3', 'c2', 'c1']);
    expect(buildEvalDataset(history(commits), { limit: 2 }).map((e) => e.sha)).toEqual([
      'c3',
      'c2',
    ]);
  });

  it('is deterministic regardless of input ordering', () => {
    const commits = [
      ANCHOR,
      commit('c1', goodSubject, ['src/a.ts'], daysAgo(30)),
      commit('c2', goodSubject, ['src/b.ts'], daysAgo(20)),
      commit('c3', goodSubject, ['src/c.ts'], daysAgo(10)),
    ];
    const forward = buildEvalDataset(history(commits));
    const reversed = buildEvalDataset(history([...commits].reverse()));
    expect(JSON.stringify(reversed)).toBe(JSON.stringify(forward));
    expect(JSON.stringify(buildEvalDataset(history(commits)))).toBe(JSON.stringify(forward));
  });

  it('breaks ties on identical timestamps deterministically', () => {
    const same = daysAgo(7);
    const commits = [
      ANCHOR,
      commit('bbb', goodSubject, ['src/b.ts'], same),
      commit('aaa', goodSubject, ['src/a.ts'], same),
    ];
    const out = buildEvalDataset(history(commits)).map((e) => e.sha);
    expect(out).toEqual(buildEvalDataset(history([...commits].reverse())).map((e) => e.sha));
    expect(out).toContain('bbb');
  });

  it('excludes commits outside the sinceMonths window', () => {
    const old = commit('old', goodSubject, ['src/a.ts'], daysAgo(3 * 365));
    const recent = commit('recent', goodSubject, ['src/b.ts'], daysAgo(30));
    const out = buildEvalDataset(history([ANCHOR, old, recent]));
    expect(out.map((e) => e.sha)).toEqual(['recent']);
  });

  it('returns nothing for an empty history', () => {
    expect(buildEvalDataset(history([]))).toEqual([]);
  });

  it('would catch a query that leaked its own filename', () => {
    // The guarantee the whole benchmark rests on: for every emitted example,
    // no basename, stem or directory of the ground truth survives in the query.
    const commits = [
      ANCHOR,
      commit(
        'c1',
        'Fix the intermittent crash in packages/core/src/behavioral/history.ts when the log output is completely empty',
        ['packages/core/src/behavioral/history.ts'],
      ),
      commit('c2', 'Fix userProfile avatar upload failing for large images on retry', [
        'src/user/userProfile.ts',
      ]),
      commit('c3', 'Bug: the retry_scheduler drops jobs queued during a leader election', [
        'src/jobs/retryScheduler.go',
      ]),
    ];
    const out = buildEvalDataset(history(commits));
    expect(out.length).toBe(3);

    for (const example of out) {
      const lower = example.query.toLowerCase();
      for (const path of example.groundTruth) {
        const basename = path.split('/').pop() ?? path;
        const stem = basename.replace(/\.[^.]+$/, '');
        expect(lower).not.toContain(path.toLowerCase());
        expect(lower).not.toContain(basename.toLowerCase());
        expect(lower).not.toContain(stem.toLowerCase());
        expect(lower).not.toContain(stem.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase());
      }
    }
  });

  it('proves the redaction is load-bearing: the raw subject would leak', () => {
    const subject = 'Fix userProfile avatar upload failing for large images on retry';
    const c = commit('c1', subject, ['src/user/userProfile.ts']);
    expect(subject.toLowerCase()).toContain('userprofile');
    const out = buildEvalDataset(history([ANCHOR, c]));
    expect(out[0]?.query.toLowerCase()).not.toContain('userprofile');
  });
});
