import { resolve, join } from 'node:path';
import { Command } from 'commander';
import { loadGraphOrNull } from '@sprang/core';

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
    .option('-t, --types <types>', 'Comma-separated node types to filter (e.g. function,class)')
    .option('-n, --limit <n>', 'Maximum results to show', '20')
    .option('-p, --path <path>', 'Project root path', undefined)
    .action(async (question: string, options: { types?: string; limit: string; path?: string }) => {
      const projectRoot = resolve(options.path ?? process.cwd());
      const sprangDir = join(projectRoot, '.sprang');

      const graph = await loadGraphOrNull(sprangDir);
      if (!graph) {
        process.stdout.write(
          'No graph found — run sprang scan first.\n\n' +
            `Expected: ${sprangDir}/knowledge-graph.json\n`
        );
        return;
      }

      const limit = parseInt(options.limit, 10) || 20;
      const nodeTypes = options.types
        ? options.types.split(',').map((t) => t.trim()).filter(Boolean)
        : undefined;

      const lowerQuery = question.toLowerCase();

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

        const labelMatch = labelLower.includes(lowerQuery);
        const summaryMatch = summaryLower.includes(lowerQuery);

        if (!labelMatch && !summaryMatch) continue;

        let score = 0;
        if (labelLower === lowerQuery) {
          score = 3;
        } else if (labelMatch) {
          score = 2;
        } else {
          score = 1;
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
