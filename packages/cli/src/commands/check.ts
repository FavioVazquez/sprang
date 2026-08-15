import { resolve, join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { Command } from 'commander';
import {
  loadGraphResult,
  parseRulesFile,
  checkRules,
  EXAMPLE_RULES_FILE,
} from '@sprang/core';
import { reportGraphFailure } from '../graph-error.js';

const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const GREEN = '\x1b[32m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

const RULES_FILE = '.sprang/rules.txt';

/**
 * Enforce architecture rules the team has written down.
 *
 * Sprang already reports layer violations, but a report is advice and advice
 * decays: the violation count creeps up, everyone stops reading it, and the
 * architecture quietly becomes whatever the code happens to do. A rule a team
 * commits and CI enforces is a contract instead — and unlike a linter's rules,
 * these are about the shape of the system rather than the shape of a line.
 *
 * Exits non-zero on any error-severity violation, so it drops straight into a
 * pipeline.
 */
export function makeCheckCommand(): Command {
  const cmd = new Command('check');
  cmd
    .description('Enforce architecture rules from .sprang/rules.txt')
    .argument('[path]', 'Path to the project root')
    .option('--rules <file>', 'Rules file', RULES_FILE)
    .option('--init', 'Write a documented starter rules file and exit')
    .option('--json', 'Emit machine-readable JSON')
    .action(async (pathArg: string | undefined, options: Record<string, string | boolean>) => {
      const projectRoot = resolve((pathArg as string) ?? process.cwd());
      const rulesPath = resolve(projectRoot, String(options['rules'] ?? RULES_FILE));

      if (options['init']) {
        await writeFile(rulesPath, EXAMPLE_RULES_FILE, 'utf-8');
        process.stdout.write(
          `\n${GREEN}Wrote${RESET} ${rulesPath}\n` +
            `  ${DIM}Edit it, commit it, then run \`sprang check\` in CI.${RESET}\n\n`,
        );
        return;
      }

      let content: string;
      try {
        content = await readFile(rulesPath, 'utf-8');
      } catch {
        process.stderr.write(
          `\n\u2716 No rules file at ${rulesPath}\n` +
            `  Create one with: sprang check --init\n\n`,
        );
        process.exitCode = 1;
        return;
      }

      const { rules, errors } = parseRulesFile(content);
      if (errors.length > 0) {
        process.stderr.write(`\n${RED}\u2716 ${rulesPath} has ${errors.length} problem(s):${RESET}\n`);
        for (const error of errors) process.stderr.write(`    ${error}\n`);
        process.stderr.write('\n');
        process.exitCode = 1;
        return;
      }

      const loaded = await loadGraphResult(join(projectRoot, '.sprang'));
      if (!loaded.ok) {
        reportGraphFailure(loaded.error);
        process.exitCode = 1;
        return;
      }

      const result = checkRules(loaded.graph, rules);

      if (options['json']) {
        process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      } else {
        process.stdout.write(`\n${DIM}${result.rulesEvaluated} rule(s) evaluated${RESET}\n\n`);

        // A rule that matches nothing is almost always a typo, and a silent
        // pass is the worst possible response to one.
        for (const unmatched of result.unmatchedRules) {
          process.stdout.write(`  ${YELLOW}?${RESET} matched no files: ${unmatched}\n`);
        }
        if (result.unmatchedRules.length > 0) process.stdout.write('\n');

        for (const violation of result.violations) {
          const colour = violation.severity === 'error' ? RED : YELLOW;
          const mark = violation.severity === 'error' ? '\u2716' : '!';
          process.stdout.write(`  ${colour}${mark}${RESET} ${violation.from}\n`);
          process.stdout.write(`      ${DIM}${violation.edgeType} \u2192${RESET} ${violation.to}\n`);
          process.stdout.write(`      ${DIM}${violation.rule}${RESET}\n`);
          if (violation.comment) process.stdout.write(`      ${DIM}${violation.comment}${RESET}\n`);
          process.stdout.write('\n');
        }

        if (result.violations.length === 0) {
          process.stdout.write(`  ${GREEN}\u2713 No violations.${RESET}\n\n`);
        } else {
          process.stdout.write(
            `  ${result.errorCount} error(s), ${result.warningCount} warning(s)\n\n`,
          );
        }
      }

      if (result.errorCount > 0) process.exitCode = 1;
    });

  return cmd;
}
