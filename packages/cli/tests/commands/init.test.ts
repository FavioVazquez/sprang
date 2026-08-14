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
  it('defaults to the Devin layout and scaffolds nothing without --platform', () => {
    const root = project();
    expect(init(root).status).toBe(0);
    const cfg = JSON.parse(readFileSync(join(root, '.devin', 'mcp_config.json'), 'utf-8'));
    expect(cfg.mcpServers.sprang.args[0]).toMatch(/^\/.+(mcp-server\.cjs|server\.cjs)$/);
    expect(cfg.mcpServers.sprang.env.SPRANG_ROOT).toBe('${workspaceFolder}');
    // No agent files scaffolded without --platform
    expect(existsSync(join(root, '.devin', 'skills'))).toBe(false);
    expect(existsSync(join(root, '.claude'))).toBe(false);
  });

  it('--platform devin scaffolds skills, rules and hooks into .devin/', () => {
    const root = project();
    expect(init(root, ['--platform', 'devin']).status).toBe(0);
    expect(readdirSync(join(root, '.devin', 'skills')).length).toBe(11);
    expect(readdirSync(join(root, '.devin', 'rules')).length).toBe(3);
    expect(existsSync(join(root, '.devin', 'hooks.v1.json'))).toBe(true);
    expect(existsSync(join(root, '.devin', 'hooks', 'session-start.sh'))).toBe(true);
    expect(existsSync(join(root, 'AGENTS.md'))).toBe(true);
    expect(existsSync(join(root, '.devin', 'skills', 'sprang-analyze', 'scripts', 'merge.py'))).toBe(true);
    // Installing only one tree keeps the slash command as plain `/sprang`
    // instead of the disambiguated `/devin:sprang` / `/claude:sprang`.
    expect(existsSync(join(root, '.claude'))).toBe(false);
  });

  it('--platform claude scaffolds skills, rules, settings and CLAUDE.md', () => {
    const root = project();
    expect(init(root, ['--platform', 'claude']).status).toBe(0);
    expect(readdirSync(join(root, '.claude', 'skills')).length).toBe(11);
    expect(readdirSync(join(root, '.claude', 'rules')).length).toBe(3);
    expect(existsSync(join(root, '.claude', 'settings.json'))).toBe(true);
    expect(existsSync(join(root, 'CLAUDE.md'))).toBe(true);
    expect(existsSync(join(root, '.claude', 'skills', 'sprang-analyze', 'scripts', 'merge.py'))).toBe(true);
    // Claude merged slash commands into skills; .claude/commands must not return
    expect(existsSync(join(root, '.claude', 'commands'))).toBe(false);
    // dev-only worktrees must never be copied
    expect(existsSync(join(root, '.claude', 'worktrees'))).toBe(false);
  });

  it('--platform copilot writes both MCP locations and copies the instructions', () => {
    const root = project();
    expect(init(root, ['--platform', 'copilot']).status).toBe(0);
    // .vscode/mcp.json for the VS Code extension, .mcp.json for the CLI
    expect(existsSync(join(root, '.vscode', 'mcp.json'))).toBe(true);
    expect(existsSync(join(root, '.mcp.json'))).toBe(true);
    expect(existsSync(join(root, '.github', 'copilot-instructions.md'))).toBe(true);
    expect(readdirSync(join(root, 'skills')).length).toBe(11);
    // Copying `.github` wholesale used to drop Sprang's own ci.yml/publish.yml
    // into the user's repository.
    expect(existsSync(join(root, '.github', 'workflows'))).toBe(false);
  });

  it('rejects an unknown platform', () => {
    const root = project();
    const r = init(root, ['--platform', 'emacs']);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/must be one of/i);
  });
});
