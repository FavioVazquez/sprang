import { resolve, join } from 'node:path';
import { Command } from 'commander';
import { readFile, stat } from 'node:fs/promises';

export function makeStatusCommand(): Command {
  const cmd = new Command('status');
  cmd
    .description('Show the current state of the Sprang knowledge graph')
    .argument('[path]', 'Path to the project root', undefined)
    .action(async (pathArg: string | undefined) => {
      const projectRoot = resolve(pathArg ?? process.cwd());
      const sprangDir = join(projectRoot, '.sprang');
      const graphPath = join(sprangDir, 'knowledge-graph.json');
      const progressPath = join(sprangDir, 'intermediate', 'phase2-progress.json');

      // Check if graph exists
      let graphStat;
      try {
        graphStat = await stat(graphPath);
      } catch {
        process.stdout.write('No knowledge graph found. Run `sprang scan` first.\n');
        return;
      }

      const ageMs = Date.now() - graphStat.mtimeMs;
      const ageMin = Math.floor(ageMs / 60_000);
      const ageHr  = Math.floor(ageMs / 3_600_000);
      const ageDays = Math.floor(ageMs / 86_400_000);
      const ageStr = ageDays > 0 ? `${ageDays}d ago`
        : ageHr > 0 ? `${ageHr}h ago`
        : `${ageMin}m ago`;

      let graph: { phase: string; nodes: unknown[]; edges: unknown[]; project_name: string; stats?: { llm_token_usage?: number } } | null = null;
      try {
        const raw = await readFile(graphPath, 'utf-8');
        graph = JSON.parse(raw);
      } catch {
        process.stdout.write('Graph file exists but could not be parsed.\n');
        return;
      }

      if (!graph) return;

      // Check if Phase 2 is running
      let phase2Running = false;
      let phase2Agents: Record<string, { status: string }> = {};
      try {
        const raw = await readFile(progressPath, 'utf-8');
        const progress = JSON.parse(raw) as {
          completedAt?: string;
          agents: Record<string, { status: string }>;
        };
        phase2Running = !progress.completedAt;
        phase2Agents = progress.agents;
      } catch {
        // No progress file — Phase 2 either not started or complete
      }

      const phaseLabel = graph.phase === 'skeleton'
        ? 'skeleton (Phase 2 pending)'
        : 'complete';

      process.stdout.write('\n');
      process.stdout.write(`  Project:  ${graph.project_name}\n`);
      process.stdout.write(`  Phase:    ${phaseLabel}\n`);
      process.stdout.write(`  Updated:  ${ageStr}\n`);
      process.stdout.write(`  Nodes:    ${graph.nodes.length}\n`);
      process.stdout.write(`  Edges:    ${graph.edges.length}\n`);
      if (graph.stats?.llm_token_usage) {
        process.stdout.write(`  Tokens:   ${graph.stats.llm_token_usage.toLocaleString()}\n`);
      }

      if (phase2Running) {
        process.stdout.write('\n  Phase 2 agents:\n');
        for (const [agent, info] of Object.entries(phase2Agents)) {
          const icon = info.status === 'done' ? '✓' : info.status === 'running' ? '⟳' : info.status === 'failed' ? '✗' : '·';
          process.stdout.write(`    ${icon} ${agent.padEnd(24)} ${info.status}\n`);
        }
      }

      process.stdout.write('\n');
    });

  return cmd;
}
