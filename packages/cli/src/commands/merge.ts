import { resolve, join, basename } from 'node:path';
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { Command } from 'commander';
import ora from 'ora';

/**
 * Normalize a value that should be an array but agents sometimes write as a dict.
 * { "id1": {...}, "id2": {...} } -> [{...}, {...}]
 */
function toArray(val: unknown): unknown[] {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  if (typeof val === 'object') return Object.values(val as Record<string, unknown>);
  return [];
}

/**
 * sprang merge — assemble intermediate chunk files into a valid knowledge-graph.json.
 *
 * The agent writes node/edge/layer/tour data as chunk files.
 * This command reads them, builds a complete valid envelope, validates, and writes.
 *
 * Usage: sprang merge [project-root]
 */
export function makeMergeCommand(): Command {
  const cmd = new Command('merge');
  cmd
    .description('Assemble intermediate chunk files into .sprang/knowledge-graph.json')
    .argument('[path]', 'Path to the project root', undefined)
    .option('--intermediate <dir>', 'Directory containing chunk files', 'intermediate')
    .action(async (pathArg: string | undefined, options: { intermediate: string }) => {
      const projectRoot = resolve(pathArg ?? process.cwd());
      const inter = resolve(projectRoot, options.intermediate);
      const outDir = join(projectRoot, '.sprang');
      const outPath = join(outDir, 'knowledge-graph.json');

      const spinner = ora('Merging intermediate chunk files...').start();

      try {
        if (!existsSync(inter)) {
          spinner.fail(`Intermediate directory not found: ${inter}`);
          process.exit(1);
        }

        // --- Load nodes from chunk files ---
        const chunkFiles = readdirSync(inter)
          .filter((f) => f.match(/^(final-)?nodes?-chunk[-_]?\d+\.json$/i) || f.match(/^batch-\d+[a-z]?\.json$/i))
          .sort()
          .map((f) => join(inter, f));

        const nodes: unknown[] = [];
        for (const f of chunkFiles) {
          try {
            const raw = JSON.parse(readFileSync(f, 'utf-8')) as unknown;
            const arr = toArray(raw);
            // batch files may have { nodes: [...], edges: [...] }
            if (arr.length > 0 && typeof arr[0] === 'object' && arr[0] !== null && 'nodes' in (arr[0] as object)) {
              for (const item of arr) {
                nodes.push(...toArray((item as { nodes: unknown }).nodes));
              }
            } else {
              nodes.push(...arr);
            }
          } catch {
            spinner.warn(`Skipping malformed chunk file: ${f}`);
          }
        }

        // Also check assembled-graph.json for nodes if no chunks found
        const assembledPath = join(inter, 'assembled-graph.json');
        const assembled = existsSync(assembledPath)
          ? (JSON.parse(readFileSync(assembledPath, 'utf-8')) as Record<string, unknown>)
          : {};

        if (nodes.length === 0 && assembled['nodes']) {
          nodes.push(...toArray(assembled['nodes']));
        }

        // --- Load edges ---
        const edgesPath = join(inter, 'final-edges.json');
        let edges: unknown[] = [];
        if (existsSync(edgesPath)) {
          edges = toArray(JSON.parse(readFileSync(edgesPath, 'utf-8')));
        } else if (assembled['edges']) {
          edges = toArray(assembled['edges']);
        }

        // Collect edges from batch files too (if they have { nodes, edges })
        for (const f of chunkFiles) {
          try {
            const raw = JSON.parse(readFileSync(f, 'utf-8')) as unknown;
            const arr = toArray(raw);
            if (arr.length > 0 && typeof arr[0] === 'object' && arr[0] !== null && 'edges' in (arr[0] as object)) {
              for (const item of arr) {
                edges.push(...toArray((item as { edges: unknown }).edges));
              }
            }
          } catch { /* skip */ }
        }
        // Deduplicate edges by source+target+type
        const edgeSet = new Map<string, unknown>();
        for (const e of edges) {
          const edge = e as Record<string, unknown>;
          const key = `${edge['source']}::${edge['target']}::${edge['type']}`;
          edgeSet.set(key, e);
        }
        edges = Array.from(edgeSet.values());

        // --- Load layers ---
        const layersPath = join(inter, 'final-layers.json');
        let layers: unknown[] = existsSync(layersPath)
          ? toArray(JSON.parse(readFileSync(layersPath, 'utf-8')))
          : toArray(assembled['layers']);
        // Normalise: if layers are strings, convert to layer objects
        if (layers.length > 0 && typeof layers[0] === 'string') {
          layers = (layers as string[]).map((name) => ({
            id: name.toLowerCase().replace(/\s+/g, '_'),
            name: name,
            node_ids: [],
          }));
        }
        // Normalise: ensure every layer has node_ids array
        layers = layers.map((l) => {
          const layer = l as Record<string, unknown>;
          if (!Array.isArray(layer['node_ids'])) layer['node_ids'] = [];
          return layer;
        });

        // --- Load tours (agent writes 'tour' or 'tours') ---
        const toursPath = join(inter, 'final-tours.json');
        const tourPath = join(inter, 'final-tour.json');
        let tours: unknown[] = [];
        if (existsSync(toursPath)) {
          tours = toArray(JSON.parse(readFileSync(toursPath, 'utf-8')));
        } else if (existsSync(tourPath)) {
          tours = toArray(JSON.parse(readFileSync(tourPath, 'utf-8')));
        } else if (assembled['tours']) {
          tours = toArray(assembled['tours']);
        } else if (assembled['tour']) {
          tours = toArray(assembled['tour']);
        }

        // --- Load domains ---
        const domainsPath = join(inter, 'final-domains.json');
        const domains: unknown[] = existsSync(domainsPath)
          ? toArray(JSON.parse(readFileSync(domainsPath, 'utf-8')))
          : toArray(assembled['domains']);

        // --- Get git hash ---
        let gitHash = '';
        try {
          gitHash = execSync('git rev-parse HEAD', { cwd: projectRoot, encoding: 'utf-8' }).trim();
        } catch { /* not a git repo */ }

        // --- Build risk summary from nodes ---
        const riskSummary = { high: 0, medium: 0, low: 0 };
        for (const n of nodes) {
          const node = n as Record<string, unknown>;
          const r = typeof node['risk_score'] === 'number' ? node['risk_score'] : 0;
          if (r >= 0.7) riskSummary.high++;
          else if (r >= 0.4) riskSummary.medium++;
          else riskSummary.low++;
        }

        const now = new Date().toISOString();

        // --- Assemble complete valid graph ---
        const graph = {
          version: '0.2.0',
          kind: 'codebase',
          generated_at: now,
          project_root: projectRoot,
          project_name: (assembled['project_name'] as string | undefined) ?? basename(projectRoot),
          description: (assembled['description'] as string | undefined) ?? '',
          languages: toArray(assembled['languages'] as unknown),
          frameworks: toArray(assembled['frameworks'] as unknown),
          phase: 'complete',
          stats: {
            node_count: nodes.length,
            edge_count: edges.length,
            risk_summary: riskSummary,
            smell_summary: (assembled['smell_summary'] as Record<string, unknown> | undefined) ?? {},
            generated_at: now,
            gitCommitHash: gitHash,
          },
          nodes,
          edges,
          layers,
          tours,
          domains,
          annotations: [],
          health: (assembled['health'] as Record<string, unknown> | undefined) ?? {},
        };

        // --- Validate minimum requirements ---
        if (nodes.length === 0) {
          spinner.fail('No nodes found in chunk files or assembled-graph.json. Cannot write empty graph.');
          process.exit(1);
        }

        // --- Write output ---
        mkdirSync(outDir, { recursive: true });
        writeFileSync(outPath, JSON.stringify(graph, null, 2), 'utf-8');

        spinner.succeed(
          `Graph written: ${nodes.length} nodes, ${edges.length} edges, ${layers.length} layers, ${tours.length} tours → ${outPath}`
        );
      } catch (err) {
        spinner.fail(`merge failed: ${String(err)}`);
        process.exit(1);
      }
    });

  return cmd;
}
