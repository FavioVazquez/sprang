import { resolve, join } from 'node:path';
import { execSync } from 'node:child_process';
import { Command } from 'commander';
import ora from 'ora';
import { readFile } from 'node:fs/promises';
import { runPhase1Only, runSprangAnalysis } from '@sprang/core';
import type { KnowledgeGraph } from '@sprang/core';

export function makeScanCommand(): Command {
  const cmd = new Command('scan');
  cmd
    .description('Scan a project and build (or refresh) the Sprang knowledge graph')
    .argument('[path]', 'Path to the project root to scan', undefined)
    .option('--no-background', 'Run Phase 2 enrichment inline instead of in the background')
    .option('--phase1-only', 'Static analysis only — build the skeleton graph without Phase 2 enrichment')
    .option('--if-stale', 'Only scan if the graph is out of date (git HEAD ≠ graph commit hash)')
    .action(async (pathArg: string | undefined, options: { background: boolean; phase1Only: boolean; ifStale: boolean }) => {
      const projectRoot = resolve(pathArg ?? process.cwd());

      // --if-stale: skip scan when graph's recorded hash matches current HEAD
      if (options.ifStale) {
        const graphPath = join(projectRoot, '.sprang', 'knowledge-graph.json');
        let graph: KnowledgeGraph | null = null;
        try {
          const raw = await readFile(graphPath, 'utf-8');
          graph = JSON.parse(raw) as KnowledgeGraph;
        } catch { /* file missing or parse error — treat as stale */ }

        let currentHead: string | undefined;
        try {
          currentHead = execSync('git rev-parse HEAD', { cwd: projectRoot, encoding: 'utf-8' }).trim();
        } catch { /* not a git repo or git unavailable */ }

        if (currentHead && graph?.stats?.gitCommitHash === currentHead) {
          const shortSha = currentHead.slice(0, 7);
          process.stdout.write(`[sprang] Graph is current (commit: ${shortSha}). Skipping scan.\n`);
          return;
        }
      }

      const spinner = ora('Phase 1: Scanning files...').start();

      try {
        if (options.phase1Only) {
          const graph = await runPhase1Only(projectRoot, { skipLLM: true });
          const fileCount = graph.nodes.filter((n) => n.type === 'file').length;
          spinner.succeed(`Scanned ${fileCount} files — ${graph.nodes.length} nodes (Phase 1 complete, Phase 2 ready for your AI agent)`);
          process.stdout.write(`\nGraph:  ${projectRoot}/.sprang/knowledge-graph.json\n`);
          process.stdout.write(`Report: ${projectRoot}/.sprang/SPRANG_REPORT.md\n`);
          process.stdout.write(`\nRun /sprang-onboard in your AI agent to start Phase 2 enrichment.\n\n`);
          return;
        }

        // Full scan — Phase 1 then Phase 2 (background or inline)
        await runSprangAnalysis(projectRoot, {
          phase: 'all',
          skipLLM: false,
          background: options.background !== false,
        });
        
        spinner.succeed(options.background !== false ? 'Phase 1 complete, Phase 2 in background' : 'Analysis complete');
        process.stdout.write(
          (options.background !== false
              ? '\nPhase 2 analysis is running in background. It will update the knowledge graph when done.\n'
              : '\nPhase 2 analysis complete.\n')
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
