import { stat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { KnowledgeGraph } from '@sprang/core';
import { knowledgeGraphSchema, summarizeZodIssues } from '@sprang/core';

// Re-export so existing importers (and tests) can keep importing it from here.
export { summarizeZodIssues };

/** Why the graph could not be served. `GRAPH_INVALID` is the important one:
 *  the file exists but fails schema validation, so "run sprang scan" is bad advice. */
export type GraphErrorCode =
  | 'GRAPH_NOT_FOUND'
  | 'GRAPH_INVALID'
  | 'GRAPH_TOO_LARGE'
  | 'GRAPH_READ_ERROR';

export interface GraphError {
  error: string;
  code: GraphErrorCode;
  /** Absolute path we looked at, so the user can inspect it. */
  graph_path: string;
  /** Condensed Zod issues — only present for GRAPH_INVALID. */
  validation_issues?: string;
  /** What the caller should actually do about it. */
  remedy: string;
}

export class GraphLoader {
  private graphCache: KnowledgeGraph | null = null;
  private lastMtime: number = 0;
  private sprangRoot: string;
  private lastError: GraphError | null = null;

  constructor(sprangRoot: string) {
    this.sprangRoot = sprangRoot;
  }

  getRoot(): string {
    return this.sprangRoot;
  }

  async getGraph(): Promise<KnowledgeGraph | null> {
    await this.checkAndReload();
    return this.graphCache;
  }

  /** The reason the last load failed. Call only after `getGraph()` returned null. */
  getError(): GraphError {
    return (
      this.lastError ?? {
        error: 'Knowledge graph not found',
        code: 'GRAPH_NOT_FOUND',
        graph_path: this.graphPath(),
        remedy: 'Run `sprang scan` (or /sprang) to build the graph.',
      }
    );
  }

  private graphPath(): string {
    return join(this.sprangRoot, '.sprang', 'knowledge-graph.json');
  }

  private async checkAndReload(): Promise<void> {
    const filePath = this.graphPath();
    let fileStats: Awaited<ReturnType<typeof stat>>;
    try {
      fileStats = await stat(filePath);
    } catch {
      this.fail({
        error: 'Knowledge graph not found',
        code: 'GRAPH_NOT_FOUND',
        graph_path: filePath,
        remedy: 'Run `sprang scan` (or /sprang) to build the graph.',
      });
      return;
    }

    const mtime = fileStats.mtimeMs;
    if (mtime === this.lastMtime && this.graphCache !== null) {
      return;
    }

    const MAX_GRAPH_BYTES = 50 * 1024 * 1024; // 50 MB safety limit
    try {
      if (fileStats.size > MAX_GRAPH_BYTES) {
        this.fail({
          error: `Knowledge graph is too large (${Math.round(fileStats.size / 1024 / 1024)} MB, limit 50 MB)`,
          code: 'GRAPH_TOO_LARGE',
          graph_path: filePath,
          remedy: 'Re-scan with a narrower path, or add large generated directories to .gitignore.',
        });
        return;
      }
      const raw = await readFile(filePath, 'utf-8');
      const result = knowledgeGraphSchema.safeParse(JSON.parse(raw));
      if (!result.success) {
        const issues = summarizeZodIssues(result.error);
        this.fail({
          error: 'Knowledge graph exists but failed schema validation',
          code: 'GRAPH_INVALID',
          graph_path: filePath,
          validation_issues: issues,
          remedy:
            'The graph file is present but malformed — `sprang scan` will NOT fix it. ' +
            'Re-run `sprang merge` to re-normalise the intermediate chunks, or re-run /sprang-analyze.',
        });
        return;
      }
      this.graphCache = result.data as KnowledgeGraph;
      this.lastMtime = mtime;
      this.lastError = null;
    } catch (err) {
      this.fail({
        error: `Knowledge graph could not be read: ${err instanceof Error ? err.message : String(err)}`,
        code: 'GRAPH_READ_ERROR',
        graph_path: filePath,
        remedy: 'Check the file is valid JSON and readable, then retry.',
      });
    }
  }

  private fail(error: GraphError): void {
    this.graphCache = null;
    this.lastMtime = 0;
    this.lastError = error;
    process.stderr.write(`[sprang] ${error.error}\n`);
    if (error.validation_issues) process.stderr.write(`[sprang] ${error.validation_issues}\n`);
    process.stderr.write(`[sprang] ${error.remedy}\n`);
  }
}
