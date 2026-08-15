import type { KnowledgeGraph, SprangNode } from '../schema/types.js';

/**
 * Coverage report parsing.
 *
 * Sprang reads coverage so an agent can answer "did anything actually execute
 * the line I changed?" without shelling out to a coverage tool it may not know
 * how to drive.
 *
 * ## Coverage measures EXECUTION, not assertion
 *
 * Every number produced here counts *lines a test process ran*. A line that ran
 * inside a test which asserts nothing about it is covered and untested. The
 * inverse is also true at the branch level: 100% line coverage says nothing
 * about the inputs that were tried. Any UI, report or agent message built on
 * this data must say "executed" / "covered" and must never say "tested".
 *
 * Uncovered lines are the only strong signal in here: a line with zero hits was
 * definitively not run, so it is definitively not verified.
 */

/** Per-file execution counts extracted from a coverage report. */
export interface FileCoverage {
  /** Path exactly as it appeared in the report (may be absolute CI path). */
  path: string;
  /** Number of instrumented lines executed at least once. */
  linesCovered: number;
  /** Number of instrumented lines. Not the file's line count. */
  linesTotal: number;
  /** `linesCovered / linesTotal * 100`, rounded to two decimals. 0 when empty. */
  percent: number;
  /** Instrumented lines with zero hits, ascending. Definitely not verified. */
  uncoveredLines: number[];
}

export type CoverageFormat = 'lcov' | 'cobertura' | 'unknown';

/**
 * Fraction of report files that may fail to match the graph before the caller
 * should treat the coverage data as unusable.
 */
export const MAX_UNMATCHED_RATIO = 0.1;

/**
 * Sniff the report format from its content.
 *
 * Filename extensions lie constantly in CI (`coverage.xml` holding lcov,
 * `lcov.info` holding cobertura from a misconfigured reporter), so only the
 * bytes are trusted. Returns `'unknown'` rather than guessing.
 */
export function detectCoverageFormat(content: string): CoverageFormat {
  if (content.length === 0) return 'unknown';
  const head = content.slice(0, 4096);
  if (/<coverage[\s>]/.test(head) || /<!DOCTYPE\s+coverage/i.test(head)) return 'cobertura';
  if (/^\s*(TN:|SF:)/m.test(head) || /^end_of_record\s*$/m.test(content)) return 'lcov';
  return 'unknown';
}

/** Accumulator used while streaming an lcov file. */
interface Accumulator {
  path: string;
  /** line number -> total hits across every TN section seen for this file. */
  hits: Map<number, number>;
  /** LF: totals, summed only as a fallback when no DA: records exist. */
  declaredTotal: number;
  declaredHit: number;
  sawDa: boolean;
}

function finish(acc: Accumulator): FileCoverage {
  if (!acc.sawDa) {
    // Some reporters emit only LF:/LH: summaries. Trust them, but there are no
    // per-line facts to report.
    const total = acc.declaredTotal;
    const covered = Math.min(acc.declaredHit, total);
    return {
      path: acc.path,
      linesCovered: covered,
      linesTotal: total,
      percent: total === 0 ? 0 : round2((covered / total) * 100),
      uncoveredLines: [],
    };
  }
  const uncovered: number[] = [];
  let covered = 0;
  for (const [line, count] of acc.hits) {
    if (count > 0) covered++;
    else uncovered.push(line);
  }
  uncovered.sort((a, b) => a - b);
  const total = acc.hits.size;
  return {
    path: acc.path,
    linesCovered: covered,
    linesTotal: total,
    percent: total === 0 ? 0 : round2((covered / total) * 100),
    uncoveredLines: uncovered,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Parse an lcov `.info` file.
 *
 * Two details break naive parsers, and both are handled here:
 *
 * 1. **`TN:` sections repeat per test name.** A file exercised by three test
 *    suites appears three times, each `SF:` block holding only that suite's
 *    hits. Overwriting on the second `SF:` throws away real coverage and
 *    reports lines as uncovered that several tests ran. Hits are therefore
 *    **accumulated** per `(file, line)` across every record.
 * 2. **`DA:` has an optional third field**, an MD5 of the line's source
 *    (`DA:12,3,aBcD==`). Splitting on `,` and parsing field 1 as the count is
 *    correct; parsing the whole remainder is not.
 *
 * Unparseable lines are skipped rather than thrown on: a truncated report from
 * a killed CI job should still yield the files it did finish.
 */
export function parseLcov(content: string): FileCoverage[] {
  const byPath = new Map<string, Accumulator>();
  let current: Accumulator | null = null;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '') continue;

    if (line.startsWith('SF:')) {
      const path = line.slice(3).trim();
      if (path === '') {
        current = null;
        continue;
      }
      const existing = byPath.get(path);
      if (existing !== undefined) {
        current = existing;
      } else {
        current = { path, hits: new Map(), declaredTotal: 0, declaredHit: 0, sawDa: false };
        byPath.set(path, current);
      }
      continue;
    }

    if (line === 'end_of_record') {
      current = null;
      continue;
    }

    if (current === null) continue;

    if (line.startsWith('DA:')) {
      const parts = line.slice(3).split(',');
      const lineNo = Number(parts[0]);
      const rawCount = parts[1];
      if (!Number.isInteger(lineNo) || lineNo <= 0 || rawCount === undefined) continue;
      // `-` appears for lines the instrumenter could not count.
      const count = rawCount === '-' ? 0 : Number(rawCount);
      if (!Number.isFinite(count)) continue;
      current.sawDa = true;
      current.hits.set(lineNo, (current.hits.get(lineNo) ?? 0) + Math.max(0, count));
      continue;
    }

    if (line.startsWith('LF:')) {
      const n = Number(line.slice(3));
      if (Number.isFinite(n)) current.declaredTotal = Math.max(current.declaredTotal, n);
      continue;
    }

    if (line.startsWith('LH:')) {
      const n = Number(line.slice(3));
      if (Number.isFinite(n)) current.declaredHit = Math.max(current.declaredHit, n);
      continue;
    }
  }

  return [...byPath.values()].map(finish).sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Parse a Cobertura XML report.
 *
 * ## Limitation: this is a scanner, not an XML parser
 *
 * Sprang deliberately ships no XML dependency, so this walks `<class ...>` and
 * `<line .../>` tags with regular expressions. That is sufficient for the shape
 * every real Cobertura writer emits (coverage.py, JaCoCo's cobertura reporter,
 * istanbul, gocover-cobertura) but it is **not** general XML:
 *
 * - attribute values containing `>` or escaped quotes are not handled;
 * - `<line>` elements inside comments or CDATA would be counted;
 * - namespaces prefixes on the tags are not recognised.
 *
 * If a report ever fails to parse, the fix is an XML library, not a bigger
 * regex. Malformed input yields `[]` — never a throw and never a partial file
 * silently reported as fully covered.
 */
export function parseCobertura(content: string): FileCoverage[] {
  const byPath = new Map<string, Map<number, number>>();

  const classRe = /<class\b[^>]*\bfilename\s*=\s*"([^"]*)"[^>]*>([\s\S]*?)<\/class>/g;
  const selfClosingRe = /<class\b[^>]*\bfilename\s*=\s*"([^"]*)"[^>]*\/>/g;
  const lineRe = /<line\b[^>]*\bnumber\s*=\s*"(\d+)"[^>]*\bhits\s*=\s*"(\d+)"[^>]*\/?>/g;

  const record = (path: string, body: string): void => {
    if (path === '') return;
    let hits = byPath.get(path);
    if (hits === undefined) {
      hits = new Map<number, number>();
      byPath.set(path, hits);
    }
    lineRe.lastIndex = 0;
    let lineMatch: RegExpExecArray | null;
    while ((lineMatch = lineRe.exec(body)) !== null) {
      const numberRaw = lineMatch[1];
      const hitsRaw = lineMatch[2];
      if (numberRaw === undefined || hitsRaw === undefined) continue;
      const number = Number(numberRaw);
      const count = Number(hitsRaw);
      if (!Number.isInteger(number) || number <= 0 || !Number.isFinite(count)) continue;
      // Same accumulation rule as lcov: a class may appear in several packages.
      hits.set(number, (hits.get(number) ?? 0) + count);
    }
  };

  let match: RegExpExecArray | null;
  while ((match = classRe.exec(content)) !== null) {
    record(match[1] ?? '', match[2] ?? '');
  }
  while ((match = selfClosingRe.exec(content)) !== null) {
    const path = match[1] ?? '';
    if (path !== '' && !byPath.has(path)) byPath.set(path, new Map());
  }

  const out: FileCoverage[] = [];
  for (const [path, hits] of byPath) {
    const uncoveredLines: number[] = [];
    let covered = 0;
    for (const [line, count] of hits) {
      if (count > 0) covered++;
      else uncoveredLines.push(line);
    }
    uncoveredLines.sort((a, b) => a - b);
    const total = hits.size;
    out.push({
      path,
      linesCovered: covered,
      linesTotal: total,
      percent: total === 0 ? 0 : round2((covered / total) * 100),
      uncoveredLines,
    });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Detect the format and parse in one call.
 *
 * Returns `{ format: 'unknown', files: [] }` for anything unrecognised — an
 * empty result the caller can check, rather than an exception it must catch
 * three layers up.
 */
export function parseCoverage(content: string): { format: CoverageFormat; files: FileCoverage[] } {
  const format = detectCoverageFormat(content);
  try {
    if (format === 'lcov') return { format, files: parseLcov(content) };
    if (format === 'cobertura') return { format, files: parseCobertura(content) };
  } catch {
    // Parsers above are written not to throw; this is belt-and-braces so a
    // malformed report can never take down an agent mid-task.
    return { format, files: [] };
  }
  return { format: 'unknown', files: [] };
}

/** Result of reconciling a coverage report with the knowledge graph. */
export interface CoverageMatchResult {
  /** How many report entries matched a graph file. */
  matched: number;
  /** Report paths with no graph file — inspect when this list is non-empty. */
  unmatched: string[];
  /** Graph-relative path -> the coverage entry that matched it. */
  byPath: Map<string, FileCoverage>;
  /** `unmatched.length / total`, 0 when the report was empty. */
  unmatchedRatio: number;
  /**
   * True when more than {@link MAX_UNMATCHED_RATIO} of entries failed to match.
   * When set, do not present the coverage numbers as complete: files missing
   * from the match set look uncovered when in truth they were never compared.
   */
  unreliable: boolean;
}

function normalise(path: string): string {
  const forward = path.replace(/\\/g, '/');
  return forward.startsWith('./') ? forward.slice(2) : forward;
}

function graphFiles(graph: KnowledgeGraph): string[] {
  const files = new Set<string>();
  for (const node of graph.nodes) {
    const file = fileOfNode(node);
    if (file !== null) files.add(file);
  }
  return [...files];
}

function fileOfNode(node: SprangNode): string | null {
  const raw = node.filePath ?? node.location?.file;
  if (raw !== undefined && raw !== '') return normalise(raw);
  if (node.id.startsWith('file:')) return normalise(node.id.slice(5));
  return null;
}

/** Number of trailing path segments shared by two paths. */
function commonSuffixSegments(a: string[], b: string[]): number {
  let i = 0;
  while (i < a.length && i < b.length && a[a.length - 1 - i] === b[b.length - 1 - i]) i++;
  return i;
}

/**
 * Reconcile report paths with graph paths.
 *
 * Coverage tools record whatever absolute path the runner saw
 * (`/home/runner/work/repo/repo/src/x.ts`, or `/app/src/x.ts` inside a
 * container) while the graph stores repo-relative paths (`src/x.ts`). Matching
 * on equality therefore fails for essentially every CI report, so matching is
 * by **longest common path suffix**, with at least one full segment required so
 * that `a/x.ts` and `b/x.ts` are not conflated when a better candidate exists.
 *
 * `unmatched` and `unreliable` exist because the failure mode is silent and
 * severe: if half the report does not match, the other half looks like the
 * whole truth and every unmatched file is reported as never executed. That
 * produces confidently wrong claims, which are worse than no claim.
 */
export function matchCoverageToGraph(
  graph: KnowledgeGraph,
  coverage: FileCoverage[],
): CoverageMatchResult {
  const candidates = graphFiles(graph).map((file) => ({ file, segments: file.split('/') }));
  const byPath = new Map<string, FileCoverage>();
  const unmatched: string[] = [];

  for (const entry of coverage) {
    const segments = normalise(entry.path).split('/');
    let best: { file: string; score: number } | null = null;
    for (const candidate of candidates) {
      const score = commonSuffixSegments(segments, candidate.segments);
      if (score === 0) continue;
      // Require the whole graph path to be a suffix of the report path, or the
      // whole report path to be a suffix of the graph path. Anything less is a
      // coincidental basename collision.
      if (score < Math.min(segments.length, candidate.segments.length)) continue;
      if (best === null || score > best.score || (score === best.score && candidate.file < best.file)) {
        best = { file: candidate.file, score };
      }
    }
    if (best === null) {
      unmatched.push(entry.path);
      continue;
    }
    const existing = byPath.get(best.file);
    // Two report entries mapping to one graph file: keep the richer one.
    if (existing === undefined || existing.linesTotal < entry.linesTotal) {
      byPath.set(best.file, entry);
    }
  }

  const total = coverage.length;
  const unmatchedRatio = total === 0 ? 0 : unmatched.length / total;
  return {
    matched: total - unmatched.length,
    unmatched,
    byPath,
    unmatchedRatio: round2(unmatchedRatio * 100) / 100,
    unreliable: unmatchedRatio > MAX_UNMATCHED_RATIO,
  };
}
