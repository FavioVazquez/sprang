import type { HistoryCommit, RepoHistory } from './history.js';

// ─── Tuning ──────────────────────────────────────────────────────────────────

/**
 * Commits touching more than this many files are excluded from change coupling.
 *
 * This single threshold is the difference between a useful signal and noise. A
 * "reformat everything" or "bump the licence header" commit touching 400 files
 * would otherwise manufacture ~80,000 spurious co-change pairs, all of them
 * perfectly correlated. code-maat ships the same default for the same reason.
 */
export const MAX_CHANGESET_SIZE = 30;

/**
 * Minimum number of shared commits before a coupling is reported.
 *
 * Without it, two files each touched twice — together both times — show 100%
 * coupling on a sample size of two. This is the largest source of garbage in
 * naive implementations.
 */
export const MIN_COUPLING_SUPPORT = 5;

/** Report a coupling only above this co-change percentage. */
export const MIN_COUPLING_DEGREE = 30;

/** Contributors below this share are "minor" (Bird et al., FSE 2011). */
export const MINOR_CONTRIBUTOR_THRESHOLD = 0.05;

/** Half-life for recency-weighted ownership, in days. */
const OWNERSHIP_HALF_LIFE_DAYS = 270;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface FileChurn {
  path: string;
  /** Number of commits touching this file in the window. */
  revisions: number;
  linesAdded: number;
  linesDeleted: number;
  /** Commits whose subject looks like a fix. The strongest defect predictor. */
  bugFixes: number;
  firstChange: string;
  lastChange: string;
  /** Whole months since the last change. */
  ageMonths: number;
}

export interface ChangeCoupling {
  a: string;
  b: string;
  /** Symmetric co-change percentage, 0–100. */
  degree: number;
  /** Number of commits touching both. The trustworthiness of `degree`. */
  support: number;
  /** P(A∩B) / (P(A)·P(B)). Above 1 means more than chance. */
  lift: number;
  /** P(B changes | A changes), 0–1. Asymmetric and directly actionable. */
  pBGivenA: number;
  pAGivenB: number;
}

export interface Ownership {
  path: string;
  authors: Array<{ name: string; commits: number; lines: number; share: number; lastDate: string }>;
  mainDeveloper: string | null;
  /** Share held by the top contributor, 0–1. */
  topShare: number;
  /** Contributors holding less than 5% each — a defect predictor. */
  minorContributors: number;
  /** Normalized Shannon entropy, 0 (one owner) to 1 (perfectly diffused). */
  knowledgeDiffusion: number;
  /** Contributors needed to cover >50% of the contribution. */
  busFactor: number;
}

export interface Hotspot {
  path: string;
  /** percentile(complexity) x percentile(revisions), 0–1. */
  score: number;
  revisionsPercentile: number;
  complexityPercentile: number;
  revisions: number;
}

/** A past failure attached to a file — the repeat-mistake signal. */
export interface Trap {
  path: string;
  kind: 'reverted' | 'quick_fix';
  /** The commit that went wrong. */
  sha: string;
  date: string;
  subject: string;
  /** The commit that reverted or fixed it. */
  correctedBySha: string;
  correctedBySubject: string;
  /** Hours between the change and its correction. */
  hoursToCorrection: number;
}

// ─── Churn, age, bug fixes ───────────────────────────────────────────────────

export function computeChurn(history: RepoHistory, now = Date.now()): Map<string, FileChurn> {
  const out = new Map<string, FileChurn>();
  for (const commit of history.commits) {
    for (const file of commit.files) {
      let rec = out.get(file.path);
      if (!rec) {
        rec = {
          path: file.path,
          revisions: 0,
          linesAdded: 0,
          linesDeleted: 0,
          bugFixes: 0,
          firstChange: commit.date,
          lastChange: commit.date,
          ageMonths: 0,
        };
        out.set(file.path, rec);
      }
      rec.revisions += 1;
      rec.linesAdded += file.added;
      rec.linesDeleted += file.deleted;
      if (commit.isBugFix) rec.bugFixes += 1;
      // git log is newest-first, so the first date seen is the most recent.
      if (commit.date < rec.firstChange) rec.firstChange = commit.date;
      if (commit.date > rec.lastChange) rec.lastChange = commit.date;
    }
  }
  for (const rec of out.values()) {
    const last = Date.parse(rec.lastChange);
    rec.ageMonths = Number.isNaN(last)
      ? 0
      : Math.max(0, Math.floor((now - last) / (1000 * 60 * 60 * 24 * 30.44)));
  }
  return out;
}

// ─── Change coupling ─────────────────────────────────────────────────────────

/**
 * Files that change together, whether or not they reference each other.
 *
 * This is the metric static analysis structurally cannot produce. A pair with a
 * high degree and no dependency path between them is a hidden coupling: a
 * schema and its migration, a client and a server contract, two parallel class
 * hierarchies, an interface and its only implementation. Those are precisely
 * the edits an agent forgets to make.
 */
export function computeChangeCoupling(
  history: RepoHistory,
  opts: {
    maxChangesetSize?: number;
    minSupport?: number;
    minDegree?: number;
    limit?: number;
  } = {},
): ChangeCoupling[] {
  const maxChangeset = opts.maxChangesetSize ?? MAX_CHANGESET_SIZE;
  const minSupport = opts.minSupport ?? MIN_COUPLING_SUPPORT;
  const minDegree = opts.minDegree ?? MIN_COUPLING_DEGREE;

  const revisions = new Map<string, number>();
  const pairs = new Map<string, number>();
  let usableCommits = 0;

  for (const commit of history.commits) {
    const paths = Array.from(new Set(commit.files.map((f) => f.path))).sort();
    if (paths.length === 0 || paths.length > maxChangeset) continue;
    usableCommits += 1;
    for (const p of paths) revisions.set(p, (revisions.get(p) ?? 0) + 1);
    for (let i = 0; i < paths.length; i++) {
      for (let j = i + 1; j < paths.length; j++) {
        const key = `${paths[i]}\u0000${paths[j]}`;
        pairs.set(key, (pairs.get(key) ?? 0) + 1);
      }
    }
  }

  const results: ChangeCoupling[] = [];
  for (const [key, support] of pairs) {
    if (support < minSupport) continue;
    const sep = key.indexOf('\u0000');
    const a = key.slice(0, sep);
    const b = key.slice(sep + 1);
    const ra = revisions.get(a) ?? 0;
    const rb = revisions.get(b) ?? 0;
    if (ra === 0 || rb === 0) continue;

    const degree = (support / ((ra + rb) / 2)) * 100;
    if (degree < minDegree) continue;

    results.push({
      a,
      b,
      degree: Math.round(degree * 10) / 10,
      support,
      // Lift corrects for files that are simply touched constantly: two files
      // in every commit have a high degree but a lift near 1.
      lift:
        usableCommits > 0
          ? Math.round(((support * usableCommits) / (ra * rb)) * 100) / 100
          : 0,
      pBGivenA: Math.round((support / ra) * 100) / 100,
      pAGivenB: Math.round((support / rb) * 100) / 100,
    });
  }

  results.sort((x, y) => y.degree - x.degree || y.support - x.support);
  return opts.limit ? results.slice(0, opts.limit) : results;
}

// ─── Ownership and bus factor ────────────────────────────────────────────────

export function computeOwnership(
  history: RepoHistory,
  opts: { halfLifeDays?: number; now?: number } = {},
): Map<string, Ownership> {
  const halfLife = opts.halfLifeDays ?? OWNERSHIP_HALF_LIFE_DAYS;
  const now = opts.now ?? Date.now();
  const decay = Math.LN2 / halfLife;

  type Acc = { commits: number; lines: number; weighted: number; lastDate: string };
  const perFile = new Map<string, Map<string, Acc>>();

  for (const commit of history.commits) {
    const ts = Date.parse(commit.date);
    const ageDays = Number.isNaN(ts) ? 0 : Math.max(0, (now - ts) / 86_400_000);
    // Knowledge decays. Someone who last touched a file three years ago is not
    // really its owner any more, even if they wrote most of the lines.
    const weight = Math.exp(-decay * ageDays);
    const who = commit.author || commit.email || 'unknown';

    for (const file of commit.files) {
      let authors = perFile.get(file.path);
      if (!authors) {
        authors = new Map();
        perFile.set(file.path, authors);
      }
      let acc = authors.get(who);
      if (!acc) {
        acc = { commits: 0, lines: 0, weighted: 0, lastDate: commit.date };
        authors.set(who, acc);
      }
      const churn = file.added + file.deleted;
      acc.commits += 1;
      acc.lines += churn;
      acc.weighted += churn * weight || weight;
      if (commit.date > acc.lastDate) acc.lastDate = commit.date;
    }
  }

  const out = new Map<string, Ownership>();
  for (const [path, authorMap] of perFile) {
    const total = Array.from(authorMap.values()).reduce((s, a) => s + a.weighted, 0) || 1;
    const authors = Array.from(authorMap.entries())
      .map(([name, a]) => ({
        name,
        commits: a.commits,
        lines: a.lines,
        share: a.weighted / total,
        lastDate: a.lastDate,
      }))
      .sort((x, y) => y.share - x.share);

    const entropy = -authors.reduce(
      (sum, a) => (a.share > 0 ? sum + a.share * Math.log2(a.share) : sum),
      0,
    );
    const maxEntropy = authors.length > 1 ? Math.log2(authors.length) : 0;

    let cumulative = 0;
    let busFactor = 0;
    for (const a of authors) {
      cumulative += a.share;
      busFactor += 1;
      if (cumulative > 0.5) break;
    }

    out.set(path, {
      path,
      authors,
      mainDeveloper: authors[0]?.name ?? null,
      topShare: Math.round((authors[0]?.share ?? 0) * 100) / 100,
      minorContributors: authors.filter((a) => a.share < MINOR_CONTRIBUTOR_THRESHOLD).length,
      knowledgeDiffusion: maxEntropy > 0 ? Math.round((entropy / maxEntropy) * 100) / 100 : 0,
      busFactor: Math.max(1, busFactor),
    });
  }
  return out;
}

// ─── Hotspots ────────────────────────────────────────────────────────────────

/** Percentile rank of each value in [0,1]. Ties share the lower rank. */
function percentileRanks(values: Map<string, number>): Map<string, number> {
  const sorted = Array.from(values.values()).sort((a, b) => a - b);
  const out = new Map<string, number>();
  if (sorted.length === 0) return out;
  for (const [key, value] of values) {
    // Number of values strictly below, over the total.
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((sorted[mid] ?? 0) < value) lo = mid + 1;
      else hi = mid;
    }
    out.set(key, sorted.length > 1 ? lo / (sorted.length - 1) : 1);
  }
  return out;
}

/**
 * Complexity that you keep having to touch.
 *
 * Complexity on its own is not a problem — a hairy parser nobody edits costs
 * nothing. The intersection with change frequency is what predicts pain, which
 * is the core insight of Tornhill's behavioural code analysis.
 *
 * Both inputs are percentile-ranked rather than min-max normalised: both
 * distributions are heavy-tailed, and a single 20k-line generated file
 * otherwise flattens every other score to nearly zero.
 */
export function computeHotspots(
  churn: Map<string, FileChurn>,
  complexityByPath: Map<string, number>,
  opts: { limit?: number; minScore?: number } = {},
): Hotspot[] {
  const revisionValues = new Map<string, number>();
  const complexityValues = new Map<string, number>();
  for (const [path, rec] of churn) {
    const complexity = complexityByPath.get(path);
    if (complexity === undefined) continue;
    revisionValues.set(path, rec.revisions);
    complexityValues.set(path, complexity);
  }

  const revPct = percentileRanks(revisionValues);
  const cxPct = percentileRanks(complexityValues);

  const hotspots: Hotspot[] = [];
  for (const path of revisionValues.keys()) {
    const r = revPct.get(path) ?? 0;
    const c = cxPct.get(path) ?? 0;
    const score = r * c;
    if (score < (opts.minScore ?? 0.25)) continue;
    hotspots.push({
      path,
      score: Math.round(score * 100) / 100,
      revisionsPercentile: Math.round(r * 100) / 100,
      complexityPercentile: Math.round(c * 100) / 100,
      revisions: churn.get(path)?.revisions ?? 0,
    });
  }
  hotspots.sort((a, b) => b.score - a.score);
  return opts.limit ? hotspots.slice(0, opts.limit) : hotspots;
}

// ─── Repeat-mistake detection ────────────────────────────────────────────────

/**
 * Changes that had to be undone or urgently corrected.
 *
 * An agent about to edit a file benefits enormously from knowing that the last
 * three attempts were reverted within a day, and why. This is pure archaeology
 * — no model involved — and no other tool surfaces it.
 *
 * Two signals:
 *   `reverted`   an explicit `Revert "..."` commit, matched back to its target
 *                by subject. Unambiguous.
 *   `quick_fix`  a fix-shaped commit touching the same file within the window,
 *                shortly after a non-fix commit. Weaker, so the window is kept
 *                tight and the original commit must not itself be a fix (or
 *                every iterative session would register as a trap).
 */
export function detectTraps(
  history: RepoHistory,
  opts: { quickFixHours?: number; limitPerFile?: number; maxChangesetSize?: number } = {},
): Map<string, Trap[]> {
  const quickFixHours = opts.quickFixHours ?? 24;
  const limitPerFile = opts.limitPerFile ?? 5;
  // A sweeping "fix CI, docs and three bugs" commit touching 40 files is not
  // evidence that any one of those files is a trap. Same reasoning as change
  // coupling: broad commits carry almost no per-file signal.
  const maxChangeset = opts.maxChangesetSize ?? MAX_CHANGESET_SIZE;

  // Oldest first makes "what came after this" a forward scan.
  const commits = [...history.commits].reverse();
  const bySubject = new Map<string, HistoryCommit[]>();
  for (const c of commits) {
    const list = bySubject.get(c.subject) ?? [];
    list.push(c);
    bySubject.set(c.subject, list);
  }

  const traps = new Map<string, Trap[]>();
  const add = (trap: Trap) => {
    const list = traps.get(trap.path) ?? [];
    if (list.length < limitPerFile) {
      list.push(trap);
      traps.set(trap.path, list);
    }
  };

  const hoursBetween = (a: string, b: string) => {
    const ta = Date.parse(a);
    const tb = Date.parse(b);
    if (Number.isNaN(ta) || Number.isNaN(tb)) return Number.POSITIVE_INFINITY;
    return Math.abs(tb - ta) / 3_600_000;
  };

  for (let idx = 0; idx < commits.length; idx++) {
    const commit = commits[idx];
    if (!commit) continue;
    // 1. Explicit reverts — match the quoted subject back to the original.
    if (commit.isRevert && commit.revertsSubject) {
      const originals = bySubject.get(commit.revertsSubject) ?? [];
      const original = originals[originals.length - 1];
      if (original) {
        for (const f of original.files) {
          add({
            path: f.path,
            kind: 'reverted',
            sha: original.sha,
            date: original.date,
            subject: original.subject,
            correctedBySha: commit.sha,
            correctedBySubject: commit.subject,
            hoursToCorrection: hoursBetween(original.date, commit.date),
          });
        }
      }
      continue;
    }

    // 2. A fix landing on the same file shortly after a non-fix change.
    if (!commit.isBugFix) continue;
    if (commit.files.length > maxChangeset) continue;
    const touched = new Set(commit.files.map((f) => f.path));
    // Walk backwards from this commit. Bounded by the time window below, so
    // this stays linear overall rather than quadratic.
    for (let i = idx - 1; i >= 0; i--) {
      const prior = commits[i];
      if (!prior) break;
      const hours = hoursBetween(prior.date, commit.date);
      if (hours > quickFixHours) break;
      if (prior.isBugFix || prior.isRevert) continue;
      if (prior.files.length > maxChangeset) continue;
      for (const f of prior.files) {
        if (!touched.has(f.path)) continue;
        add({
          path: f.path,
          kind: 'quick_fix',
          sha: prior.sha,
          date: prior.date,
          subject: prior.subject,
          correctedBySha: commit.sha,
          correctedBySubject: commit.subject,
          hoursToCorrection: hours,
        });
      }
    }
  }

  return traps;
}
