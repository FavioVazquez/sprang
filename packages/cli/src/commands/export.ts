import { resolve, join, dirname } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { Command } from 'commander';
import {
  loadGraphResult,
  toMermaidArchitecture,
  toMermaidC4Context,
  generateWiki,
} from '@sprang/core';
import { reportGraphFailure } from '../graph-error.js';

const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

/**
 * Turn the graph into something a human can read without running anything.
 *
 * DeepWiki gives people a browsable wiki of any public repository for free,
 * and that is the comparison Sprang loses on for open-source projects. A local
 * equivalent generated from a graph we already have closes it — and unlike a
 * hosted service it works on private code, runs offline, and can show risk and
 * change history, because it is built from the same graph the agent uses.
 */
export function makeExportCommand(): Command {
  const cmd = new Command('export');
  cmd
    .description('Export the graph as a markdown wiki or Mermaid diagrams')
    .argument('[path]', 'Path to the project root')
    .option('-f, --format <format>', 'wiki | mermaid | c4', 'wiki')
    .option('-o, --out <dir>', 'Output directory (wiki) or file (diagrams)')
    .option('--group-by <mode>', 'layer | community | directory', 'layer')
    .option('--max-nodes <n>', 'Maximum groups in a diagram', '60')
    .option('--no-history', 'Omit git history from wiki pages')
    .action(async (pathArg: string | undefined, options: Record<string, string | boolean>) => {
      const projectRoot = resolve((pathArg as string) ?? process.cwd());
      const loaded = await loadGraphResult(join(projectRoot, '.sprang'));
      if (!loaded.ok) {
        reportGraphFailure(loaded.error);
        process.exitCode = 1;
        return;
      }

      const format = String(options['format'] ?? 'wiki');
      const graph = loaded.graph;

      if (format === 'mermaid' || format === 'c4') {
        const diagram =
          format === 'c4'
            ? toMermaidC4Context(graph)
            : toMermaidArchitecture(graph, {
                includeRisk: true,
                groupBy: String(options['groupBy'] ?? 'layer') as 'layer' | 'community' | 'directory',
                maxNodes: Number.parseInt(String(options['maxNodes'] ?? '60'), 10) || 60,
              });

        const out = options['out'];
        if (typeof out === 'string') {
          await mkdir(dirname(resolve(out)), { recursive: true });
          await writeFile(resolve(out), diagram + '\n', 'utf-8');
          process.stdout.write(`\n${CYAN}Wrote${RESET} ${out}\n\n`);
        } else {
          // No --out means stdout, so this composes with a pipe.
          process.stdout.write(diagram + '\n');
        }
        return;
      }

      if (format !== 'wiki') {
        process.stderr.write(`\n\u2716 Unknown format "${format}". Use wiki, mermaid or c4.\n\n`);
        process.exitCode = 1;
        return;
      }

      const outDir = resolve(String(options['out'] ?? join(projectRoot, '.sprang', 'wiki')));
      const pages = generateWiki(graph, {
        includeRisk: true,
        includeHistory: options['history'] !== false,
      });

      for (const page of pages) {
        const target = join(outDir, page.path);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, page.markdown, 'utf-8');
      }

      process.stdout.write(
        `\n${CYAN}Sprang wiki${RESET}\n\n` +
          `  ${pages.length} page(s) written to ${outDir}\n` +
          `  ${DIM}Start at ${join(outDir, 'index.md')}${RESET}\n\n`,
      );
    });

  return cmd;
}
