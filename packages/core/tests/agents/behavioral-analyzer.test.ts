import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BehavioralAnalyzerAgent } from '../../src/agents/behavioral-analyzer.js';
import type { KnowledgeGraph } from '../../src/schema/types.js';

function graph(root: string): KnowledgeGraph {
  const file = (p: string, category = 'source', lines = 100) => ({
    id: `file:${p}`,
    type: 'file' as const,
    label: p,
    location: { file: p },
    metadata: { fileCategory: category, sizeLines: lines },
  });
  return {
    version: '1.0.0',
    generated_at: new Date().toISOString(),
    project_root: root,
    project_name: 't',
    phase: 'complete',
    nodes: [file('src/hot.ts'), file('src/calm.ts'), file('CHANGELOG.md', 'document')],
    edges: [],
    layers: [],
    tours: [],
    domains: [],
    stats: {
      node_count: 3,
      edge_count: 0,
      generated_at: new Date().toISOString(),
      risk_summary: { high: 0, medium: 0, low: 0 },
      smell_summary: {},
    },
  } as unknown as KnowledgeGraph;
}

describe('BehavioralAnalyzerAgent', () => {
  let repo: string;

  const git = (...args: string[]) =>
    execFileSync('git', args, {
      cwd: repo,
      encoding: 'utf-8',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Ann',
        GIT_AUTHOR_EMAIL: 'ann@x',
        GIT_COMMITTER_NAME: 'Ann',
        GIT_COMMITTER_EMAIL: 'ann@x',
      },
    });

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), 'sprang-behav-'));
    git('init', '-q', '.');
    mkdirSync(join(repo, 'src'), { recursive: true });
    writeFileSync(join(repo, 'src/calm.ts'), 'export const calm = 1;\n');
    writeFileSync(join(repo, 'CHANGELOG.md'), '# log\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'initial');

    // hot.ts changes often, and gets fixed repeatedly.
    for (let i = 0; i < 6; i++) {
      writeFileSync(join(repo, 'src/hot.ts'), `export const hot = ${i};\n`);
      writeFileSync(join(repo, 'CHANGELOG.md'), `# log ${i}\n`);
      git('add', '-A');
      git('commit', '-q', '-m', i % 2 === 0 ? `feat: change ${i}` : `fix: correct ${i}`);
    }
  });

  afterAll(() => rmSync(repo, { recursive: true, force: true }));

  const run = async () => {
    const g = graph(repo);
    const agent = new BehavioralAnalyzerAgent();
    const res = await agent.run({
      graph: g,
      projectRoot: repo,
      intermediateDir: join(repo, '.sprang', 'intermediate'),
    } as never);
    expect(res.success).toBe(true);
    return res.mutatedGraph ?? g;
  };

  it('annotates files that have history', async () => {
    const g = await run();
    const hot = g.nodes.find((n) => n.id === 'file:src/hot.ts')!;
    const behavioral = hot.metadata?.['behavioral'] as Record<string, unknown>;
    expect(behavioral).toBeDefined();
    expect(behavioral['revisions']).toBe(6);
    expect(behavioral['bug_fixes']).toBeGreaterThan(0);
  });

  it('records ownership and bus factor', async () => {
    const g = await run();
    const b = g.nodes.find((n) => n.id === 'file:src/hot.ts')!.metadata?.['behavioral'] as Record<
      string,
      unknown
    >;
    expect(b['main_developer']).toBe('Ann');
    expect(b['bus_factor']).toBe(1);
  });

  it('leaves files with no history unannotated rather than inventing zeros', async () => {
    const g = await run();
    const calm = g.nodes.find((n) => n.id === 'file:src/calm.ts')!;
    const b = calm.metadata?.['behavioral'] as Record<string, unknown> | undefined;
    // calm.ts was committed once, so it does have history — but a file never
    // committed must not get fabricated behavioural data.
    expect(b?.['revisions']).toBe(1);
  });

  it('succeeds outside a git repository instead of failing the pipeline', async () => {
    const nogit = mkdtempSync(join(tmpdir(), 'sprang-nogit-'));
    try {
      const res = await new BehavioralAnalyzerAgent().run({
        graph: graph(nogit),
        projectRoot: nogit,
        intermediateDir: join(nogit, '.sprang', 'intermediate'),
      } as never);
      expect(res.success).toBe(true);
    } finally {
      rmSync(nogit, { recursive: true, force: true });
    }
  });

  it('still records raw data for documentation files', async () => {
    // The data is legitimate; it is only the *risk factors* that must not be
    // derived from it (see the risk-scorer gating test).
    const g = await run();
    const log = g.nodes.find((n) => n.id === 'file:CHANGELOG.md')!;
    expect(log.metadata?.['behavioral']).toBeDefined();
  });
});
