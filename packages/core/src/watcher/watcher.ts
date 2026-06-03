import chokidar from 'chokidar';
import path from 'node:path';
import { DEFAULT_EXCLUDES } from '../schema/constants.js';
import type { SprangOptions } from '../agents/base.js';
import { runIncrementalUpdate } from './incremental.js';

export interface WatcherOptions extends SprangOptions {
  debounceMs?: number;
  onUpdate?: (changedFiles: string[], graph: unknown) => void;
  onError?: (err: Error) => void;
}

export function createWatcher(
  projectRoot: string,
  sprangDir: string,
  options: WatcherOptions = {},
): { close: () => Promise<void> } {
  const debounceMs = options.debounceMs ?? 2000;
  const pendingChanges = new Set<string>();
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const flush = async () => {
    if (pendingChanges.size === 0) return;
    const files = Array.from(pendingChanges);
    pendingChanges.clear();

    try {
      await runIncrementalUpdate(
        projectRoot,
        sprangDir,
        files,
        options,
        (msg) => process.stderr.write(`[sprang watch] ${msg}\n`),
      );
      options.onUpdate?.(files, null);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      options.onError?.(error);
      process.stderr.write(`[sprang watch] Error: ${error.message}\n`);
    }
  };

  const handleChange = (filePath: string) => {
    const relPath = path.isAbsolute(filePath)
      ? path.relative(projectRoot, filePath)
      : filePath;

    pendingChanges.add(relPath);

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void flush();
    }, debounceMs);
  };

  const watcher = chokidar.watch(projectRoot, {
    ignored: [
      ...DEFAULT_EXCLUDES,
      `${sprangDir}/intermediate/**`,
      `${sprangDir}/cache/**`,
      `${sprangDir}/*.tmp`,
    ],
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 800,
      pollInterval: 100,
    },
  });

  watcher.on('change', handleChange);
  watcher.on('add', handleChange);
  watcher.on('unlink', handleChange);

  watcher.on('error', (err) => {
    options.onError?.(err instanceof Error ? err : new Error(String(err)));
  });

  process.stderr.write(`[sprang watch] Watching ${projectRoot} for changes...\n`);

  return {
    close: async () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        await flush();
      }
      await watcher.close();
      process.stderr.write('[sprang watch] Stopped.\n');
    },
  };
}
