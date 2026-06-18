import { resolve, dirname, join, relative } from 'node:path';
import { existsSync, readFileSync, writeFileSync, renameSync, realpathSync, mkdirSync, cpSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { Command } from 'commander';
import { fileURLToPath } from 'node:url';

const CYAN  = '\x1b[36m';
const GREEN = '\x1b[32m';
const DIM   = '\x1b[2m';
const RESET = '\x1b[0m';

type Platform = 'claude' | 'copilot' | 'windsurf' | 'all';
const PLATFORMS: Platform[] = ['claude', 'copilot', 'windsurf', 'all'];

function findMcpServerPath(): string {
  const cliDist = dirname(fileURLToPath(import.meta.url));

  // npm package layout: dist/mcp-server.cjs (sibling of dist/index.js)
  const npmMcp = join(cliDist, 'mcp-server.cjs');
  if (existsSync(npmMcp)) return realpathSync(npmMcp);

  // Monorepo layout: walk up looking for packages/mcp/dist/server.cjs
  let dir = cliDist;
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, 'packages', 'mcp', 'dist', 'server.cjs');
    if (existsSync(candidate)) return realpathSync(candidate);
    const parent = resolve(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  // Fall back to the npm layout path even if it doesn't exist yet
  return npmMcp;
}

/**
 * Locate the bundled per-platform agent-integration files (slash commands,
 * rules, workflows, skills, CLAUDE.md/AGENTS.md, merge.py). In a published
 * package these sit in dist/agent-assets/; in the monorepo they're at the repo
 * root. Returns the directory that contains `.claude/`, or null if not found.
 */
function findAssetsRoot(): string | null {
  const cliDist = dirname(fileURLToPath(import.meta.url));
  const bundled = join(cliDist, 'agent-assets');
  if (existsSync(join(bundled, '.claude'))) return bundled;

  let dir = cliDist;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, '.claude', 'commands')) && existsSync(join(dir, 'AGENTS.md'))) return dir;
    const parent = resolve(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

// Top-level entries to scaffold per platform.
const PLATFORM_FILES: Record<Exclude<Platform, 'all'>, string[]> = {
  claude:   ['.claude', 'CLAUDE.md', 'AGENTS.md', 'skills'],
  windsurf: ['.windsurf', '.devin', 'AGENTS.md', 'skills'],
  copilot:  ['.github', 'AGENTS.md', 'skills'],
};

// Never copy dev-only artifacts even if present in a monorepo source tree.
const COPY_EXCLUDE = new Set(['worktrees', 'node_modules', '.git', 'cache', 'dist']);
const copyFilter = (src: string) => !COPY_EXCLUDE.has(src.split(/[\\/]/).pop() ?? '');

function expandPlatforms(p: Platform): Array<Exclude<Platform, 'all'>> {
  return p === 'all' ? ['claude', 'windsurf', 'copilot'] : [p];
}

/** Copy the agent files for the given platform(s); returns the copied entries. */
function scaffold(assetsRoot: string, projectRoot: string, platform: Platform): string[] {
  const entries = new Set<string>();
  for (const p of expandPlatforms(platform)) for (const e of PLATFORM_FILES[p]) entries.add(e);
  const copied: string[] = [];
  for (const entry of entries) {
    const src = join(assetsRoot, entry);
    if (!existsSync(src)) continue;
    cpSync(src, join(projectRoot, entry), { recursive: true, filter: copyFilter });
    copied.push(entry);
  }
  return copied;
}

function readJsonOrEmpty(file: string): Record<string, unknown> {
  if (existsSync(file)) {
    try { return JSON.parse(readFileSync(file, 'utf-8')) as Record<string, unknown>; } catch { /* start fresh */ }
  }
  return {};
}
function mergeMcp(existing: Record<string, unknown>, serverPath: string, sprangRoot: string): Record<string, unknown> {
  return {
    ...existing,
    mcpServers: {
      ...(existing['mcpServers'] as Record<string, unknown> ?? {}),
      sprang: { command: 'node', args: [serverPath], env: { SPRANG_ROOT: sprangRoot } },
    },
  };
}
function atomicWrite(file: string, content: string): void {
  const tmp = file + '.tmp';
  writeFileSync(tmp, content, 'utf-8');
  renameSync(tmp, file);
}

/** Write the MCP server config in the location each platform reads. */
function writeMcpConfig(projectRoot: string, serverPath: string, platform: Exclude<Platform, 'all'>): string {
  if (platform === 'windsurf') {
    // Devin Desktop resolves ${workspaceFolder}; config lives in .devin/config.json.
    const dir = join(projectRoot, '.devin');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'config.json');
    atomicWrite(file, JSON.stringify(mergeMcp(readJsonOrEmpty(file), serverPath, '${workspaceFolder}'), null, 2) + '\n');
    return relative(projectRoot, file);
  }
  if (platform === 'copilot') {
    const dir = join(projectRoot, '.vscode');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'mcp.json');
    atomicWrite(file, JSON.stringify(mergeMcp(readJsonOrEmpty(file), serverPath, projectRoot), null, 2) + '\n');
    return relative(projectRoot, file);
  }
  // claude → project-root .mcp.json
  const file = join(projectRoot, '.mcp.json');
  atomicWrite(file, JSON.stringify(mergeMcp(readJsonOrEmpty(file), serverPath, '.'), null, 2) + '\n');
  return relative(projectRoot, file);
}

export function makeInitCommand(): Command {
  const cmd = new Command('init');
  cmd
    .description('Set up Sprang in a project: MCP config + (optionally) the slash commands/rules/skills for your agent')
    .argument('[path]', 'Target project root (defaults to current directory)')
    .option('-y, --yes', 'Skip interactive prompt')
    .option('-p, --platform <platform>', 'Scaffold agent files for: claude | copilot | windsurf | all')
    .action(async (pathArg: string | undefined, options: { yes?: boolean; platform?: string }) => {
      process.stdout.write(`\n${CYAN}Sprang${RESET} — Knowledge Graph Dashboard\n\n`);

      let projectRoot = resolve(pathArg ?? process.cwd());
      if (!pathArg && !options.yes) {
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        projectRoot = await new Promise<string>((res) => {
          rl.question(`  ${DIM}Project root${RESET} [${process.cwd()}]: `, (ans) => {
            rl.close();
            res(ans.trim() || process.cwd());
          });
        });
        projectRoot = resolve(projectRoot);
      }
      if (!existsSync(projectRoot)) {
        process.stderr.write(`Error: Path not found: ${projectRoot}\n`);
        process.exit(1);
      }

      const platform = (options.platform ?? '').toLowerCase() as Platform;
      if (options.platform && !PLATFORMS.includes(platform)) {
        process.stderr.write(`Error: --platform must be one of ${PLATFORMS.join(', ')}\n`);
        process.exit(1);
      }

      const mcpServerPath = findMcpServerPath();

      // Write MCP config(s). With no --platform, default to Claude Code's .mcp.json.
      const configPlatforms: Array<Exclude<Platform, 'all'>> = options.platform ? expandPlatforms(platform) : ['claude'];
      for (const p of configPlatforms) {
        process.stdout.write(`  ${GREEN}✓${RESET} Wrote ${writeMcpConfig(projectRoot, mcpServerPath, p)}\n`);
      }

      // Scaffold agent files when a platform was requested.
      if (options.platform) {
        const assetsRoot = findAssetsRoot();
        if (!assetsRoot) {
          process.stderr.write(`  ${DIM}Could not locate bundled agent files — skipping scaffold. Reinstall the package or clone the repo.${RESET}\n`);
        } else {
          const copied = scaffold(assetsRoot, projectRoot, platform);
          if (copied.length) process.stdout.write(`  ${GREEN}✓${RESET} Scaffolded ${platform} files: ${copied.join(', ')}\n`);
        }
      }

      process.stdout.write(`\n  MCP server: ${DIM}${mcpServerPath}${RESET}\n`);
      const hint = options.platform
        ? ''
        : `\n  ${DIM}Tip: also scaffold the slash commands & rules for your agent with${RESET}\n    ${CYAN}sprang init --platform claude${RESET}  ${DIM}(or copilot | windsurf | all)${RESET}\n`;
      process.stdout.write(`${hint}
  ${GREEN}Done!${RESET} Next steps:

    ${CYAN}sprang scan${RESET} [path]   — build knowledge graph
    ${CYAN}sprang open${RESET} [path]   — open dashboard

  In your AI assistant: ${DIM}sprang_health(), sprang_query("...")${RESET}
\n`);
    });

  return cmd;
}
