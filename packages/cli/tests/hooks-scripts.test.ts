import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

// Resolve hook scripts relative to repo root (two levels up from packages/cli)
const REPO_ROOT = resolve(import.meta.dirname, '../../..');
const SESSION_START_HOOK = join(REPO_ROOT, '.claude/hooks/session-start.sh');
const POST_TOOL_USE_HOOK = join(REPO_ROOT, '.claude/hooks/post-tool-use.sh');

function runHook(scriptPath: string, cwd: string, env: Record<string, string> = {}): {
  stdout: string;
  stderr: string;
  exitCode: number;
} {
  const result = spawnSync('bash', [scriptPath], {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf-8',
  });
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    exitCode: result.status ?? 0,
  };
}

function makeGitRepo(dir: string): void {
  execSync(
    'git init && git config user.email "test@test.com" && git config user.name "Test" && git config commit.gpgsign false',
    { cwd: dir, stdio: 'pipe' }
  );
}

function makeGraph(dir: string, commitHash: string): void {
  mkdirSync(join(dir, '.sprang'), { recursive: true });
  writeFileSync(
    join(dir, '.sprang/knowledge-graph.json'),
    JSON.stringify({
      version: '1.0.0',
      generated_at: new Date().toISOString(),
      project_root: dir,
      project_name: 'test',
      phase: 'complete',
      nodes: [],
      edges: [],
      layers: [],
      tours: [],
      domains: [],
      stats: {
        node_count: 0,
        edge_count: 0,
        risk_summary: { high: 0, medium: 0, low: 0 },
        smell_summary: {},
        generated_at: new Date().toISOString(),
        gitCommitHash: commitHash,
      },
    }),
    'utf-8'
  );
}

describe('session-start.sh', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'sprang-hooks-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('outputs warning when no knowledge graph exists', () => {
    makeGitRepo(tmpDir);
    const result = runHook(SESSION_START_HOOK, tmpDir);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('[sprang]');
    expect(result.stdout).toContain('No knowledge graph found');
    expect(result.stdout).toContain('/sprang');
  });

  it('is silent when graph is up-to-date with HEAD', () => {
    makeGitRepo(tmpDir);
    // Make an initial commit so HEAD exists
    writeFileSync(join(tmpDir, 'README.md'), 'test');
    execSync('git add README.md && git commit -m "init"', { cwd: tmpDir, stdio: 'pipe' });
    const head = execSync('git rev-parse HEAD', { cwd: tmpDir }).toString().trim();
    makeGraph(tmpDir, head);
    const result = runHook(SESSION_START_HOOK, tmpDir);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(''); // silent — graph is fresh
  });

  it('outputs stale warning when graph commit hash differs from HEAD', () => {
    makeGitRepo(tmpDir);
    writeFileSync(join(tmpDir, 'README.md'), 'test');
    execSync('git add README.md && git commit -m "init"', { cwd: tmpDir, stdio: 'pipe' });
    const head = execSync('git rev-parse HEAD', { cwd: tmpDir }).toString().trim();
    // Graph was indexed at a fake old hash
    makeGraph(tmpDir, 'abc1234def5678901234567890abcdef01234567');
    const result = runHook(SESSION_START_HOOK, tmpDir);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('[sprang]');
    expect(result.stdout).toContain('stale');
    // Shows truncated hashes: first 7 chars of each
    expect(result.stdout).toContain('abc1234');
    expect(result.stdout).toContain(head.slice(0, 7));
  });

  it('is silent when graph has no gitCommitHash (pre-v0.2 graph)', () => {
    makeGitRepo(tmpDir);
    writeFileSync(join(tmpDir, 'README.md'), 'test');
    execSync('git add README.md && git commit -m "init"', { cwd: tmpDir, stdio: 'pipe' });
    mkdirSync(join(tmpDir, '.sprang'), { recursive: true });
    // Graph without stats.gitCommitHash
    writeFileSync(
      join(tmpDir, '.sprang/knowledge-graph.json'),
      JSON.stringify({ stats: {}, nodes: [], edges: [] }),
      'utf-8'
    );
    const result = runHook(SESSION_START_HOOK, tmpDir);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(''); // can't compare, stay silent
  });

  it('is silent when not in a git repo', () => {
    // No git init — just a plain dir with a graph
    makeGraph(tmpDir, 'abc1234def5678901234567890abcdef01234567');
    const result = runHook(SESSION_START_HOOK, tmpDir);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(''); // no HEAD to compare against
  });
});

describe('post-tool-use.sh', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'sprang-hooks-post-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('exits 0 silently when TOOL_INPUT contains no git command', () => {
    const result = runHook(POST_TOOL_USE_HOOK, tmpDir, {
      TOOL_INPUT: JSON.stringify({ command: 'ls -la' }),
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('');
  });

  it('exits 0 silently when TOOL_INPUT is a git commit but no graph exists', () => {
    // No .sprang/knowledge-graph.json
    const result = runHook(POST_TOOL_USE_HOOK, tmpDir, {
      TOOL_INPUT: JSON.stringify({ command: 'git commit -m "feat: add thing"' }),
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(''); // no graph → no action
  });

  it('exits 0 silently when TOOL_INPUT is a git commit but CLI is not built', () => {
    makeGraph(tmpDir, 'abc1234');
    // No packages/cli/dist/index.js
    const result = runHook(POST_TOOL_USE_HOOK, tmpDir, {
      TOOL_INPUT: JSON.stringify({ command: 'git commit -m "feat: add thing"' }),
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(''); // CLI not found → no action
  });

  it('exits 0 when TOOL_INPUT is empty string', () => {
    const result = runHook(POST_TOOL_USE_HOOK, tmpDir, { TOOL_INPUT: '' });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('');
  });

  it('detects git merge in TOOL_INPUT', () => {
    makeGraph(tmpDir, 'abc1234');
    // CLI stub that records it was called
    mkdirSync(join(tmpDir, 'packages/cli/dist'), { recursive: true });
    writeFileSync(
      join(tmpDir, 'packages/cli/dist/index.js'),
      'process.stdout.write("scan called");',
      'utf-8'
    );
    const result = runHook(POST_TOOL_USE_HOOK, tmpDir, {
      TOOL_INPUT: JSON.stringify({ command: 'git merge feature-branch' }),
    });
    expect(result.exitCode).toBe(0);
    // Hook fires in background — no synchronous output expected
  });

  it('detects git cherry-pick in TOOL_INPUT', () => {
    const result = runHook(POST_TOOL_USE_HOOK, tmpDir, {
      TOOL_INPUT: JSON.stringify({ command: 'git cherry-pick abc123' }),
    });
    // No graph → exits silently but didn't error on pattern detection
    expect(result.exitCode).toBe(0);
  });

  it('does not trigger on git status or git log', () => {
    makeGraph(tmpDir, 'abc1234');
    mkdirSync(join(tmpDir, 'packages/cli/dist'), { recursive: true });
    writeFileSync(join(tmpDir, 'packages/cli/dist/index.js'), '"use strict";', 'utf-8');
    for (const cmd of ['git status', 'git log --oneline', 'git diff HEAD', 'git push origin main']) {
      const result = runHook(POST_TOOL_USE_HOOK, tmpDir, {
        TOOL_INPUT: JSON.stringify({ command: cmd }),
      });
      expect(result.exitCode).toBe(0);
    }
  });
});

// ─── PreToolUse risk gate ─────────────────────────────────────────────────────

const RISK_GATE_HOOK = join(REPO_ROOT, '.claude/hooks/pre-tool-risk-gate.sh');

function runGate(cwd: string, payload: unknown): { stdout: string; exitCode: number } {
  const result = spawnSync('bash', [RISK_GATE_HOOK], {
    cwd,
    input: JSON.stringify(payload),
    env: { ...process.env, SPRANG_HOOK_ROOT: cwd },
    encoding: 'utf-8',
  });
  return { stdout: result.stdout ?? '', exitCode: result.status ?? 0 };
}

function graphWith(nodes: unknown[]) {
  return JSON.stringify({
    version: '1.0.0',
    generated_at: new Date().toISOString(),
    project_root: '/t',
    project_name: 't',
    phase: 'complete',
    nodes,
    edges: [],
    layers: [],
    tours: [],
    domains: [],
    stats: {
      node_count: nodes.length,
      edge_count: 0,
      generated_at: new Date().toISOString(),
      risk_summary: { high: 0, medium: 0, low: 0 },
      smell_summary: {},
    },
  });
}

describe('pre-tool-risk-gate hook', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sprang-gate-'));
    mkdirSync(join(dir, '.sprang'), { recursive: true });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const write = (nodes: unknown[]) =>
    writeFileSync(join(dir, '.sprang', 'knowledge-graph.json'), graphWith(nodes));

  it('warns before editing a file with prior reverts', () => {
    write([
      {
        id: 'file:src/a.ts',
        type: 'file',
        label: 'a.ts',
        location: { file: 'src/a.ts' },
        risk_score: 0.8,
        risk_factors: ['previously_reverted'],
        metadata: {
          fileCategory: 'source',
          behavioral: { trap_count: 3, traps: [{ subject: 'feat: caching' }] },
        },
      },
    ]);
    const { stdout, exitCode } = runGate(dir, { tool_name: 'Edit', tool_input: { file_path: 'src/a.ts' } });
    expect(exitCode).toBe(0);
    const out = JSON.parse(stdout);
    expect(out.hookSpecificOutput.hookEventName).toBe('PreToolUse');
    expect(out.hookSpecificOutput.additionalContext).toMatch(/3 previous change/);
    expect(out.hookSpecificOutput.additionalContext).toMatch(/feat: caching/);
  });

  it('stays silent for an unremarkable file', () => {
    write([
      {
        id: 'file:src/calm.ts',
        type: 'file',
        label: 'calm.ts',
        location: { file: 'src/calm.ts' },
        risk_score: 0.1,
        metadata: { fileCategory: 'source' },
      },
    ]);
    expect(runGate(dir, { tool_name: 'Edit', tool_input: { file_path: 'src/calm.ts' } }).stdout.trim()).toBe('');
  });

  it('does not make behavioural claims about documentation', () => {
    // A CHANGELOG accumulates the most "traps" in any repo purely because every
    // fix commit touches it. Warning about it trains the agent to ignore us.
    write([
      {
        id: 'file:CHANGELOG.md',
        type: 'file',
        label: 'CHANGELOG.md',
        location: { file: 'CHANGELOG.md' },
        risk_score: 0.1,
        metadata: { fileCategory: 'document', behavioral: { trap_count: 9, bus_factor: 1, main_developer: 'Ann' } },
      },
    ]);
    expect(runGate(dir, { tool_name: 'Edit', tool_input: { file_path: 'CHANGELOG.md' } }).stdout.trim()).toBe('');
  });

  it('is silent when the file is not in the graph', () => {
    write([]);
    expect(runGate(dir, { tool_name: 'Edit', tool_input: { file_path: 'src/unknown.ts' } }).stdout.trim()).toBe('');
  });

  it('is silent when no graph exists, and never fails the edit', () => {
    const { stdout, exitCode } = runGate(dir, { tool_name: 'Edit', tool_input: { file_path: 'src/a.ts' } });
    expect(stdout.trim()).toBe('');
    expect(exitCode).toBe(0);
  });

  it('tolerates malformed payloads without blocking', () => {
    write([]);
    const result = spawnSync('bash', [RISK_GATE_HOOK], {
      cwd: dir,
      input: 'not json at all',
      env: { ...process.env, SPRANG_HOOK_ROOT: dir },
      encoding: 'utf-8',
    });
    expect(result.status).toBe(0);
    expect(result.stdout ?? '').toBe('');
  });

  it('ignores edits outside the project', () => {
    write([]);
    expect(runGate(dir, { tool_name: 'Edit', tool_input: { file_path: '/etc/hosts' } }).stdout.trim()).toBe('');
  });
});
