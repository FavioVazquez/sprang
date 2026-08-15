import { describe, it, expect } from 'vitest';
import { ArchitectureAnalyzerAgent } from '../../src/agents/architecture-analyzer.js';
import type { KnowledgeGraph } from '../../src/schema/types.js';

function graphOf(paths: string[]): KnowledgeGraph {
  return {
    version: '1.0.0',
    generated_at: new Date().toISOString(),
    project_root: '/t',
    project_name: 't',
    phase: 'complete',
    nodes: paths.map((p) => ({
      id: `file:${p}`,
      type: 'file',
      label: p.split('/').pop(),
      location: { file: p },
    })),
    edges: [],
    layers: [],
    tours: [],
    domains: [],
    stats: {
      node_count: paths.length,
      edge_count: 0,
      generated_at: new Date().toISOString(),
      risk_summary: { high: 0, medium: 0, low: 0 },
      smell_summary: {},
    },
  } as unknown as KnowledgeGraph;
}

async function layersFor(paths: string[]) {
  const res = await new ArchitectureAnalyzerAgent().run({
    graph: graphOf(paths),
    projectRoot: '/t',
    intermediateDir: '/tmp/sprang-arch-test',
  } as never);
  const layers = (res.mutatedGraph ?? graphOf(paths)).layers ?? [];
  const byPath = new Map<string, string>();
  for (const layer of layers) {
    for (const id of layer.node_ids) byPath.set(id.replace(/^file:/, ''), layer.name);
  }
  return { layers, byPath };
}

describe('layer classification', () => {
  it('matches path segments, not the whole path', async () => {
    // The bug this replaces: the domain pattern contained `core`, so every
    // file in a monorepo package called `core` became Domain. 183 of 405 files
    // on this repository landed in one bucket.
    const { byPath } = await layersFor([
      'packages/core/src/api/routes.ts',
      'packages/core/src/ui/button.tsx',
      'packages/core/src/db/client.ts',
    ]);
    expect(byPath.get('packages/core/src/api/routes.ts')).toBe('API');
    expect(byPath.get('packages/core/src/ui/button.tsx')).toBe('UI');
    expect(byPath.get('packages/core/src/db/client.ts')).toBe('Data');
  });

  it('prefers the segment nearest the file', async () => {
    // Specificity increases towards the filename: `api` is the intent,
    // `services` is where the package happens to live.
    const { byPath } = await layersFor(['services/billing/src/api/charge.ts']);
    expect(byPath.get('services/billing/src/api/charge.ts')).toBe('API');
  });

  it('anchors patterns so short names do not match inside words', async () => {
    const { byPath } = await layersFor(['src/build/rapid/thing.ts']);
    // `build` must not match `ui`, `rapid` must not match `api`.
    expect(byPath.get('src/build/rapid/thing.ts')).not.toBe('UI');
    expect(byPath.get('src/build/rapid/thing.ts')).not.toBe('API');
  });

  it('classifies documentation instead of leaving it unassigned', async () => {
    const { byPath } = await layersFor(['README.md', 'LICENSE', 'docs/guide.md']);
    expect(byPath.get('README.md')).toBe('Documentation');
    expect(byPath.get('docs/guide.md')).toBe('Documentation');
  });

  it('classifies tests ahead of whatever they are testing', async () => {
    const { byPath } = await layersFor([
      'packages/core/tests/api/routes.test.ts',
      'src/components/__tests__/button.spec.tsx',
    ]);
    expect(byPath.get('packages/core/tests/api/routes.test.ts')).toBe('Tests');
    expect(byPath.get('src/components/__tests__/button.spec.tsx')).toBe('Tests');
  });

  it('derives a layer from a sizeable directory the conventions do not name', async () => {
    // `behavioral` is meaningful in this codebase and meaningless as a
    // universal rule. Naming the layer after the directory beats forcing it
    // into Domain.
    const { byPath } = await layersFor([
      'src/behavioral/history.ts',
      'src/behavioral/analysis.ts',
      'src/behavioral/traps.ts',
    ]);
    expect(byPath.get('src/behavioral/history.ts')).toBe('Behavioral');
  });

  it('pools tiny directory groups into Other rather than making a layer of one', async () => {
    const { byPath, layers } = await layersFor(['src/zzz/only.ts', 'src/qqq/lonely.ts']);
    expect(byPath.get('src/zzz/only.ts')).toBe('Other');
    expect(layers.some((l) => l.name === 'Zzz')).toBe(false);
  });

  it('leaves nothing unassigned', async () => {
    const paths = [
      'README.md', '.gitignore', 'install.sh', 'src/index.ts',
      'src/api/routes.ts', 'src/behavioral/a.ts', 'src/behavioral/b.ts', 'src/behavioral/c.ts',
    ];
    const { layers } = await layersFor(paths);
    const assigned = new Set(layers.flatMap((l) => l.node_ids));
    expect(assigned.size).toBe(paths.length);
  });

  it('produces no empty layers', async () => {
    const { layers } = await layersFor(['src/api/a.ts']);
    expect(layers.every((l) => l.node_ids.length > 0)).toBe(true);
  });

  it('is deterministic', async () => {
    const paths = ['src/api/a.ts', 'src/ui/b.tsx', 'src/weird/c.ts', 'src/weird/d.ts', 'src/weird/e.ts'];
    const a = await layersFor(paths);
    const b = await layersFor(paths);
    expect(JSON.stringify(a.layers)).toBe(JSON.stringify(b.layers));
  });

  it('handles an empty graph', async () => {
    const { layers } = await layersFor([]);
    expect(layers).toEqual([]);
  });
});
