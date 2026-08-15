import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StructureAnalyzerAgent } from '../../src/agents/structure-analyzer.js';
import type { KnowledgeGraph } from '../../src/schema/types.js';

function graph(files: string[], edges: Array<[string, string]> = []): KnowledgeGraph {
  return {
    version: '1.0.0',
    generated_at: new Date().toISOString(),
    project_root: '/t',
    project_name: 't',
    phase: 'complete',
    nodes: files.map((f) => ({
      id: `file:${f}`,
      type: 'file',
      label: f.split('/').pop(),
      location: { file: f },
      metadata: { fileCategory: 'source', sizeLines: 20 },
    })),
    edges: edges.map(([a, b]) => ({ source: `file:${a}`, target: `file:${b}`, type: 'imports' })),
    layers: [],
    tours: [],
    domains: [],
    stats: {
      node_count: files.length,
      edge_count: edges.length,
      generated_at: new Date().toISOString(),
      risk_summary: { high: 0, medium: 0, low: 0 },
      smell_summary: {},
    },
  } as unknown as KnowledgeGraph;
}

describe('StructureAnalyzerAgent', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'sprang-structure-'));
    mkdirSync(join(root, 'src'), { recursive: true });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const run = async (g: KnowledgeGraph) => {
    const agent = new StructureAnalyzerAgent();
    const res = await agent.run({
      graph: g,
      projectRoot: root,
      intermediateDir: join(root, '.sprang', 'intermediate'),
    } as never);
    expect(res.success).toBe(true);
    const out = join(root, '.sprang', 'intermediate', 'structure.json');
    return {
      graph: res.mutatedGraph ?? g,
      report: existsSync(out) ? JSON.parse(readFileSync(out, 'utf-8')) : null,
    };
  };

  it('writes a structure report', async () => {
    writeFileSync(join(root, 'src/a.ts'), 'export const a = 1;\n');
    const { report } = await run(graph(['src/a.ts']));
    expect(report).not.toBeNull();
    expect(report.communities).toBeDefined();
  });

  it('labels each node with its community', async () => {
    writeFileSync(join(root, 'src/a.ts'), 'export const a = 1;\n');
    writeFileSync(join(root, 'src/b.ts'), 'export const b = 2;\n');
    const { graph: g } = await run(graph(['src/a.ts', 'src/b.ts'], [['src/a.ts', 'src/b.ts']]));
    const a = g.nodes.find((n) => n.id === 'file:src/a.ts');
    expect(a?.metadata?.['community']).toBeTruthy();
  });

  it('records env vars a file reads, and which are undeclared', async () => {
    writeFileSync(join(root, 'src/a.ts'), 'const k = process.env.MY_SECRET_KEY;\n');
    const { graph: g } = await run(graph(['src/a.ts']));
    const a = g.nodes.find((n) => n.id === 'file:src/a.ts');
    expect(a?.metadata?.['env_vars']).toContain('MY_SECRET_KEY');
    expect(a?.metadata?.['env_vars_undeclared']).toContain('MY_SECRET_KEY');
  });

  it('does not mark a runtime-provided variable as undeclared', async () => {
    writeFileSync(join(root, 'src/a.ts'), 'const e = process.env.NODE_ENV;\n');
    const { graph: g } = await run(graph(['src/a.ts']));
    const a = g.nodes.find((n) => n.id === 'file:src/a.ts');
    expect(a?.metadata?.['env_vars_undeclared'] ?? []).not.toContain('NODE_ENV');
  });

  it('records published and subscribed topics', async () => {
    writeFileSync(join(root, 'src/pub.ts'), "emitter.emit('order.created', x);\n");
    writeFileSync(join(root, 'src/sub.ts'), "emitter.on('order.created', handle);\n");
    const { graph: g } = await run(graph(['src/pub.ts', 'src/sub.ts']));
    const pub = g.nodes.find((n) => n.id === 'file:src/pub.ts');
    const sub = g.nodes.find((n) => n.id === 'file:src/sub.ts');
    expect(pub?.metadata?.['publishes']).toContain('order.created');
    expect(sub?.metadata?.['subscribes']).toContain('order.created');
  });

  it('reports cycles with a suggested cut', async () => {
    writeFileSync(join(root, 'src/a.ts'), "import './b';\n");
    writeFileSync(join(root, 'src/b.ts'), "import './a';\n");
    const { report } = await run(
      graph(['src/a.ts', 'src/b.ts'], [['src/a.ts', 'src/b.ts'], ['src/b.ts', 'src/a.ts']]),
    );
    expect(report.cycles.length).toBeGreaterThan(0);
  });

  it('survives a file listed in the graph but missing from disk', async () => {
    // Normal mid-refactor state; must not end the analysis.
    const { report } = await run(graph(['src/gone.ts']));
    expect(report).not.toBeNull();
  });

  it('succeeds on an empty graph', async () => {
    const { report } = await run(graph([]));
    expect(report.cycles).toEqual([]);
  });

  it('ignores non-source files when reading sources', async () => {
    const g = graph(['README.md']);
    const node = g.nodes[0];
    if (node) node.metadata = { fileCategory: 'document' };
    writeFileSync(join(root, 'README.md'), 'process.env.NOT_REALLY_A_READ\n');
    const { graph: out } = await run(g);
    expect(out.nodes[0]?.metadata?.['env_vars']).toBeUndefined();
  });
});
