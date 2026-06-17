import { resolve, join } from 'node:path';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { Command } from 'commander';
import { generateMermaid } from '@sprang/core';
import type { KnowledgeGraph } from '@sprang/core';

export function makeDiagramCommand(): Command {
  const cmd = new Command('diagram');
  cmd
    .description('Generate a Mermaid architecture diagram from the knowledge graph')
    .argument('[path]', 'Path to the project root', undefined)
    .option('--output <file>', 'Output file path (default: prints to stdout)')
    .option('--format <format>', 'Output format: mermaid (default)', 'mermaid')
    .action(async (pathArg: string | undefined, options: { output?: string; format: string }) => {
      const projectRoot = resolve(pathArg ?? process.cwd());
      const graphPath = join(projectRoot, '.sprang', 'knowledge-graph.json');

      if (!existsSync(graphPath)) {
        process.stderr.write(`No knowledge graph found at ${graphPath}\n`);
        process.stderr.write('Run "sprang scan" first to build the graph.\n');
        process.exit(1);
      }

      let graph: KnowledgeGraph;
      try {
        const raw = await readFile(graphPath, 'utf-8');
        graph = JSON.parse(raw) as KnowledgeGraph;
      } catch (err) {
        process.stderr.write(`Failed to parse knowledge graph: ${err instanceof Error ? err.message : String(err)}\n`);
        process.exit(1);
      }

      const diagram = generateMermaid(graph);
      const output = '```mermaid\n' + diagram + '\n```\n';

      if (options.output) {
        await writeFile(options.output, output, 'utf-8');
        process.stdout.write(`Diagram written to ${options.output}\n`);
      } else {
        process.stdout.write(output);
      }
    });

  return cmd;
}
