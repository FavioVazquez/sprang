import type { LoadGraphFailure } from '@sprang/core';

const RED = '\x1b[31m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

/**
 * Print why the graph could not be loaded, in the same terms the MCP server
 * uses.
 *
 * The distinction matters more than it looks: telling someone to run
 * `sprang scan` when the graph is present but schema-invalid sends them to
 * overwrite the very file that holds the evidence, and a re-scan cannot fix an
 * enrichment bug anyway.
 */
export function reportGraphFailure(error: LoadGraphFailure): void {
  process.stderr.write(`\n${RED}✖${RESET} ${error.message}\n`);
  process.stderr.write(`  ${DIM}${error.path}${RESET}\n`);
  if (error.code === 'GRAPH_INVALID') {
    process.stderr.write(`  ${DIM}${error.validation_issues}${RESET}\n`);
  }
  process.stderr.write(`  ${error.remedy}\n\n`);
}
