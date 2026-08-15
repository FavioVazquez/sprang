import { resolve, join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { Command } from 'commander';
import {
  loadGraphResult,
  buildEvidenceMatrix,
  parseCoverage,
  detectCoverageFormat,
  type EvidenceMatrix,
  type EvidenceRow,
  type EvidenceVerdict,
  type FileCoverage,
} from '@sprang/core';
import { reportGraphFailure } from '../graph-error.js';

const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

/** Worst first — the same order the matrix sorts its rows in. */
const VERDICTS: readonly EvidenceVerdict[] = [
  'untested-but-live',
  'dead-and-untested',
  'covered-but-unreferenced',
  'well-covered',
  'unknown',
];

/**
 * Where a coverage report usually is, in the order worth looking.
 *
 * Guessing is only acceptable because the guess is announced: the command
 * always prints which file it read, so a stale report in `coverage/` can never
 * be mistaken for a fresh one.
 */
const DEFAULT_COVERAGE_PATHS: readonly string[] = [
  'coverage/lcov.info',
  'lcov.info',
  'coverage/cobertura-coverage.xml',
  'coverage.xml',
];

/** How to produce a report, quoted verbatim wherever one is missing. */
const HOW_TO_GENERATE = 'pnpm vitest run --coverage';

/**
 * Cross-examine three independent sources of evidence about every file.
 *
 * The knowledge graph knows what references a file, a coverage report knows
 * what the suite *executed*, and git history knows whether anyone still
 * changes it. Each of the three is blind exactly where the others see: static
 * analysis cannot follow reflection, coverage cannot see a file its report
 * never mentioned, and history cannot tell finished code from abandoned code.
 * Taken alone, any one of them produces confident nonsense.
 *
 * So this command prints their *disagreements*. A file everything calls, that
 * changed last week, that nothing executed, is where the next regression
 * escapes. A file nothing calls, nothing executed and nobody has touched in a
 * year is probably deletable. Agreement is unremarkable and is listed only so
 * the denominator is visible.
 *
 * ## Coverage measures EXECUTION, not assertion
 *
 * Every coverage number here counts lines a test process ran. A line executed
 * by a test that asserts nothing about it is executed and unverified, and 100%
 * line coverage says nothing at all about which inputs were tried. For that
 * reason this command — like the core module behind it — says "executed" or
 * "covered" and never claims a file is verified by the suite.
 *
 * ## Missing evidence is not negative evidence
 *
 * Without a coverage report no file can be called unexecuted, only `unknown`,
 * and that is what gets printed. `completeness` and the caveats are emitted
 * *above* the rows rather than below them: a reader who skips them will read
 * absence of evidence as evidence of absence, which is the one failure mode
 * that would make this report worse than no report.
 */
export function makeEvidenceCommand(): Command {
  const cmd = new Command('evidence');
  cmd
    .description(
      'Cross-examine static references, coverage execution and git history per file',
    )
    .argument('[path]', 'Path to the project root')
    .option('--coverage <file>', 'lcov or cobertura report (format auto-detected)')
    .option('--verdict <name>', `Show only one verdict (${VERDICTS.join(', ')})`)
    .option('--stale-months <n>', 'Months without a change before a file is dormant', '6')
    .option('--min-covered <n>', 'Percent of executed lines that counts as covered', '50')
    .option('--json', 'Emit machine-readable JSON')
    .option('--all', 'List every row, including unknown and well-covered')
    .option('--fail-on-live', 'Exit 1 if any file is untested-but-live (for CI)')
    .action(async (pathArg: string | undefined, options: Record<string, string | boolean>) => {
      const projectRoot = resolve(pathArg ?? process.cwd());

      const loaded = await loadGraphResult(join(projectRoot, '.sprang'));
      if (!loaded.ok) {
        reportGraphFailure(loaded.error);
        process.exitCode = 1;
        return;
      }

      // Reject a bad --verdict before any work: a typo that silently prints an
      // empty matrix reads exactly like a clean bill of health.
      const verdictOption = options['verdict'];
      let filter: EvidenceVerdict | undefined;
      if (typeof verdictOption === 'string' && verdictOption !== '') {
        if (!isVerdict(verdictOption)) {
          process.stderr.write(
            `\n${RED}\u2716${RESET} \u201c${verdictOption}\u201d is not a verdict.\n` +
              `  ${DIM}Choose one of: ${VERDICTS.join(', ')}${RESET}\n\n`,
          );
          process.exitCode = 1;
          return;
        }
        filter = verdictOption;
      }

      const staleMonths = positiveInt(options['staleMonths'], 6);
      const minCoveredPercent = positiveInt(options['minCovered'], 50);

      const json = options['json'] === true;
      const coverage = await resolveCoverage(projectRoot, options['coverage']);

      const matrix = buildEvidenceMatrix(loaded.graph, coverage.files, {
        staleMonths,
        minCoveredPercent,
      });

      const rows = filter === undefined ? matrix.rows : matrix.rows.filter((r) => r.verdict === filter);

      if (json) {
        process.stdout.write(
          JSON.stringify(
            {
              completeness: matrix.completeness,
              caveats: matrix.caveats,
              counts: matrix.counts,
              coverage: {
                source: coverage.source,
                format: coverage.format,
                entries: coverage.files?.length ?? 0,
                notes: coverage.notes,
              },
              options: { staleMonths, minCoveredPercent, ...(filter ? { verdict: filter } : {}) },
              rows,
            },
            null,
            2,
          ) + '\n',
        );
      } else {
        printReport({
          matrix,
          rows,
          coverage,
          filter,
          staleMonths,
          minCoveredPercent,
          showAll: options['all'] === true,
        });
      }

      // The gate is about the whole matrix, not about whatever --verdict left
      // on screen: filtering the view must not filter the CI signal.
      if (options['failOnLive'] === true && matrix.counts['untested-but-live'] > 0) {
        if (!json) {
          process.stderr.write(
            `  ${RED}\u2716${RESET} ${matrix.counts['untested-but-live']} file(s) are referenced and still ` +
              `changing, yet the suite executed little of them.\n\n`,
          );
        }
        process.exitCode = 1;
      }
    });

  return cmd;
}

function isVerdict(value: string): value is EvidenceVerdict {
  return (VERDICTS as readonly string[]).includes(value);
}

function positiveInt(value: string | boolean | undefined, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/** What was read, from where, and everything that went wrong on the way. */
interface CoverageResolution {
  /** Undefined when no usable report was found — never an empty array. */
  files: FileCoverage[] | undefined;
  /** Path actually read, or null when the matrix runs without coverage. */
  source: string | null;
  format: 'lcov' | 'cobertura' | 'unknown' | null;
  /** Human-readable problems. Printed whether or not they were fatal. */
  notes: string[];
}

/**
 * Find and parse a coverage report, or explain why there is none.
 *
 * A missing or broken report is never fatal. The matrix is designed to degrade
 * to `unknown`, and refusing to run would push people towards passing
 * `--coverage` at a stale file just to get output — trading an honest
 * "unknown" for a confident wrong answer.
 */
async function resolveCoverage(
  projectRoot: string,
  explicit: string | boolean | undefined,
): Promise<CoverageResolution> {
  const notes: string[] = [];

  if (typeof explicit === 'string' && explicit !== '') {
    const path = resolve(projectRoot, explicit);
    let content: string;
    try {
      content = await readFile(path, 'utf-8');
    } catch {
      notes.push(
        `Could not read the coverage report at ${path}. Continuing without coverage — ` +
          `every coverage-dependent verdict will be "unknown".`,
      );
      return { files: undefined, source: null, format: null, notes };
    }
    return parsed(path, content, notes);
  }

  for (const candidate of DEFAULT_COVERAGE_PATHS) {
    const path = join(projectRoot, candidate);
    let content: string;
    try {
      content = await readFile(path, 'utf-8');
    } catch {
      continue;
    }
    return parsed(path, content, notes);
  }

  notes.push(
    `No coverage report found at any of: ${DEFAULT_COVERAGE_PATHS.join(', ')}.\n` +
      `    Every coverage-dependent verdict below will be "unknown" — that is not a\n` +
      `    finding about your code, it is a missing evidence source.\n` +
      `    Generate one with: ${HOW_TO_GENERATE}\n` +
      `    then re-run, or point at an existing report with --coverage <file>.`,
  );
  return { files: undefined, source: null, format: null, notes };
}

/** Parse content already read from `path`, reporting malformed input honestly. */
function parsed(path: string, content: string, notes: string[]): CoverageResolution {
  const format = detectCoverageFormat(content);
  const result = parseCoverage(content);

  if (result.format === 'unknown' || result.files.length === 0) {
    notes.push(
      format === 'unknown'
        ? `${path} is not a recognisable lcov or cobertura report, so it was ignored. ` +
            `Continuing without coverage; regenerate it with: ${HOW_TO_GENERATE}`
        : `${path} parsed as ${format} but contained no file entries, so it was ignored. ` +
            `Continuing without coverage.`,
    );
    return { files: undefined, source: null, format: result.format, notes };
  }

  return { files: result.files, source: path, format: result.format, notes };
}

interface ReportInput {
  matrix: EvidenceMatrix;
  rows: EvidenceRow[];
  coverage: CoverageResolution;
  filter: EvidenceVerdict | undefined;
  staleMonths: number;
  minCoveredPercent: number;
  /** List every row, including the ones with no action attached. */
  showAll: boolean;
}

function printReport(input: ReportInput): void {
  const { matrix, rows, coverage, filter, showAll } = input;
  const out = process.stdout;

  out.write(`\n${CYAN}Sprang evidence${RESET}\n\n`);

  // ── Where the evidence came from ────────────────────────────────────────
  if (coverage.source !== null) {
    out.write(`  ${DIM}Coverage: ${coverage.source} (${coverage.format ?? 'unknown'} format)${RESET}\n`);
  } else {
    out.write(`  ${DIM}Coverage: none${RESET}\n`);
  }
  out.write(
    `  ${DIM}Thresholds: dormant after ${input.staleMonths} month(s), ` +
      `covered at \u2265 ${input.minCoveredPercent}% of instrumented lines executed${RESET}\n`,
  );
  out.write(
    `  ${DIM}Coverage counts lines the suite EXECUTED, not lines it asserted anything about.${RESET}\n`,
  );

  // ── Completeness and caveats, above the rows, always ────────────────────
  out.write(`\n  Completeness: ${Math.round(matrix.completeness * 100)}% ` +
    `${DIM}(files with static, coverage and history evidence all present)${RESET}\n`);

  for (const note of coverage.notes) {
    out.write(`\n  ${YELLOW}!${RESET} ${note}\n`);
  }

  if (matrix.caveats.length > 0) {
    out.write(`\n  ${YELLOW}Caveats (${matrix.caveats.length}) — read these before the rows:${RESET}\n`);
    for (const caveat of matrix.caveats) out.write(`    ${YELLOW}!${RESET} ${caveat}\n`);
  }

  // ── Summary ─────────────────────────────────────────────────────────────
  out.write(`\n  ${matrix.rows.length} file(s) in the matrix\n`);
  for (const verdict of VERDICTS) {
    const count = matrix.counts[verdict];
    out.write(`    ${colourFor(verdict)}${verdict.padEnd(24)}${RESET} ${count}\n`);
  }

  if (matrix.rows.length === 0) {
    out.write(
      `\n  ${YELLOW}!${RESET} The matrix has no rows: no non-test file in the graph had a resolvable\n` +
        `    location. Nothing here supports any claim about this codebase.\n\n`,
    );
    return;
  }

  // ── Rows ────────────────────────────────────────────────────────────────
  if (rows.length === 0 && filter !== undefined) {
    out.write(`\n  ${YELLOW}!${RESET} No file has the verdict \u201c${filter}\u201d, so nothing is listed below.\n\n`);
    return;
  }

  // Only the verdicts a reader can act on, unless asked for everything.
  //
  // A full listing is 700+ lines on a repository this size, almost all of it
  // "no coverage entry exists for this file". A report nobody reads is not a
  // report, and burying two real findings under two hundred restatements of a
  // caveat already printed above is how it happens. `unknown` and
  // `well-covered` are still counted in the summary; they just do not each get
  // three lines.
  const ACTIONABLE = new Set<EvidenceVerdict>([
    'untested-but-live',
    'dead-and-untested',
    'covered-but-unreferenced',
  ]);

  // An explicit --verdict is a request for exactly those rows, so honour it
  // even when the verdict is not actionable.
  const listEverything = showAll || filter !== undefined;
  let hidden = 0;
  for (const verdict of VERDICTS) {
    const group = rows.filter((row) => row.verdict === verdict);
    if (group.length === 0) continue;
    if (!listEverything && !ACTIONABLE.has(verdict)) {
      hidden += group.length;
      continue;
    }
    const colour = colourFor(verdict);
    out.write(`\n  ${colour}${verdict}${RESET} ${DIM}(${group.length})${RESET}\n`);
    for (const row of group) {
      out.write(`    ${row.path}\n`);
      out.write(`      ${DIM}${row.reason}${RESET}\n`);
      out.write(`      ${DIM}${facts(row)}${RESET}\n`);
    }
  }

  if (hidden > 0) {
    out.write(
      `\n  ${DIM}${hidden} row(s) with no action attached (unknown or well-covered) not listed. ` +
        `Use --all to see them.${RESET}\n`,
    );
  }

  out.write('\n');
}

/** One line of raw evidence per row, so a verdict can be argued with. */
function facts(row: EvidenceRow): string {
  const parts = [`refs ${row.staticRefs}`];
  if (row.refConfidence !== undefined) {
    parts.push(`weakest ref confidence ${Math.round(row.refConfidence * 100) / 100}`);
  }
  parts.push(
    row.coveredPercent === undefined
      ? 'executed n/a'
      : `executed ${row.coveredPercent}% of instrumented lines`,
  );
  if (row.revisions !== undefined) parts.push(`${row.revisions} revision(s)`);
  if (row.ageMonths !== undefined) parts.push(`last change ${row.ageMonths} month(s) ago`);
  return parts.join(' \u00b7 ');
}

function colourFor(verdict: EvidenceVerdict): string {
  if (verdict === 'untested-but-live') return RED;
  if (verdict === 'dead-and-untested') return YELLOW;
  return DIM;
}
