import { resolve, join } from 'node:path';
import { Command } from 'commander';
import { loadGraphOrNull } from '@sprang/core';

function riskBar(count: number, total: number, char: string): string {
  if (total === 0) return '';
  const filled = Math.round((count / total) * 20);
  return char.repeat(filled) + '.'.repeat(20 - filled);
}

function truncate(str: string, len: number): string {
  if (str.length <= len) return str;
  return str.slice(0, len - 3) + '...';
}

function pad(str: string, len: number): string {
  return str.padEnd(len);
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function makeHealthCommand(): Command {
  const cmd = new Command('health');
  cmd
    .description('Show a health summary of the existing Sprang knowledge graph')
    .argument('[path]', 'Path to the project root', undefined)
    .action(async (pathArg: string | undefined) => {
      const projectRoot = resolve(pathArg ?? process.cwd());
      const sprangDir = join(projectRoot, '.sprang');

      const graph = await loadGraphOrNull(sprangDir);

      if (!graph) {
        process.stdout.write(
          'No graph found — run sprang scan first.\n\n' +
            `Expected: ${sprangDir}/knowledge-graph.json\n`
        );
        return;
      }

      const { stats } = graph;
      const riskTotal = stats.risk_summary.high + stats.risk_summary.medium + stats.risk_summary.low;

      process.stdout.write('\n');
      process.stdout.write('='.repeat(60) + '\n');
      process.stdout.write('  Sprang Knowledge Graph — Health Report\n');
      process.stdout.write('='.repeat(60) + '\n\n');

      // Graph phase and timestamp
      process.stdout.write(`  Phase:        ${graph.phase === 'skeleton' ? 'skeleton (Phase 2 pending)' : 'complete'}\n`);
      process.stdout.write(`  Generated:    ${formatDate(graph.generated_at)}\n`);
      if (stats.phase2_completed_at) {
        process.stdout.write(`  Phase 2 done: ${formatDate(stats.phase2_completed_at)}\n`);
      }
      process.stdout.write(`  Project:      ${graph.project_name || graph.project_root}\n`);
      process.stdout.write('\n');

      // Node/edge counts
      process.stdout.write(`  Nodes:  ${stats.node_count}\n`);
      process.stdout.write(`  Edges:  ${stats.edge_count}\n`);
      process.stdout.write('\n');

      // Risk table
      process.stdout.write('  Risk Distribution\n');
      process.stdout.write('  ' + '-'.repeat(40) + '\n');
      process.stdout.write(`  High   : ${String(stats.risk_summary.high).padStart(5)}  [${riskBar(stats.risk_summary.high, riskTotal, '#')}]\n`);
      process.stdout.write(`  Medium : ${String(stats.risk_summary.medium).padStart(5)}  [${riskBar(stats.risk_summary.medium, riskTotal, '~')}]\n`);
      process.stdout.write(`  Low    : ${String(stats.risk_summary.low).padStart(5)}  [${riskBar(stats.risk_summary.low, riskTotal, '.')}]\n`);
      process.stdout.write('\n');

      // Top 5 risky nodes
      const topRisky = [...graph.nodes]
        .filter((n) => n.risk_score !== undefined)
        .sort((a, b) => (b.risk_score ?? 0) - (a.risk_score ?? 0))
        .slice(0, 5);

      if (topRisky.length > 0) {
        process.stdout.write('  Top 5 Risky Nodes\n');
        process.stdout.write('  ' + '-'.repeat(56) + '\n');
        process.stdout.write(
          `  ${pad('Label', 28)} ${pad('Type', 12)} ${'Risk'.padStart(5)}\n`
        );
        process.stdout.write('  ' + '-'.repeat(56) + '\n');
        for (const node of topRisky) {
          const score = (node.risk_score ?? 0).toFixed(2);
          process.stdout.write(
            `  ${pad(truncate(node.label, 28), 28)} ${pad(node.type, 12)} ${score.padStart(5)}\n`
          );
        }
        process.stdout.write('\n');
      }

      // Smell summary
      const smellEntries = Object.entries(stats.smell_summary).filter(
        (entry): entry is [string, number] => {
          const v = entry[1];
          return typeof v === 'number' && v > 0;
        }
      );
      if (smellEntries.length > 0) {
        process.stdout.write('  Code Smells\n');
        process.stdout.write('  ' + '-'.repeat(40) + '\n');
        for (const [category, count] of smellEntries) {
          process.stdout.write(`  ${pad(category, 30)} ${count}\n`);
        }
        process.stdout.write('\n');
      } else {
        process.stdout.write('  Code Smells: none detected\n\n');
      }

      process.stdout.write('='.repeat(60) + '\n\n');
    });

  return cmd;
}
