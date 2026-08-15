import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

// vitest runs with the package as cwd, not the repo root.
const REPO_ROOT = resolve(import.meta.dirname, '../../../..');
const CLI = join(REPO_ROOT, 'packages/cli/dist/index.js');

/**
 * Call edges now record how they were established.
 *
 * A call resolved within one file is a fact; a call matched to the only
 * exported symbol of that name in an imported file is a good inference; a call
 * matched to one of several same-named candidates is a guess. Blast radius is
 * what people make decisions with, so a guess must not look like a fact.
 */
describe('call edge resolution', () => {
  let repo: string;

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'sprang-calls-'));
    mkdirSync(join(repo, 'src'), { recursive: true });
    execFileSync('git', ['init', '-q', '.'], { cwd: repo });
  });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  const scan = () => {
    execFileSync('node', [CLI, 'scan'], { cwd: repo, stdio: 'ignore' });
    return JSON.parse(
      readFileSync(join(repo, '.sprang', 'knowledge-graph.json'), 'utf-8'),
    ) as { edges: Array<{ type: string; source: string; target: string; resolution?: string; confidence?: number }> };
  };

  it('marks a same-file call as a fact', () => {
    writeFileSync(
      join(repo, 'src/a.ts'),
      'export function helper() { return 1; }\nexport function main() { return helper(); }\n',
    );
    const graph = scan();
    const edge = graph.edges.find((e) => e.type === 'calls' && e.target.endsWith(':helper'));
    expect(edge?.resolution).toBe('same-file');
    expect(edge?.confidence).toBe(1);
  });

  it('marks a unique cross-file call as an inference, not a fact', () => {
    writeFileSync(join(repo, 'src/lib.ts'), 'export function uniqueName() { return 1; }\n');
    writeFileSync(
      join(repo, 'src/app.ts'),
      "import { uniqueName } from './lib.js';\nexport function go() { return uniqueName(); }\n",
    );
    const graph = scan();
    const edge = graph.edges.find((e) => e.type === 'calls' && e.target.endsWith(':uniqueName'));
    expect(edge?.resolution).toBe('imported-unique');
    expect(edge?.confidence).toBeLessThan(1);
    expect(edge?.confidence).toBeGreaterThan(0.5);
  });

  it('marks an ambiguous call as a guess and lowers confidence accordingly', () => {
    // Two imported files export the same name; picking one is a coin toss.
    writeFileSync(join(repo, 'src/one.ts'), 'export function shared() { return 1; }\n');
    writeFileSync(join(repo, 'src/two.ts'), 'export function shared() { return 2; }\n');
    writeFileSync(
      join(repo, 'src/app.ts'),
      "import { shared } from './one.js';\nimport { shared as s2 } from './two.js';\nexport function go() { return shared(); }\n",
    );
    const graph = scan();
    const edge = graph.edges.find((e) => e.type === 'calls' && e.target.endsWith(':shared'));
    expect(edge?.resolution).toBe('imported-ambiguous');
    expect(edge?.confidence).toBeLessThanOrEqual(0.5);
  });

  it('every calls edge carries a resolution', () => {
    writeFileSync(join(repo, 'src/lib.ts'), 'export function a() { return 1; }\n');
    writeFileSync(
      join(repo, 'src/app.ts'),
      "import { a } from './lib.js';\nexport function b() { return a(); }\nexport function c() { return b(); }\n",
    );
    const graph = scan();
    const calls = graph.edges.filter((e) => e.type === 'calls');
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((e) => typeof e.resolution === 'string')).toBe(true);
    expect(calls.every((e) => typeof e.confidence === 'number')).toBe(true);
  });
});
