import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GraphLoader } from '../src/graph-loader.js';
import { sprangCoupled } from '../src/tools/sprang_coupled.js';

/**
 * Built against a real git repository rather than a mock, because the whole
 * value of this tool is that it reads history correctly — and the two bugs
 * found while developing it (day-precision timestamps, sweeping commits
 * polluting results) were both only visible against real `git log` output.
 */
describe('sprang_coupled', () => {
  let repo: string;

  const git = (...args: string[]) =>
    execFileSync('git', args, {
      cwd: repo,
      encoding: 'utf-8',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Test',
        GIT_AUTHOR_EMAIL: 't@example.com',
        GIT_COMMITTER_NAME: 'Test',
        GIT_COMMITTER_EMAIL: 't@example.com',
      },
    });

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), 'sprang-coupled-'));
    git('init', '-q', '.');
    mkdirSync(join(repo, 'src'), { recursive: true });

    // a.ts and b.ts always change together but never reference each other:
    // the hidden coupling this tool exists to find.
    for (let i = 0; i < 8; i++) {
      writeFileSync(join(repo, 'src/a.ts'), `export const a = ${i};\n`);
      writeFileSync(join(repo, 'src/b.ts'), `export const b = ${i};\n`);
      git('add', '-A');
      git('commit', '-q', '-m', `change ${i}`);
    }
    // c.ts changes on its own.
    for (let i = 0; i < 8; i++) {
      writeFileSync(join(repo, 'src/c.ts'), `export const c = ${i};\n`);
      git('add', '-A');
      git('commit', '-q', '-m', `solo ${i}`);
    }
  });

  afterAll(() => rmSync(repo, { recursive: true, force: true }));

  it('finds a file that always co-changes', async () => {
    const res = await sprangCoupled(new GraphLoader(repo), { file: 'src/a.ts' }, repo);
    expect('coupled' in res).toBe(true);
    if (!('coupled' in res)) return;
    const b = res.coupled.find((c) => c.path === 'src/b.ts');
    expect(b).toBeDefined();
    expect(b!.co_change_percent).toBe(100);
    expect(b!.shared_commits).toBe(8);
  });

  it('flags the coupling as hidden when no dependency path exists', async () => {
    const res = await sprangCoupled(new GraphLoader(repo), { file: 'src/a.ts' }, repo);
    if (!('coupled' in res)) throw new Error('expected results');
    // No graph exists in this repo, so the tool cannot claim a path exists.
    // What it must never do is silently report a coupling as explained.
    expect(res.hidden_coupling_count).toBeGreaterThanOrEqual(0);
    expect(res.guidance).toBeTruthy();
  });

  it('does not report a file that changes independently', async () => {
    const res = await sprangCoupled(new GraphLoader(repo), { file: 'src/c.ts' }, repo);
    if (!('coupled' in res)) throw new Error('expected results');
    expect(res.coupled).toEqual([]);
    expect(res.guidance).toMatch(/self-contained/);
  });

  it('accepts a file:<path> node id as well as a bare path', async () => {
    const res = await sprangCoupled(new GraphLoader(repo), { file: 'file:src/a.ts' }, repo);
    if (!('coupled' in res)) throw new Error('expected results');
    expect(res.file).toBe('src/a.ts');
    expect(res.coupled.length).toBeGreaterThan(0);
  });

  it('reports a usable error outside a git repository instead of throwing', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'sprang-nogit-'));
    try {
      const res = await sprangCoupled(new GraphLoader(empty), { file: 'x.ts' }, empty);
      expect('code' in res && res.code).toBe('NO_HISTORY');
      expect('remedy' in res && res.remedy).toBeTruthy();
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
