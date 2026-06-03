import { resolve, join } from 'node:path';
import { Command } from 'commander';
import { createWatcher } from '@sprang/core';

export function makeWatchCommand(): Command {
  const cmd = new Command('watch');
  cmd
    .description('Watch for file changes and incrementally update the knowledge graph')
    .argument('[path]', 'Path to the project root to watch', undefined)
    .option('--debounce <ms>', 'Debounce delay in milliseconds', '2000')
    .action(async (pathArg: string | undefined, options: { debounce: string }) => {
      const projectRoot = resolve(pathArg ?? process.cwd());
      const sprangDir = join(projectRoot, '.sprang');
      const rawDebounce = parseInt(options.debounce, 10);
      const debounceMs = Number.isFinite(rawDebounce)
        ? Math.max(100, Math.min(rawDebounce, 60_000))
        : 2000;

      const watcher = createWatcher(projectRoot, sprangDir, {
        debounceMs,
        onUpdate: (changedFiles) => {
          process.stdout.write(`[sprang watch] Updated ${changedFiles.length} file(s)\n`);
        },
        onError: (err) => {
          process.stderr.write(`[sprang watch] Error: ${err.message}\n`);
        },
      });

      const shutdown = async () => {
        process.stdout.write('\n[sprang watch] Shutting down...\n');
        await watcher.close();
        process.exit(0);
      };

      process.on('SIGINT', () => void shutdown());
      process.on('SIGTERM', () => void shutdown());

      process.stdout.write(`Watching ${projectRoot} — press Ctrl+C to stop\n`);

      // Keep alive
      await new Promise<void>(() => {});
    });

  return cmd;
}
