import { stat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { KnowledgeGraph } from '@sprang/core';
import { knowledgeGraphSchema } from '@sprang/core';

export class GraphLoader {
  private graphCache: KnowledgeGraph | null = null;
  private lastMtime: number = 0;
  private sprangRoot: string;

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

  private graphPath(): string {
    return join(this.sprangRoot, '.sprang', 'knowledge-graph.json');
  }

  private async checkAndReload(): Promise<void> {
    const filePath = this.graphPath();
    let mtime: number;
    try {
      const stats = await stat(filePath);
      mtime = stats.mtimeMs;
    } catch {
      // File does not exist
      this.graphCache = null;
      this.lastMtime = 0;
      return;
    }

    if (mtime === this.lastMtime && this.graphCache !== null) {
      return;
    }

    const MAX_GRAPH_BYTES = 50 * 1024 * 1024; // 50 MB safety limit
    try {
      const fileStats = await stat(filePath);
      if (fileStats.size > MAX_GRAPH_BYTES) {
        this.graphCache = null;
        this.lastMtime = 0;
        return;
      }
      const raw = await readFile(filePath, 'utf-8');
      const result = knowledgeGraphSchema.safeParse(JSON.parse(raw));
      if (!result.success) {
        process.stderr.write(`[sprang] Graph validation failed: ${result.error.message}\n`);
        this.graphCache = null;
        this.lastMtime = 0;
        return;
      }
      this.graphCache = result.data as KnowledgeGraph;
      this.lastMtime = mtime;
    } catch (err) {
      process.stderr.write(`[sprang] Graph load error: ${err instanceof Error ? err.message : String(err)}\n`);
      this.graphCache = null;
      this.lastMtime = 0;
    }
  }
}
