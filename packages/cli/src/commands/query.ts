import { resolve, join } from 'node:path';
import { Command } from 'commander';
import { loadGraphOrNull, readJsonFileOrNull, semanticSearch } from '@sprang/core';
import type { EmbeddingStore } from '@sprang/core';

function truncate(str: string, len: number): string {
  if (str.length <= len) return str;
  return str.slice(0, len - 3) + '...';
}

function pad(str: string, len: number): string {
  return str.padEnd(len);
}

export function makeQueryCommand(): Command {
  const cmd = new Command('query');
  cmd
    .description('Search the knowledge graph for nodes matching a question or keyword')
    .argument('<question>', 'Search query — matched against node labels and summaries')
    .argument('[path]', 'Project root path')
    .option('-t, --types <types>', 'Comma-separated node types to filter (e.g. function,class)')
    .option('-n, --limit <n>', 'Maximum results to show', '20')
    .option('-p, --path <path>', 'Project root path (alternative to positional argument)', undefined)
    .option('--semantic', 'Use semantic similarity search instead of keyword matching')
    .action(async (question: string, pathArg: string | undefined, options: { types?: string; limit: string; path?: string; semantic?: boolean }) => {
      const projectRoot = resolve(options.path ?? pathArg ?? process.cwd());
      const sprangDir = join(projectRoot, '.sprang');

      const graph = await loadGraphOrNull(sprangDir);
      if (!graph) {
        process.stdout.write(
          'No graph found — run sprang scan first.\n\n' +
            `Expected: ${sprangDir}/knowledge-graph.json\n`
        );
        return;
      }

      const rawLimit = parseInt(options.limit, 10);
      const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(rawLimit, 1000)) : 20;
      const nodeTypes = options.types
        ? options.types.split(',').map((t) => t.trim()).filter(Boolean)
        : undefined;

      if (options.semantic) {
        // ── Semantic mode ──────────────────────────────────────────────────────
        const embeddingStorePath = join(sprangDir, 'cache', 'embeddings.json');
        const embeddingStore = await readJsonFileOrNull<EmbeddingStore>(embeddingStorePath);

        const candidates = nodeTypes && nodeTypes.length > 0
          ? graph.nodes.filter((n) => nodeTypes.includes(n.type))
          : graph.nodes;

        const usingTfIdf = embeddingStore === null || Object.keys(embeddingStore.embeddings).length === 0;

        const results = semanticSearch(
          question,
          candidates,
          embeddingStore?.embeddings ?? null,
          { limit }
        );

        if (results.length === 0) {
          process.stdout.write(`No semantically similar nodes found for "${question}".\n`);
          return;
        }

        // Build node lookup
        const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));

        process.stdout.write('\n');
        if (usingTfIdf) {
          process.stdout.write(
            `(using TF-IDF fallback — run /sprang-analyze to generate richer embeddings)\n\n`
          );
        }
        process.stdout.write(
          `Found ${results.length} semantic match${results.length !== 1 ? 'es' : ''} for "${question}"\n\n`
        );
        process.stdout.write(
          `${pad('Label', 30)} ${pad('Type', 12)} ${'Score'.padStart(5)}  Summary\n`
        );
        process.stdout.write('-'.repeat(90) + '\n');

        for (const result of results) {
          const node = nodeMap.get(result.nodeId);
          const label = node?.label ?? result.nodeId;
          const type = node?.type ?? 'unknown';
          const summary = node?.summary ? truncate(node.summary, 100) : '';
          const scoreStr = result.score.toFixed(2);
          process.stdout.write(
            `${pad(truncate(label, 30), 30)} ${pad(type, 12)} ${scoreStr.padStart(5)}  ${summary}\n`
          );
        }

        process.stdout.write('\n');
        return;
      }

      // ── Text mode (default) ────────────────────────────────────────────────
      const lowerQuery = question.toLowerCase();
      // Tokenize so multi-word queries ("validate input") match on any word
      // instead of requiring the whole phrase as a substring.
      const tokens = lowerQuery.split(/\s+/).filter(Boolean);

      type ScoredNode = {
        id: string;
        type: string;
        label: string;
        summary?: string;
        risk_score?: number;
        _score: number;
      };

      const scored: ScoredNode[] = [];

      for (const node of graph.nodes) {
        if (nodeTypes && nodeTypes.length > 0 && !nodeTypes.includes(node.type)) {
          continue;
        }

        const labelLower = node.label.toLowerCase();
        const summaryLower = node.summary?.toLowerCase() ?? '';

        // Phrase match (whole query) ranks highest; token matches (any word)
        // provide the fallback for multi-word queries.
        const labelPhrase = labelLower.includes(lowerQuery);
        const summaryPhrase = summaryLower.includes(lowerQuery);
        const labelTokens = tokens.filter((t) => labelLower.includes(t)).length;
        const summaryTokens = tokens.filter((t) => summaryLower.includes(t)).length;

        if (!labelPhrase && !summaryPhrase && labelTokens === 0 && summaryTokens === 0) continue;

        let score = 0;
        if (labelLower === lowerQuery) {
          score = 4;
        } else if (labelPhrase) {
          score = 3;
        } else if (labelTokens === tokens.length && tokens.length > 0) {
          score = 2.5; // every query word appears in the label
        } else if (labelTokens > 0) {
          score = 2;
        } else {
          score = 1; // summary-only (phrase or token) match
        }

        scored.push({
          id: node.id,
          type: node.type,
          label: node.label,
          summary: node.summary,
          risk_score: node.risk_score,
          _score: score,
        });
      }

      scored.sort((a, b) => {
        if (b._score !== a._score) return b._score - a._score;
        return (b.risk_score ?? 0) - (a.risk_score ?? 0);
      });

      const results = scored.slice(0, limit);

      if (results.length === 0) {
        process.stdout.write(`No nodes matching "${question}".\n`);
        return;
      }

      process.stdout.write('\n');
      process.stdout.write(`Found ${scored.length} match${scored.length !== 1 ? 'es' : ''} for "${question}" (showing ${results.length})\n\n`);
      process.stdout.write(
        `${pad('Label', 30)} ${pad('Type', 12)} ${'Risk'.padStart(5)}  Summary\n`
      );
      process.stdout.write('-'.repeat(90) + '\n');

      for (const node of results) {
        const risk = node.risk_score !== undefined ? node.risk_score.toFixed(2) : '  --';
        const summary = node.summary ? truncate(node.summary, 100) : '';
        process.stdout.write(
          `${pad(truncate(node.label, 30), 30)} ${pad(node.type, 12)} ${String(risk).padStart(5)}  ${summary}\n`
        );
      }

      process.stdout.write('\n');
    });

  return cmd;
}
