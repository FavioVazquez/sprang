import { describe, it, expect } from 'vitest';
import { parseGitLog, classifySubject } from '../../src/behavioral/history.js';
import type { RepoHistory } from '../../src/behavioral/history.js';
import {
  computeChurn,
  computeChangeCoupling,
  computeOwnership,
  computeHotspots,
  detectTraps,
  MAX_CHANGESET_SIZE,
} from '../../src/behavioral/analysis.js';

const U = '\u0001';

/** Build the exact shape `git log --numstat --pretty=format:...` produces. */
function log(
  commits: Array<{
    sha: string;
    date: string;
    author?: string;
    email?: string;
    subject: string;
    files: Array<[number | '-', number | '-', string]>;
  }>,
): string {
  return commits
    .map(
      (c) =>
        `${U}${c.sha}${U}${c.date}${U}${c.author ?? 'Ann'}${U}${c.email ?? 'ann@x'}${U}${c.subject}\n` +
        c.files.map(([a, d, p]) => `${a}\t${d}\t${p}`).join('\n'),
    )
    .join('\n');
}

const history = (raw: string): RepoHistory => ({
  commits: parseGitLog(raw),
  sinceMonths: 12,
  empty: false,
});

describe('parseGitLog', () => {
  it('parses headers, numstat rows and multi-file commits', () => {
    const commits = parseGitLog(
      log([
        { sha: 'a1', date: '2026-01-02T10:00:00Z', subject: 'add thing', files: [[10, 2, 'src/a.ts'], [1, 0, 'src/b.ts']] },
      ]),
    );
    expect(commits).toHaveLength(1);
    expect(commits[0]!.files).toHaveLength(2);
    expect(commits[0]!.files[0]).toEqual({ path: 'src/a.ts', added: 10, deleted: 2 });
  });

  it('treats binary "-" counts as zero rather than NaN', () => {
    const commits = parseGitLog(
      log([{ sha: 'a1', date: '2026-01-02T10:00:00Z', subject: 'img', files: [['-', '-', 'logo.png']] }]),
    );
    expect(commits[0]!.files[0]).toEqual({ path: 'logo.png', added: 0, deleted: 0 });
  });

  it('handles paths containing tabs', () => {
    const raw = `${U}a1${U}2026-01-02T10:00:00Z${U}Ann${U}a@x${U}s\n1\t1\tsrc/we\tird.ts`;
    expect(parseGitLog(raw)[0]!.files[0]!.path).toBe('src/we\tird.ts');
  });

  it('returns nothing for empty input rather than throwing', () => {
    expect(parseGitLog('')).toEqual([]);
  });
});

describe('classifySubject', () => {
  it('detects fixes by whole word', () => {
    expect(classifySubject('fix: null deref').isBugFix).toBe(true);
    expect(classifySubject('hotfix login').isBugFix).toBe(true);
    expect(classifySubject('resolve crash on save').isBugFix).toBe(true);
  });

  it('does not match "fix" inside other words', () => {
    // An unanchored /fix/ classifies most of a test-heavy repo as bug fixes.
    expect(classifySubject('add prefix handling').isBugFix).toBe(false);
    expect(classifySubject('rename suffix var').isBugFix).toBe(false);
    expect(classifySubject('add fixtures for parser').isBugFix).toBe(false);
  });

  it('detects reverts and captures the reverted subject', () => {
    const r = classifySubject('Revert "feat: add caching"');
    expect(r.isRevert).toBe(true);
    expect(r.revertsSubject).toBe('feat: add caching');
    expect(r.isBugFix).toBe(false);
  });
});

describe('computeChurn', () => {
  const h = history(
    log([
      { sha: 'c3', date: '2026-03-01T10:00:00Z', subject: 'fix: bad math', files: [[1, 1, 'src/a.ts']] },
      { sha: 'c2', date: '2026-02-01T10:00:00Z', subject: 'feat: more', files: [[5, 0, 'src/a.ts']] },
      { sha: 'c1', date: '2026-01-01T10:00:00Z', subject: 'feat: init', files: [[20, 0, 'src/a.ts'], [3, 0, 'src/b.ts']] },
    ]),
  );

  it('counts revisions, lines and bug fixes per file', () => {
    const churn = computeChurn(h, Date.parse('2026-04-01T00:00:00Z'));
    const a = churn.get('src/a.ts')!;
    expect(a.revisions).toBe(3);
    expect(a.linesAdded).toBe(26);
    expect(a.bugFixes).toBe(1);
  });

  it('tracks first and last change regardless of log order', () => {
    const churn = computeChurn(h, Date.parse('2026-04-01T00:00:00Z'));
    const a = churn.get('src/a.ts')!;
    expect(a.firstChange.startsWith('2026-01-01')).toBe(true);
    expect(a.lastChange.startsWith('2026-03-01')).toBe(true);
  });

  it('computes age in months from the last change', () => {
    const churn = computeChurn(h, Date.parse('2026-06-01T00:00:00Z'));
    expect(churn.get('src/a.ts')!.ageMonths).toBe(3);
  });
});

describe('computeChangeCoupling', () => {
  /** n commits touching both a and b. */
  const together = (n: number) =>
    log(
      Array.from({ length: n }, (_, i) => ({
        sha: `s${i}`,
        date: `2026-01-${String((i % 27) + 1).padStart(2, '0')}T10:00:00Z`,
        subject: `change ${i}`,
        files: [[1, 1, 'src/a.ts'], [1, 1, 'src/b.ts']] as Array<[number, number, string]>,
      })),
    );

  it('reports a pair that always changes together at 100%', () => {
    const out = computeChangeCoupling(history(together(6)));
    expect(out).toHaveLength(1);
    expect(out[0]!.degree).toBe(100);
    expect(out[0]!.support).toBe(6);
    expect(out[0]!.pBGivenA).toBe(1);
  });

  it('suppresses pairs below the support floor', () => {
    // Two files touched together twice is a 100% coupling on n=2 — noise.
    expect(computeChangeCoupling(history(together(2)))).toEqual([]);
  });

  it('ignores sweeping commits above the changeset cap', () => {
    const wide = log([
      {
        sha: 'big',
        date: '2026-01-01T10:00:00Z',
        subject: 'reformat everything',
        files: Array.from({ length: MAX_CHANGESET_SIZE + 5 }, (_, i) => [1, 1, `src/f${i}.ts`] as [number, number, string]),
      },
    ]);
    // A single 35-file commit would otherwise manufacture 595 perfect pairs.
    expect(computeChangeCoupling(history(wide), { minSupport: 1, minDegree: 1 })).toEqual([]);
  });

  it('uses lift to discount files that are simply touched constantly', () => {
    // a+b together 6 times; a also alone 20 more times.
    const raw =
      together(6) +
      '\n' +
      log(
        Array.from({ length: 20 }, (_, i) => ({
          sha: `x${i}`,
          date: '2026-02-01T10:00:00Z',
          subject: `solo ${i}`,
          files: [[1, 1, 'src/a.ts']] as Array<[number, number, string]>,
        })),
      );
    const out = computeChangeCoupling(history(raw), { minDegree: 1 });
    const pair = out.find((c) => c.a === 'src/a.ts' && c.b === 'src/b.ts')!;
    expect(pair.pAGivenB).toBe(1); // b never changes without a
    expect(pair.pBGivenA).toBeLessThan(0.3); // but a usually changes without b
  });
});

describe('computeOwnership', () => {
  const h = history(
    log([
      { sha: 'c1', date: '2026-01-01T10:00:00Z', author: 'Ann', subject: 'a', files: [[90, 0, 'src/a.ts']] },
      { sha: 'c2', date: '2026-01-02T10:00:00Z', author: 'Bob', subject: 'b', files: [[10, 0, 'src/a.ts']] },
    ]),
  );

  it('identifies the main developer and share', () => {
    const own = computeOwnership(h, { now: Date.parse('2026-01-03T00:00:00Z') }).get('src/a.ts')!;
    expect(own.mainDeveloper).toBe('Ann');
    expect(own.topShare).toBeGreaterThan(0.8);
  });

  it('reports bus factor 1 when one person holds the majority', () => {
    const own = computeOwnership(h, { now: Date.parse('2026-01-03T00:00:00Z') }).get('src/a.ts')!;
    expect(own.busFactor).toBe(1);
  });

  it('counts minor contributors below the 5% threshold', () => {
    const raw = log([
      { sha: 'c1', date: '2026-01-01T10:00:00Z', author: 'Ann', subject: 'a', files: [[1000, 0, 'src/a.ts']] },
      { sha: 'c2', date: '2026-01-01T10:00:00Z', author: 'Tiny', subject: 'b', files: [[1, 0, 'src/a.ts']] },
    ]);
    const own = computeOwnership(history(raw), { now: Date.parse('2026-01-02T00:00:00Z') }).get('src/a.ts')!;
    expect(own.minorContributors).toBe(1);
  });

  it('decays old contributions so a departed author stops owning the file', () => {
    const raw = log([
      { sha: 'old', date: '2023-01-01T10:00:00Z', author: 'Gone', subject: 'a', files: [[500, 0, 'src/a.ts']] },
      { sha: 'new', date: '2026-01-01T10:00:00Z', author: 'Here', subject: 'b', files: [[200, 0, 'src/a.ts']] },
    ]);
    const own = computeOwnership(history(raw), { now: Date.parse('2026-01-02T00:00:00Z') }).get('src/a.ts')!;
    expect(own.mainDeveloper).toBe('Here');
  });
});

describe('computeHotspots', () => {
  it('ranks complexity x churn, not either alone', () => {
    const churn = computeChurn(
      history(
        log([
          ...Array.from({ length: 10 }, (_, i) => ({
            sha: `h${i}`, date: '2026-01-01T10:00:00Z', subject: `c${i}`,
            files: [[1, 1, 'hot.ts']] as Array<[number, number, string]>,
          })),
          { sha: 'q1', date: '2026-01-01T10:00:00Z', subject: 'once', files: [[1, 1, 'complex-but-stable.ts']] },
          { sha: 'q2', date: '2026-01-01T10:00:00Z', subject: 'twice', files: [[1, 1, 'churny-but-simple.ts']] },
          { sha: 'q3', date: '2026-01-02T10:00:00Z', subject: 'thrice', files: [[1, 1, 'churny-but-simple.ts']] },
        ]),
      ),
    );
    const complexity = new Map([
      ['hot.ts', 500],
      ['complex-but-stable.ts', 600],
      ['churny-but-simple.ts', 5],
    ]);
    const spots = computeHotspots(churn, complexity, { minScore: 0 });
    expect(spots[0]!.path).toBe('hot.ts');
  });

  it('ignores files with no complexity measurement', () => {
    const churn = computeChurn(history(log([{ sha: 'a', date: '2026-01-01T10:00:00Z', subject: 's', files: [[1, 1, 'x.ts']] }])));
    expect(computeHotspots(churn, new Map(), { minScore: 0 })).toEqual([]);
  });
});

describe('detectTraps', () => {
  it('matches an explicit revert back to the commit it reverted', () => {
    const raw = log([
      { sha: 'r1', date: '2026-01-02T10:00:00Z', subject: 'Revert "feat: caching"', files: [[1, 1, 'src/cache.ts']] },
      { sha: 'c1', date: '2026-01-01T10:00:00Z', subject: 'feat: caching', files: [[50, 0, 'src/cache.ts']] },
    ]);
    const traps = detectTraps(history(raw)).get('src/cache.ts')!;
    expect(traps[0]!.kind).toBe('reverted');
    expect(traps[0]!.sha).toBe('c1');
    expect(traps[0]!.correctedBySha).toBe('r1');
    expect(traps[0]!.hoursToCorrection).toBeCloseTo(24, 0);
  });

  it('detects a fix landing on the same file hours later', () => {
    const raw = log([
      { sha: 'f1', date: '2026-01-01T14:00:00Z', subject: 'fix: off by one', files: [[1, 1, 'src/a.ts']] },
      { sha: 'c1', date: '2026-01-01T10:00:00Z', subject: 'feat: pagination', files: [[30, 0, 'src/a.ts']] },
    ]);
    const traps = detectTraps(history(raw)).get('src/a.ts')!;
    expect(traps[0]!.kind).toBe('quick_fix');
    expect(traps[0]!.hoursToCorrection).toBeCloseTo(4, 0);
  });

  it('does not treat a fix following another fix as a trap', () => {
    // Iterative fixing is normal work, not evidence of a trap.
    const raw = log([
      { sha: 'f2', date: '2026-01-01T14:00:00Z', subject: 'fix: again', files: [[1, 1, 'src/a.ts']] },
      { sha: 'f1', date: '2026-01-01T10:00:00Z', subject: 'fix: first try', files: [[1, 1, 'src/a.ts']] },
    ]);
    expect(detectTraps(history(raw)).has('src/a.ts')).toBe(false);
  });

  it('ignores corrections outside the time window', () => {
    const raw = log([
      { sha: 'f1', date: '2026-02-01T10:00:00Z', subject: 'fix: much later', files: [[1, 1, 'src/a.ts']] },
      { sha: 'c1', date: '2026-01-01T10:00:00Z', subject: 'feat: thing', files: [[1, 1, 'src/a.ts']] },
    ]);
    expect(detectTraps(history(raw)).has('src/a.ts')).toBe(false);
  });

  it('ignores sweeping fix commits, which carry no per-file signal', () => {
    const raw = log([
      {
        sha: 'big', date: '2026-01-01T14:00:00Z', subject: 'fix: CI, docs and three bugs',
        files: Array.from({ length: MAX_CHANGESET_SIZE + 5 }, (_, i) => [1, 1, `src/f${i}.ts`] as [number, number, string]),
      },
      { sha: 'c1', date: '2026-01-01T10:00:00Z', subject: 'feat: thing', files: [[1, 1, 'src/f1.ts']] },
    ]);
    expect(detectTraps(history(raw)).size).toBe(0);
  });
});
