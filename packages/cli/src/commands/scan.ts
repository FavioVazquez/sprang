import { resolve } from 'node:path';
import { Command } from 'commander';
import ora from 'ora';
import { runPhase1Only, runSprangAnalysis } from '@sprang/core';

export function makeScanCommand(): Command {
  const cmd = new Command('scan');
  cmd
    .description('Scan a project and build (or refresh) the Sprang knowledge graph')
    .argument('[path]', 'Path to the project root to scan', undefined)
    .option('--no-background', 'Run Phase 2 LLM analysis inline instead of in the background')
    .option('--skip-llm', 'Phase 1 only — no LLM calls (fast skeleton graph)')
    .action(async (pathArg: string | undefined, options: { background: boolean; skipLlm: boolean }) => {
      const projectRoot = resolve(pathArg ?? process.cwd());

      if (!process.env['ANTHROPIC_API_KEY'] && !options.skipLlm) {
        process.stdout.write(
          'Note: ANTHROPIC_API_KEY is not set. Phase 2 LLM enrichment will be skipped.\n' +
            'Set ANTHROPIC_API_KEY to enable full analysis, or pass --skip-llm to suppress this message.\n\n'
        );
      }

      const spinner = ora('Phase 1: Scanning files...').start();

      try {
        if (options.skipLlm) {
          const graph = await runPhase1Only(projectRoot, { skipLLM: true });
          const fileCount = graph.nodes.filter((n) => n.type === 'file').length;
          spinner.succeed(`Scanned ${fileCount} files, ${graph.nodes.length} nodes created (skeleton only, LLM skipped)`);
          process.stdout.write(`\nGraph:  ${projectRoot}/.sprang/knowledge-graph.json\n`);
          process.stdout.write(`Report: ${projectRoot}/.sprang/SPRANG_REPORT.md\n\n`);
          return;
        }

        // Full scan — Phase 1 then Phase 2 (background or inline)
        await runSprangAnalysis(projectRoot, {
          phase: 'all',
          skipLLM: false,
          background: options.background !== false,
        });

        // Re-read the written graph for stats
        const graph = await runPhase1Only(projectRoot, { skipLLM: true });
        const fileCount = graph.nodes.filter((n) => n.type === 'file').length;

        spinner.succeed('Phase 1 complete');
        process.stdout.write(
          `\n Scanned ${fileCount} files, ${graph.nodes.length} nodes created` +
            (options.background !== false
              ? ' (Phase 2 analysis running in background)\n'
              : '\n')
        );
        process.stdout.write(`\nGraph:  ${projectRoot}/.sprang/knowledge-graph.json\n`);
        process.stdout.write(`Report: ${projectRoot}/.sprang/SPRANG_REPORT.md\n\n`);
        process.stdout.write(`Run 'sprang health' to see a summary.\n`);
      } catch (err) {
        spinner.fail('Scan failed');
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`Error: ${msg}\n`);
        process.exit(1);
      }
    });

  return cmd;
}
