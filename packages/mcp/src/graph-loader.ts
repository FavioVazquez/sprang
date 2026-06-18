import { stat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ZodError } from 'zod';
import type { KnowledgeGraph } from '@sprang/core';
import { knowledgeGraphSchema } from '@sprang/core';

/**
 * Turn a (potentially huge) ZodError into a concise, actionable one-liner:
 * total issue count plus the few most common distinct "path :: message" shapes.
 * Array indices collapse to `[]` so e.g. 64 bad domain steps read as one line.
 */
export function summarizeZodIssues(error: ZodError): string {
  const counts = new Map<string, number>();
  for (const issue of error.issues) {
    const path = issue.path.map((p) => (typeof p === 'number' ? '[]' : p)).join('.');
    const key = `${path || '<root>'}: ${issue.message}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const top = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k, c]) => (c > 1 ? `${k} (×${c})` : k));
  return `${error.issues.length} issue(s): ${top.join('; ')}${counts.size > 3 ? ' …' : ''}`;
}

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
    let fileStats: Awaited<ReturnType<typeof stat>>;
    try {
      fileStats = await stat(filePath);
    } catch {
      // File does not exist
      this.graphCache = null;
      this.lastMtime = 0;
      return;
    }

    const mtime = fileStats.mtimeMs;
    if (mtime === this.lastMtime && this.graphCache !== null) {
      return;
    }

    const MAX_GRAPH_BYTES = 50 * 1024 * 1024; // 50 MB safety limit
    try {
      if (fileStats.size > MAX_GRAPH_BYTES) {
        this.graphCache = null;
        this.lastMtime = 0;
        return;
      }
      const raw = await readFile(filePath, 'utf-8');
      const result = knowledgeGraphSchema.safeParse(JSON.parse(raw));
      if (!result.success) {
        process.stderr.write(`[sprang] Graph validation failed — ${summarizeZodIssues(result.error)}\n`);
        process.stderr.write('[sprang] Re-run "/sprang-analyze" or "sprang scan" to regenerate a valid graph.\n');
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
