import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import PQueue from 'p-queue';
import type { AgentContext, AgentResult } from './base.js';
import { BaseAgent } from './base.js';
import type {
  CommitRef,
  DecisionContext,
  SprangNode,
} from '../schema/types.js';
import {
  isGitRepo,
  getGitLog,
  getGitLogWithDiff,
  getCurrentHead,
} from '../utils/git.js';
import { ensureDir, writeFileAtomic, readJsonFileOrNull, fileExists } from '../utils/fs.js';

// ─── Types ────────────────────────────────────────────────────────────────────

interface HunkRange {
  startLine: number;
  lineCount: number;
}

interface FileGitData {
  commits: CommitRef[];
  prReferences: string[];
  changeFrequency: number;
  primaryAuthors: string[];
  rationale?: string;
  changelogEntries: string[];
  hunksPerCommit: Record<string, HunkRange[]>; // sha → hunk ranges for the file
}

interface GitLayerOutput {
  gitHead: string;
  fileData: Record<string, FileGitData>; // nodeId → data
  generatedAt: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function nodeIdHash(nodeId: string): string {
  return createHash('sha256').update(nodeId).digest('hex').slice(0, 16);
}

function extractFilePath(node: SprangNode): string | null {
  if (node.location?.file) return node.location.file;
  // Parse from id like "file:src/auth/login.ts"
  const match = node.id.match(/^file:(.+)$/);
  if (match) return match[1] ?? null;
  return null;
}

function extractPrReferences(messages: string[]): string[] {
  const refs = new Set<string>();
  const prPattern = /#(\d+)/g;
  for (const msg of messages) {
    let m: RegExpExecArray | null;
    // Reset regex lastIndex
    prPattern.lastIndex = 0;
    while ((m = prPattern.exec(msg)) !== null) {
      refs.add(`#${m[1]}`);
    }
  }
  return Array.from(refs);
}

function countRecentCommits(commits: CommitRef[], windowMs: number): number {
  const cutoff = Date.now() - windowMs;
  return commits.filter((c) => new Date(c.date).getTime() >= cutoff).length;
}

function computePrimaryAuthors(commits: CommitRef[], topN = 3): string[] {
  const freq = new Map<string, number>();
  for (const c of commits) {
    freq.set(c.author, (freq.get(c.author) ?? 0) + 1);
  }
  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([author]) => author);
}

function parseHunkHeaders(diff: string): HunkRange[] {
  const hunks: HunkRange[] = [];
  const hunkRegex = /@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/g;
  let m: RegExpExecArray | null;
  while ((m = hunkRegex.exec(diff)) !== null) {
    const startLine = parseInt(m[1] ?? '0', 10);
    const lineCount = parseInt(m[2] ?? '1', 10);
    hunks.push({ startLine, lineCount });
  }
  return hunks;
}

function hunkOverlapsNode(hunks: HunkRange[], startLine?: number, endLine?: number): boolean {
  if (startLine === undefined || endLine === undefined) return false;
  for (const hunk of hunks) {
    const hunkEnd = hunk.startLine + hunk.lineCount;
    // Overlap check: ranges [startLine, endLine] and [hunk.startLine, hunkEnd]
    if (startLine <= hunkEnd && endLine >= hunk.startLine) {
      return true;
    }
  }
  return false;
}

async function parseChangelogForShas(
  changelogPath: string,
  shas: Set<string>
): Promise<Map<string, string>> {
  const shaToEntry = new Map<string, string>();
  try {
    const content = await readFile(changelogPath, 'utf-8');
    const lines = content.split('\n');
    let currentEntry = '';
    let currentVersion = '';

    for (const line of lines) {
      // Version heading: ## [1.2.3] or ## 1.2.3
      const versionMatch = line.match(/^#+\s+(?:\[?)([\d.]+)/);
      if (versionMatch) {
        currentVersion = versionMatch[1] ?? '';
        currentEntry = line;
      } else {
        currentEntry += '\n' + line;
      }

      // Check if this line references any commit sha
      for (const sha of shas) {
        if (line.includes(sha) && currentVersion) {
          shaToEntry.set(sha, `${currentVersion}: ${currentEntry.trim().slice(0, 200)}`);
        }
      }
    }
  } catch {
    // Changelog not readable or not found
  }
  return shaToEntry;
}

// ─── Agent ────────────────────────────────────────────────────────────────────

export class GitLayerAgent extends BaseAgent {
  readonly id = 'git-layer';
  readonly phase = 2 as const;

  async run(ctx: AgentContext): Promise<AgentResult> {
    // 1. Check if git repo
    const isRepo = await isGitRepo(ctx.projectRoot);
    if (!isRepo) {
      return this.success(ctx);
    }

    // 2. Get all file nodes
    const fileNodes = ctx.graph.nodes.filter((n) => n.type === 'file');
    if (fileNodes.length === 0) {
      return this.success(ctx);
    }

    // Check cache validity
    const gitHeadCachePath = join(ctx.cacheDir, 'git-head.txt');
    const gitCacheDir = join(ctx.cacheDir, 'git');
    await ensureDir(gitCacheDir);

    let currentHead = '';
    try {
      currentHead = await getCurrentHead(ctx.projectRoot);
    } catch {
      // Not a git repo with commits — shouldn't happen after isGitRepo check
      return this.success(ctx);
    }

    let cachedHead = '';
    try {
      cachedHead = (await readFile(gitHeadCachePath, 'utf-8')).trim();
    } catch {
      // No cache yet
    }
    const cacheValid = cachedHead === currentHead && cachedHead !== '';

    // Find CHANGELOG
    const changelogPaths = [
      join(ctx.projectRoot, 'CHANGELOG.md'),
      join(ctx.projectRoot, 'CHANGELOG.rst'),
      join(ctx.projectRoot, 'CHANGELOG'),
    ];
    let changelogPath: string | null = null;
    for (const p of changelogPaths) {
      if (await fileExists(p)) {
        changelogPath = p;
        break;
      }
    }

    const ninety_days_ms = 90 * 24 * 60 * 60 * 1000;
    const fileDataMap = new Map<string, FileGitData>(); // nodeId → data

    // 3. Process files in parallel with concurrency=6
    const queue = new PQueue({ concurrency: 6 });

    const tasks = fileNodes.map((node) => async () => {
      const filePath = extractFilePath(node);
      if (!filePath) return;

      const cacheKey = nodeIdHash(node.id);
      const cacheFile = join(gitCacheDir, `${cacheKey}.json`);

      // Try cache first
      if (cacheValid) {
        const cached = await readJsonFileOrNull<FileGitData>(cacheFile);
        if (cached) {
          fileDataMap.set(node.id, cached);
          return;
        }
      }

      // Fetch git log
      const commits = await getGitLog(ctx.projectRoot, filePath, 50);
      if (commits.length === 0) return;

      const messages = commits.map((c) => c.message);
      const prReferences = extractPrReferences(messages);
      const changeFrequency = countRecentCommits(commits, ninety_days_ms);
      const primaryAuthors = computePrimaryAuthors(commits, 3);

      // For files with >3 commits, get diff data for top 5 commits
      const hunksPerCommit: Record<string, HunkRange[]> = {};
      if (commits.length > 3) {
        const diffCommits = await getGitLogWithDiff(ctx.projectRoot, filePath);
        // Sort by diff size descending, take top 5
        const topDiffCommits = diffCommits
          .sort((a, b) => b.diff.length - a.diff.length)
          .slice(0, 5);
        for (const dc of topDiffCommits) {
          hunksPerCommit[dc.sha] = parseHunkHeaders(dc.diff);
        }
      }

      // Changelog correlation
      const changelogEntries: string[] = [];
      if (changelogPath) {
        const shaSet = new Set(commits.map((c) => c.sha));
        const shaToEntry = await parseChangelogForShas(changelogPath, shaSet);
        for (const [, entry] of shaToEntry) {
          if (!changelogEntries.includes(entry)) {
            changelogEntries.push(entry);
          }
        }
      }

      const data: FileGitData = {
        commits,
        prReferences,
        changeFrequency,
        primaryAuthors,
        changelogEntries,
        hunksPerCommit,
      };

      fileDataMap.set(node.id, data);

      // Write cache
      await writeFileAtomic(cacheFile, JSON.stringify(data, null, 2));
    });

    for (const task of tasks) {
      void queue.add(task);
    }
    await queue.onIdle();

    // 5. LLM enrichment for files with >3 commits
    if (!ctx.options.skipLLM) {
      const filesToEnrich = fileNodes.filter((n) => {
        const data = fileDataMap.get(n.id);
        return data && data.commits.length > 3;
      });

      // Batch up to 20 files per LLM call
      const batchSize = 20;
      for (let i = 0; i < filesToEnrich.length; i += batchSize) {
        const batch = filesToEnrich.slice(i, i + batchSize);
        const prompts = batch.map((node) => {
          const data = fileDataMap.get(node.id)!;
          const top3 = data.commits.slice(0, 3).map((c) => c.message).join('\n- ');
          const filePath = extractFilePath(node) ?? node.id;
          return (
            `Given these commit messages for file "${filePath}":\n- ${top3}\n\n` +
            `Extract 1-2 sentences explaining WHY this code exists or was changed ` +
            `(the business reason, not what changed technically).`
          );
        });

        try {
          const results = await ctx.llm.completeBatch(prompts);
          results.forEach((rationale, idx) => {
            const node = batch[idx];
            if (!node) return;
            const data = fileDataMap.get(node.id);
            if (data) {
              data.rationale = rationale.trim();
            }
          });
        } catch {
          // LLM call failed — continue without enrichment
        }
      }
    }

    // 4. Function/class node association: map commits to specific symbols via hunk overlap
    const functionClassNodes = ctx.graph.nodes.filter(
      (n) => n.type === 'function' || n.type === 'class'
    );

    // Build parent file map: fileNode.id → fileNode (file nodes keyed by their file path)
    const fileNodesByPath = new Map<string, SprangNode>();
    for (const node of fileNodes) {
      const fp = extractFilePath(node);
      if (fp) fileNodesByPath.set(fp, node);
    }

    const symbolDataMap = new Map<string, FileGitData>(); // symbol nodeId → filtered data

    for (const symNode of functionClassNodes) {
      const symFilePath = symNode.location?.file;
      if (!symFilePath) continue;

      const fileNode = fileNodesByPath.get(symFilePath);
      if (!fileNode) continue;

      const fileData = fileDataMap.get(fileNode.id);
      if (!fileData) continue;

      // Filter commits that have hunk overlap with this symbol's lines
      const relevantCommits = fileData.commits.filter((c) => {
        const hunks = fileData.hunksPerCommit[c.sha];
        if (!hunks || hunks.length === 0) {
          // No hunk data: include all commits (conservative)
          return true;
        }
        return hunkOverlapsNode(hunks, symNode.location?.start_line, symNode.location?.end_line);
      });

      if (relevantCommits.length > 0) {
        symbolDataMap.set(symNode.id, {
          commits: relevantCommits,
          prReferences: extractPrReferences(relevantCommits.map((c) => c.message)),
          changeFrequency: countRecentCommits(relevantCommits, ninety_days_ms),
          primaryAuthors: computePrimaryAuthors(relevantCommits, 3),
          changelogEntries: fileData.changelogEntries,
          hunksPerCommit: fileData.hunksPerCommit,
          rationale: fileData.rationale,
        });
      }
    }

    // 8. Enrich all affected nodes with decision_context
    const graph = ctx.graph;
    const allEnrichable = new Map<string, FileGitData>([...fileDataMap, ...symbolDataMap]);

    for (const node of graph.nodes) {
      const data = allEnrichable.get(node.id);
      if (!data || data.commits.length === 0) continue;

      const lastChanged =
        data.commits[0]?.date ?? new Date().toISOString();

      const rationale_snippets: string[] = [];
      if (data.rationale) rationale_snippets.push(data.rationale);

      const decisionContext: DecisionContext = {
        commits: data.commits,
        primary_authors: data.primaryAuthors,
        last_changed: lastChanged,
        change_frequency: data.changeFrequency,
        rationale_snippets,
        pr_references: data.prReferences,
        changelog_entries: data.changelogEntries,
      };

      node.decision_context = decisionContext;
    }

    // Update git head cache
    await writeFileAtomic(gitHeadCachePath, currentHead);

    // 9. Write intermediate output
    const outputData: GitLayerOutput = {
      gitHead: currentHead,
      fileData: Object.fromEntries(
        Array.from(allEnrichable.entries()).map(([k, v]) => [k, v])
      ),
      generatedAt: new Date().toISOString(),
    };
    await this.writeIntermediate(ctx, 'git-layer.json', outputData);

    return this.success(ctx, graph);
  }
}
