import type { KnowledgeGraph, SprangEdge, SprangNode } from '../schema/types.js';
import { matchCoverageToGraph, type FileCoverage } from './coverage.js';
import { isTestPath } from './test-selection.js';

/**
 * The evidence matrix — three independent sources, and their disagreements.
 *
 * Three things can be known about a piece of code, and each is blind where the
 * others see:
 *
 * 1. **Static** — does anything reference it? (`imports` / `calls` edges in the
 *    knowledge graph). Blind to reflection, DI containers, string-keyed
 *    dispatch and anything the parser could not resolve.
 * 2. **Coverage** — was it *executed* by the suite? (`FileCoverage`). Blind to
 *    whether anything was asserted, and blind to files the report never
 *    mentioned.
 * 3. **History** — is it alive? (`metadata.behavioral.revisions`,
 *    `age_months`, `last_change`). Blind to code that is correct and finished.
 *
 * Any one of them alone produces confident nonsense. Agreement between them is
 * unremarkable. The **disagreements** are the findings: code that everything
 * calls and recently changed but nothing ran; code that nothing calls, nothing
 * ran and nobody has touched in a year; code the tests execute that no
 * production path reaches.
 *
 * ## Coverage measures EXECUTION, not assertion
 *
 * Every number that enters this module counts *lines a test process ran*. A
 * line run by a test that asserts nothing about it is executed and unverified.
 * For that reason every string this module emits says "executed" or "covered"
 * and **never** says "tested" — a claim this data cannot support. There is a
 * test in `tests/verify/evidence.test.ts` that greps the emitted reasons and
 * caveats for that word and fails the build if it appears.
 *
 * ## Missing evidence is not negative evidence
 *
 * The single most destructive thing this report could do is call a
 * well-covered file unexecuted because the coverage report simply did not
 * mention it. So {@link EvidenceVerdict} has an `unknown` member, it is used
 * liberally, and every verdict that depends on coverage requires coverage to
 * be *present for that specific file*. {@link EvidenceMatrix.completeness} and
 * {@link EvidenceMatrix.caveats} exist so a matrix built on thin evidence
 * looks thin to the reader.
 */

/**
 * What the three sources, taken together, support saying about one file.
 *
 * Ordered by how much a reader should care; that order is also the sort order
 * of {@link EvidenceMatrix.rows}.
 */
export type EvidenceVerdict =
  /**
   * The headline. Something references it, people are still changing it, and
   * the suite did not execute most of it. This is where a regression escapes.
   * Action: write a test for it before the next change lands.
   */
  | 'untested-but-live'
  /**
   * Nothing references it, the suite executed none of it, and nobody has
   * touched it in a long time. Action: try deleting it; the graph, the report
   * and the history all agree nothing would notice. Verify dynamic entry
   * points first — static analysis cannot see reflection.
   */
  | 'dead-and-untested'
  /**
   * The suite executes it but no non-test file references it. Usually test
   * scaffolding that drifted into `src/`, or production code whose only
   * remaining caller is a test. Action: move it to the test tree or delete it.
   */
  | 'covered-but-unreferenced'
  /**
   * Referenced and substantially executed. Not a finding — listed so the
   * denominator is visible and the matrix cannot be read as "everything is on
   * fire". Note that "covered" still means executed, not asserted.
   */
  | 'well-covered'
  /**
   * Not enough evidence. Most commonly there is no coverage entry for this
   * file, which means it cannot be called unexecuted — only unknown. Action:
   * fix the missing evidence source named in `reason`, then re-run.
   */
  | 'unknown';

/** Verdict priority, worst-first. Also the row sort order. */
const VERDICT_ORDER: readonly EvidenceVerdict[] = [
  'untested-but-live',
  'dead-and-untested',
  'covered-but-unreferenced',
  'well-covered',
  'unknown',
];

/** One file, with the raw evidence that produced its verdict. */
export interface EvidenceRow {
  /** Repo-relative, forward-slashed path of the file. */
  path: string;
  verdict: EvidenceVerdict;
  /**
   * Number of *other* files that import or call into this one. Distinct files,
   * not distinct edges: ten calls from one caller are one reference.
   */
  staticRefs: number;
  /**
   * Weakest confidence among incoming edges, when recorded. Absent means no
   * incoming edge carried a confidence — which is not the same as low.
   */
  refConfidence?: number;
  /** Percent of instrumented lines executed. Absent means no coverage entry. */
  coveredPercent?: number;
  /** Commits touching this file in the history window. Absent means no data. */
  revisions?: number;
  /** Whole months since the last change. Absent means no data. */
  ageMonths?: number;
  /** One sentence a human can act on. Never uses the word t-e-s-t-e-d. */
  reason: string;
}

/** The whole report, including how much of it should be believed. */
export interface EvidenceMatrix {
  /** Sorted by verdict priority, then path. Deterministic. */
  rows: EvidenceRow[];
  /** Every verdict is present as a key, zero-filled. */
  counts: Record<EvidenceVerdict, number>;
  /**
   * Fraction (0–1, two decimals) of rows for which static, coverage *and*
   * history were all available. A matrix at 0.2 is a rumour, not a report.
   */
  completeness: number;
  /** Plain-language statements of what was missing. Read these first. */
  caveats: string[];
}

export interface BuildEvidenceOptions {
  /**
   * A file untouched for longer than this is dormant. Default 6 months.
   * Also the recency bar for `untested-but-live`.
   */
  staleMonths?: number;
  /**
   * Percent of executed lines below which a file counts as unexecuted, and at
   * or above which it counts as covered. Default 50.
   */
  minCoveredPercent?: number;
}

const DEFAULT_STALE_MONTHS = 6;
const DEFAULT_MIN_COVERED_PERCENT = 50;

/** Revisions required inside the window before a file counts as "live". */
const LIVE_REVISIONS = 2;

/** Below this, a `calls` edge is a guess and reference counts are inflated. */
const LOW_CONFIDENCE = 0.5;

/** Completeness under this makes the whole matrix advisory. */
const THIN_COMPLETENESS = 0.5;

/** Edge types meaning "the source depends on the target". */
const DEPENDENCY_EDGES: ReadonlySet<string> = new Set(['imports', 'calls']);

function normalisePath(path: string): string {
  const forward = path.replace(/\\/g, '/');
  return forward.startsWith('./') ? forward.slice(2) : forward;
}

/**
 * The file a node lives in, or null when the node has no location at all.
 *
 * Nodes with no resolvable path are skipped everywhere: a row keyed on `null`
 * would be a finding about nothing.
 */
function nodeFile(node: SprangNode): string | null {
  const raw = node.filePath ?? node.location?.file;
  if (raw !== undefined && raw !== '') return normalisePath(raw);
  if (node.id.startsWith('file:')) return normalisePath(node.id.slice(5));
  if (node.id.startsWith('function:')) {
    const rest = node.id.slice('function:'.length);
    const lastColon = rest.lastIndexOf(':');
    if (lastColon > 0) return normalisePath(rest.slice(0, lastColon));
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** History facts for one file, as far as they are recorded. */
interface History {
  revisions?: number;
  ageMonths?: number;
  lastChange?: string;
}

/**
 * Read `metadata.behavioral`. Returns null when the sub-object is absent or
 * carries neither of the two numbers this module reasons about — a behavioural
 * blob with only `main_developer` in it tells us nothing about liveness.
 */
function historyOf(node: SprangNode): History | null {
  const behavioral = node.metadata?.['behavioral'];
  if (!isRecord(behavioral)) return null;
  const revisions = finiteNumber(behavioral['revisions']);
  const ageMonths = finiteNumber(behavioral['age_months']);
  const rawLast = behavioral['last_change'];
  const lastChange = typeof rawLast === 'string' && rawLast !== '' ? rawLast : undefined;
  if (revisions === undefined && ageMonths === undefined) return null;
  const out: History = {};
  if (revisions !== undefined) out.revisions = revisions;
  if (ageMonths !== undefined) out.ageMonths = ageMonths;
  if (lastChange !== undefined) out.lastChange = lastChange;
  return out;
}

/** Static evidence accumulated for one file. */
interface StaticFacts {
  /** Distinct other files referencing this one. */
  refs: number;
  /** Weakest recorded confidence among incoming edges. */
  weakestConfidence?: number;
  /** Incoming edges that are guesses: low confidence or ambiguous resolution. */
  lowConfidenceEdges: number;
}

function edgeIsLowConfidence(edge: SprangEdge): boolean {
  if (edge.resolution === 'imported-ambiguous') return true;
  const confidence = edge.confidence;
  return confidence !== undefined && confidence < LOW_CONFIDENCE;
}

/**
 * Build the evidence matrix.
 *
 * `coverage` is optional on purpose: the common case in a fresh repository is
 * that no report exists, and the honest output then is a matrix of `unknown`
 * with a caveat saying why — not a list of files declared unexecuted.
 */
export function buildEvidenceMatrix(
  graph: KnowledgeGraph,
  coverage?: FileCoverage[],
  opts: BuildEvidenceOptions = {},
): EvidenceMatrix {
  const staleMonths = opts.staleMonths ?? DEFAULT_STALE_MONTHS;
  const minCoveredPercent = opts.minCoveredPercent ?? DEFAULT_MIN_COVERED_PERCENT;

  // ── Index nodes by file ────────────────────────────────────────────────
  const fileOfNode = new Map<string, string>();
  const nodesByFile = new Map<string, SprangNode[]>();
  let nodesWithoutLocation = 0;

  for (const node of graph.nodes) {
    const file = nodeFile(node);
    if (file === null) {
      nodesWithoutLocation++;
      continue;
    }
    fileOfNode.set(node.id, file);
    const bucket = nodesByFile.get(file);
    if (bucket === undefined) nodesByFile.set(file, [node]);
    else bucket.push(node);
  }

  // ── Static evidence ────────────────────────────────────────────────────
  const referrers = new Map<string, Set<string>>();
  const staticFacts = new Map<string, StaticFacts>();
  let dependencyEdges = 0;
  let lowConfidenceEdges = 0;

  const factsFor = (file: string): StaticFacts => {
    let facts = staticFacts.get(file);
    if (facts === undefined) {
      facts = { refs: 0, lowConfidenceEdges: 0 };
      staticFacts.set(file, facts);
    }
    return facts;
  };

  for (const edge of graph.edges) {
    if (!DEPENDENCY_EDGES.has(edge.type)) continue;
    dependencyEdges++;
    const targetFile = fileOfNode.get(edge.target);
    const sourceFile = fileOfNode.get(edge.source);
    if (targetFile === undefined || sourceFile === undefined) continue;
    if (targetFile === sourceFile) continue;

    const set = referrers.get(targetFile);
    if (set === undefined) referrers.set(targetFile, new Set([sourceFile]));
    else set.add(sourceFile);

    const facts = factsFor(targetFile);
    const confidence = edge.confidence;
    if (confidence !== undefined) {
      facts.weakestConfidence =
        facts.weakestConfidence === undefined
          ? confidence
          : Math.min(facts.weakestConfidence, confidence);
    }
    if (edgeIsLowConfidence(edge)) {
      facts.lowConfidenceEdges++;
      lowConfidenceEdges++;
    }
  }

  /**
   * With no dependency edges anywhere, a reference count of zero means "the
   * graph was never given call data", not "nothing calls it". Static evidence
   * is therefore unavailable for every file rather than uniformly damning.
   */
  const staticAvailable = dependencyEdges > 0;

  // ── Coverage evidence ──────────────────────────────────────────────────
  const coverageProvided = coverage !== undefined && coverage.length > 0;
  const match = coverageProvided
    ? matchCoverageToGraph(graph, coverage)
    : { matched: 0, unmatched: [] as string[], byPath: new Map<string, FileCoverage>(), unmatchedRatio: 0, unreliable: false };

  // ── Rows ───────────────────────────────────────────────────────────────
  const rows: EvidenceRow[] = [];
  let allThree = 0;
  let historyMissing = 0;
  let coverageMissing = 0;
  let rowsWithLowConfidence = 0;

  for (const file of [...nodesByFile.keys()].sort((a, b) => a.localeCompare(b))) {
    // A test file that nothing executes is not a finding about the product.
    if (isTestPath(file)) continue;

    const facts = staticFacts.get(file);
    const staticRefs = referrers.get(file)?.size ?? 0;
    const weakest = facts?.weakestConfidence;
    if ((facts?.lowConfidenceEdges ?? 0) > 0) rowsWithLowConfidence++;

    const entry = match.byPath.get(file);
    const coveredPercent = entry?.percent;
    if (coveredPercent === undefined) coverageMissing++;

    const nodes = nodesByFile.get(file) ?? [];
    let history: History | null = null;
    for (const node of nodes) {
      const candidate = historyOf(node);
      if (candidate === null) continue;
      history = candidate;
      if (node.type === 'file') break;
    }
    if (history === null) historyMissing++;

    const historyAvailable = history !== null;
    if (staticAvailable && coveredPercent !== undefined && historyAvailable) allThree++;

    const revisions = history?.revisions;
    const ageMonths = history?.ageMonths;

    const decided = decide({
      file,
      staticAvailable,
      staticRefs,
      coveredPercent,
      revisions,
      ageMonths,
      lastChange: history?.lastChange,
      staleMonths,
      minCoveredPercent,
      uncoveredLines: entry?.uncoveredLines.length,
    });

    const row: EvidenceRow = {
      path: file,
      verdict: decided.verdict,
      staticRefs,
      reason: decided.reason,
    };
    if (weakest !== undefined) row.refConfidence = weakest;
    if (coveredPercent !== undefined) row.coveredPercent = coveredPercent;
    if (revisions !== undefined) row.revisions = revisions;
    if (ageMonths !== undefined) row.ageMonths = ageMonths;
    rows.push(row);
  }

  rows.sort(
    (a, b) =>
      VERDICT_ORDER.indexOf(a.verdict) - VERDICT_ORDER.indexOf(b.verdict) ||
      a.path.localeCompare(b.path),
  );

  const counts: Record<EvidenceVerdict, number> = {
    'untested-but-live': 0,
    'dead-and-untested': 0,
    'covered-but-unreferenced': 0,
    'well-covered': 0,
    unknown: 0,
  };
  for (const row of rows) counts[row.verdict]++;

  const completeness = rows.length === 0 ? 0 : round2(allThree / rows.length);

  const caveats = buildCaveats({
    rows: rows.length,
    completeness,
    coverageProvided,
    unreliableCoverage: match.unreliable,
    unmatchedRatio: match.unmatchedRatio,
    coverageMissing,
    historyMissing,
    staticAvailable,
    lowConfidenceEdges,
    rowsWithLowConfidence,
    nodesWithoutLocation,
    unmatchedEntries: match.unmatched.length,
  });

  return { rows, counts, completeness, caveats };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

interface DecideInput {
  file: string;
  staticAvailable: boolean;
  staticRefs: number;
  coveredPercent: number | undefined;
  revisions: number | undefined;
  ageMonths: number | undefined;
  lastChange: string | undefined;
  staleMonths: number;
  minCoveredPercent: number;
  uncoveredLines: number | undefined;
}

/**
 * Assign a verdict, or refuse to.
 *
 * Written as a sequence of *all-or-unknown* gates rather than a score: a score
 * would let two weak signals outvote one missing source, which is exactly the
 * mislabelling this module exists to prevent.
 */
function decide(input: DecideInput): { verdict: EvidenceVerdict; reason: string } {
  const {
    staticAvailable,
    staticRefs,
    coveredPercent,
    revisions,
    ageMonths,
    lastChange,
    staleMonths,
    minCoveredPercent,
    uncoveredLines,
  } = input;

  // Gate 0: no coverage entry means nothing about execution can be claimed.
  if (coveredPercent === undefined) {
    return {
      verdict: 'unknown',
      reason: staticAvailable
        ? `No coverage entry exists for this file, so whether the suite executed it is unknown; ` +
          `static analysis found ${refPhrase(staticRefs)}. Produce a coverage report to get a verdict.`
        : `No coverage entry exists for this file and the graph carries no import or call edges, ` +
          `so neither execution nor references are known. Re-scan with call resolution, and produce a coverage report.`,
    };
  }

  if (!staticAvailable) {
    return {
      verdict: 'unknown',
      reason:
        `The graph carries no import or call edges, so a reference count of zero would mean "not analysed", ` +
        `not "not referenced"; ${coveredPercent}% of instrumented lines were executed. Re-scan to resolve references.`,
    };
  }

  const executedEnough = coveredPercent >= minCoveredPercent;
  const referenced = staticRefs >= 1;

  // ── The headline: referenced, still moving, and largely not executed ──
  if (referenced && !executedEnough) {
    if (revisions === undefined || ageMonths === undefined) {
      return {
        verdict: 'unknown',
        reason:
          `${cap(refPhrase(staticRefs))} reference this file and only ${coveredPercent}% of its instrumented ` +
          `lines were executed, but no git history is recorded for it, so whether it is still live is unknown.`,
      };
    }
    if (revisions >= LIVE_REVISIONS && ageMonths <= staleMonths) {
      return {
        verdict: 'untested-but-live',
        reason:
          `${cap(refPhrase(staticRefs))} reference this file and it changed ${revisions} times, most recently ` +
          `${ageMonths} month${ageMonths === 1 ? '' : 's'} ago${lastChange === undefined ? '' : ` (${lastChange})`}, ` +
          `yet the suite executed only ${coveredPercent}% of its instrumented lines` +
          `${uncoveredLines === undefined || uncoveredLines === 0 ? '' : ` (${uncoveredLines} lines never ran)`}. ` +
          `Add coverage here before the next change lands.`,
      };
    }
    return {
      verdict: 'unknown',
      reason:
        `${cap(refPhrase(staticRefs))} reference this file and only ${coveredPercent}% of its instrumented lines ` +
        `were executed, but ${revisions < LIVE_REVISIONS ? `it changed only ${revisions} time${revisions === 1 ? '' : 's'}` : `its last change was ${ageMonths} months ago`}, ` +
        `so it is not clearly live enough to prioritise. Confirm by hand whether it is still in use.`,
    };
  }

  // ── Nothing references it ─────────────────────────────────────────────
  if (!referenced) {
    if (coveredPercent === 0) {
      if (ageMonths === undefined) {
        return {
          verdict: 'unknown',
          reason:
            `Nothing in the graph references this file and the suite executed none of it, but no git history is ` +
            `recorded, so whether it is abandoned or simply new is unknown.`,
        };
      }
      if (ageMonths > staleMonths) {
        return {
          verdict: 'dead-and-untested',
          reason:
            `Nothing references this file, the suite executed none of its instrumented lines, and it has not ` +
            `changed in ${ageMonths} months${lastChange === undefined ? '' : ` (last change ${lastChange})`}. ` +
            `All three sources agree it is dormant — try deleting it, after checking for dynamic entry points ` +
            `that static analysis cannot see.`,
        };
      }
      return {
        verdict: 'unknown',
        reason:
          `Nothing references this file and the suite executed none of it, but it changed ${ageMonths} month` +
          `${ageMonths === 1 ? '' : 's'} ago, so it is more likely new than dead. Check back once it settles.`,
      };
    }
    if (executedEnough) {
      return {
        verdict: 'covered-but-unreferenced',
        reason:
          `The suite executed ${coveredPercent}% of this file's instrumented lines, yet no other file imports or ` +
          `calls into it. It is reachable only from the test tree — move it there or delete it.`,
      };
    }
    return {
      verdict: 'unknown',
      reason:
        `Nothing references this file and the suite executed ${coveredPercent}% of its instrumented lines — ` +
        `partial execution with no callers is ambiguous. Inspect it by hand.`,
    };
  }

  // ── Referenced and substantially executed ─────────────────────────────
  return {
    verdict: 'well-covered',
    reason:
      `${cap(refPhrase(staticRefs))} reference this file and the suite executed ${coveredPercent}% of its ` +
      `instrumented lines. Execution is not assertion, so this is a floor on verification, not a guarantee.`,
  };
}

function refPhrase(refs: number): string {
  if (refs === 0) return 'no other file';
  return `${refs} other file${refs === 1 ? '' : 's'}`;
}

function cap(s: string): string {
  return s.length === 0 ? s : `${s.charAt(0).toUpperCase()}${s.slice(1)}`;
}

interface CaveatInput {
  rows: number;
  completeness: number;
  coverageProvided: boolean;
  unreliableCoverage: boolean;
  unmatchedRatio: number;
  coverageMissing: number;
  historyMissing: number;
  staticAvailable: boolean;
  lowConfidenceEdges: number;
  rowsWithLowConfidence: number;
  nodesWithoutLocation: number;
  unmatchedEntries: number;
}

/**
 * Say plainly what was missing.
 *
 * These are printed above the table, not in a footnote, because a reader who
 * skips them will read absence of evidence as evidence of absence — the exact
 * error this whole module is built to avoid.
 */
function buildCaveats(input: CaveatInput): string[] {
  const caveats: string[] = [];

  if (input.rows === 0) {
    caveats.push(
      'No non-test file in the graph had a resolvable location, so the matrix is empty and supports no claims.',
    );
  }

  if (!input.coverageProvided) {
    caveats.push(
      'No coverage data was supplied at all. Nothing here can say a file was never executed — only that it is ' +
        'unknown. Every coverage-dependent verdict is therefore "unknown".',
    );
  } else if (input.unreliableCoverage) {
    caveats.push(
      `Coverage matched fewer than 90% of its paths to files in the graph ` +
        `(${Math.round(input.unmatchedRatio * 100)}% unmatched, ${input.unmatchedEntries} entries). Files missing from ` +
        `the match look unexecuted when in truth they were never compared, so low-coverage verdicts here are suspect.`,
    );
  }

  if (input.coverageProvided && input.rows > 0 && input.coverageMissing > 0) {
    caveats.push(
      `${input.coverageMissing} of ${input.rows} files have no coverage entry. They are reported as "unknown", ` +
        `not as unexecuted.`,
    );
  }

  if (input.rows > 0 && input.historyMissing === input.rows) {
    caveats.push(
      'No behavioural (git history) data is present on any file node, so no file can be judged live or dormant. ' +
        'Run the behavioural analyser to enable those verdicts.',
    );
  } else if (input.historyMissing > 0) {
    caveats.push(
      `${input.historyMissing} of ${input.rows} files carry no behavioural (git history) data, so their liveness ` +
        `is unknown.`,
    );
  }

  if (!input.staticAvailable) {
    caveats.push(
      'The graph contains no import or call edges, so a reference count of zero means "not analysed" rather than ' +
        '"not referenced". No verdict here rests on static evidence.',
    );
  } else if (input.lowConfidenceEdges > 0) {
    caveats.push(
      `${input.lowConfidenceEdges} incoming call edges across ${input.rowsWithLowConfidence} files carry low ` +
        `confidence or ambiguous resolution, so those reference counts may be overstated. See each row's ` +
        `refConfidence.`,
    );
  }

  if (input.nodesWithoutLocation > 0) {
    caveats.push(
      `${input.nodesWithoutLocation} graph nodes have no file location and were skipped entirely.`,
    );
  }

  if (input.rows > 0 && input.completeness < THIN_COMPLETENESS) {
    caveats.push(
      `Only ${Math.round(input.completeness * 100)}% of files had all three evidence sources available. Treat this ` +
        `matrix as a list of questions, not a list of conclusions.`,
    );
  }

  return caveats;
}
