import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const CLI = join(import.meta.dirname, '../../dist/index.js');
const created: string[] = [];

function project(): string {
  const d = mkdtempSync(join(tmpdir(), 'sprang-init-test-'));
  created.push(d);
  return d;
}
function init(root: string, args: string[] = []): { status: number; stdout: string; stderr: string } {
  const r = spawnSync('node', [CLI, 'init', root, '-y', ...args], { encoding: 'utf-8' });
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

afterEach(() => {
  for (const d of created.splice(0)) { try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ } }
});

describe('sprang init', () => {
  it('writes .mcp.json with an absolute server path and no scaffold by default', () => {
    const root = project();
    expect(init(root).status).toBe(0);
    expect(existsSync(join(root, '.mcp.json'))).toBe(true);
    const cfg = JSON.parse(readFileSync(join(root, '.mcp.json'), 'utf-8'));
    expect(cfg.mcpServers.sprang.args[0]).toMatch(/^\/.+(mcp-server\.cjs|server\.cjs)$/);
    expect(cfg.mcpServers.sprang.env.SPRANG_ROOT).toBe('.');
    // No agent files scaffolded without --platform
    expect(existsSync(join(root, '.claude'))).toBe(false);
  });

  it('--platform claude scaffolds commands, rules, skills (with merge.py) and CLAUDE.md', () => {
    const root = project();
    expect(init(root, ['--platform', 'claude']).status).toBe(0);
    expect(readdirSync(join(root, '.claude', 'commands')).length).toBe(11);
    expect(readdirSync(join(root, '.claude', 'rules')).length).toBeGreaterThanOrEqual(3);
    expect(existsSync(join(root, 'CLAUDE.md'))).toBe(true);
    expect(existsSync(join(root, 'skills', 'sprang-analyze', 'scripts', 'merge.py'))).toBe(true);
    // dev-only worktrees must never be copied
    expect(existsSync(join(root, '.claude', 'worktrees'))).toBe(false);
  });

  it('--platform windsurf writes .devin/config.json with ${workspaceFolder} and copies workflows', () => {
    const root = project();
    expect(init(root, ['--platform', 'windsurf']).status).toBe(0);
    const cfg = JSON.parse(readFileSync(join(root, '.devin', 'config.json'), 'utf-8'));
    expect(cfg.mcpServers.sprang.env.SPRANG_ROOT).toBe('${workspaceFolder}');
    expect(readdirSync(join(root, '.windsurf', 'workflows')).length).toBe(11);
  });

  it('--platform copilot writes .vscode/mcp.json and copies copilot-instructions.md', () => {
    const root = project();
    expect(init(root, ['--platform', 'copilot']).status).toBe(0);
    expect(existsSync(join(root, '.vscode', 'mcp.json'))).toBe(true);
    expect(existsSync(join(root, '.github', 'copilot-instructions.md'))).toBe(true);
  });

  it('rejects an unknown platform', () => {
    const root = project();
    const r = init(root, ['--platform', 'emacs']);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/must be one of/i);
  });
});
