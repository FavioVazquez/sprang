import { resolve, join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { Command } from 'commander';
import {
  loadGraphResult,
  readRepoHistory,
  buildEvalDataset,
  runEval,
  formatEvalReport,
  type ArmName,
} from '@sprang/core';
import { reportGraphFailure } from '../graph-error.js';

const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

/**
 * Measure whether Sprang actually helps — on the user's own repository.
 *
 * Every merged bug-fix commit is a free labelled retrieval example: the message
 * is the query and the files it changed are the answer. That makes it possible
 * to answer "does this help *my* codebase" without a public benchmark, without
 * labelling anything by hand, and without contamination, since the model has
 * never seen a private repository's history.
 *
 * The output is an ablation ladder rather than a single number. One number for
 * "Sprang" would hide which of the four layers earns its keep — and would hide
 * it just as effectively if one of them contributed nothing.
 */
export function makeEvalCommand(): Command {
  const cmd = new Command('eval');
  cmd
    .description(
      'Measure retrieval quality against this repository\u2019s own bug-fix history',
    )
    .argument('[path]', 'Path to the project root', undefined)
    .option('--since-months <n>', 'History window to mine examples from', '24')
    .option('--limit <n>', 'Maximum examples to evaluate', '200')
    .option('--budget <n>', 'Token budget given to the full pipeline', '100000')
    .option('--arms <list>', 'Comma-separated arms to run (default: all)')
    .option('--json', 'Emit machine-readable JSON instead of a table')
    .option('--out <file>', 'Write the report to a file as well as stdout')
    .action(async (pathArg: string | undefined, options: Record<string, string | boolean>) => {
      const projectRoot = resolve((pathArg as string) ?? process.cwd());
      const sprangDir = join(projectRoot, '.sprang');

      const loaded = await loadGraphResult(sprangDir);
      if (!loaded.ok) {
        reportGraphFailure(loaded.error);
        process.exitCode = 1;
        return;
      }

      const sinceMonths = Number.parseInt(String(options['sinceMonths'] ?? '24'), 10) || 24;
      const limit = Number.parseInt(String(options['limit'] ?? '200'), 10) || 200;
      const budget = Number.parseInt(String(options['budget'] ?? '100000'), 10) || 100_000;

      process.stdout.write(`\n${CYAN}Sprang eval${RESET}\n\n`);
      process.stdout.write(`  ${DIM}Mining examples from the last ${sinceMonths} months...${RESET}\n`);

      const history = await readRepoHistory(projectRoot, { sinceMonths });
      if (history.empty) {
        process.stderr.write(
          '\n\u2716 No git history found.\n' +
            '  The evaluation is built from this repository\u2019s own bug-fix commits,\n' +
            '  so it needs a git repository with history in the selected window.\n\n',
        );
        process.exitCode = 1;
        return;
      }

      const examples = buildEvalDataset(history, { sinceMonths, limit });
      if (examples.length === 0) {
        process.stderr.write(
          `\n\u2716 No usable examples in the last ${sinceMonths} months.\n` +
            '  Examples come from commits that look like bug fixes, touch between one and\n' +
            '  five source files, and have a message long enough to act as a query.\n' +
            '  Try a wider window: sprang eval --since-months 48\n\n',
        );
        process.exitCode = 1;
        return;
      }

      process.stdout.write(
        `  ${DIM}${examples.length} example(s) from ${history.commits.length} commits${RESET}\n`,
      );
      process.stdout.write(`  ${DIM}Running arms...${RESET}\n\n`);

      const armsOption = options['arms'];
      const arms =
        typeof armsOption === 'string'
          ? (armsOption.split(',').map((a) => a.trim()) as ArmName[])
          : undefined;

      const result = runEval(loaded.graph, examples, {
        budgetTokens: budget,
        ...(arms ? { arms } : {}),
      });

      const output = options['json']
        ? JSON.stringify(result, null, 2)
        : formatEvalReport(result);

      process.stdout.write(output + '\n\n');

      const outFile = options['out'];
      if (typeof outFile === 'string') {
        await writeFile(resolve(outFile), output + '\n', 'utf-8');
        process.stdout.write(`  ${DIM}Written to ${outFile}${RESET}\n\n`);
      }

      // A pipeline that cannot beat substring matching on file paths is not
      // worth its complexity, and CI should be able to notice.
      const full = result.arms.find((a) => a.arm === 'full');
      const keyword = result.arms.find((a) => a.arm === 'keyword');
      if (full && keyword && (full.aggregate.recallAt[10] ?? 0) < (keyword.aggregate.recallAt[10] ?? 0)) {
        process.stderr.write(
          '  \u2716 The full pipeline did not beat the keyword baseline at R@10.\n\n',
        );
        process.exitCode = 1;
      }
    });

  return cmd;
}
