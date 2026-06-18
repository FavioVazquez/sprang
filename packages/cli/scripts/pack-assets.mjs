#!/usr/bin/env node
/**
 * Copies the compiled dashboard SPA and MCP server into packages/cli/dist/
 * so they are included in the npm tarball.
 *
 * Run this from packages/cli/ OR the monorepo root before npm pack / npm publish.
 * The publish.yml CI workflow calls this automatically.
 *
 * Output layout inside packages/cli/dist/:
 *   dashboard/          — React SPA static files (served by dashboard-server.js)
 *   dashboard-server.js — standalone HTTP server (serves above)
 *   mcp-server.cjs      — MCP server CJS bundle (used in .mcp.json)
 */

import { cpSync, copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT  = resolve(__dirname, '..');
const MONO_ROOT = resolve(CLI_ROOT, '../..');

const cliDist      = join(CLI_ROOT, 'dist');
const dashDist     = join(MONO_ROOT, 'packages', 'dashboard', 'dist');
const mcpServer    = join(MONO_ROOT, 'packages', 'mcp', 'dist', 'server.cjs');
const standaloneJs = join(dashDist, 'standalone.js');

// Verify sources exist
const missing = [dashDist, mcpServer, standaloneJs].filter(p => !existsSync(p));
if (missing.length > 0) {
  process.stderr.write(`pack-assets: missing build artifacts:\n${missing.map(p => '  ' + p).join('\n')}\n`);
  process.stderr.write('Run: pnpm build && pnpm --filter @sprang/dashboard build\n');
  process.exit(1);
}

// Copy dashboard SPA into dist/dashboard/
const dashTarget = join(cliDist, 'dashboard');
mkdirSync(dashTarget, { recursive: true });
cpSync(dashDist, dashTarget, { recursive: true });
process.stdout.write(`Copied dashboard SPA → dist/dashboard/ (${existsSync(join(dashTarget, 'index.html')) ? 'index.html present' : 'WARNING: no index.html'})\n`);

// Copy standalone server as dist/dashboard-server.js
const serverTarget = join(cliDist, 'dashboard-server.js');
copyFileSync(standaloneJs, serverTarget);
process.stdout.write(`Copied standalone server → dist/dashboard-server.js\n`);

// Copy MCP server (CJS standalone bundle — works without Vite or pnpm workspace)
// Remove stale .js version from any previous build runs before copying the .cjs.
const staleJs = join(cliDist, 'mcp-server.js');
if (existsSync(staleJs)) rmSync(staleJs);
const staleJsMap = join(cliDist, 'mcp-server.js.map');
if (existsSync(staleJsMap)) rmSync(staleJsMap);
const mcpTarget = join(cliDist, 'mcp-server.cjs');
copyFileSync(mcpServer, mcpTarget);
process.stdout.write(`Copied MCP server → dist/mcp-server.cjs\n`);

// Copy LICENSE and README from the monorepo root so the published package
// includes them (the cli package.json `files` whitelist references both, but
// they live at the repo root as the single source of truth).
for (const name of ['LICENSE', 'README.md']) {
  const src = join(MONO_ROOT, name);
  if (existsSync(src)) {
    copyFileSync(src, join(CLI_ROOT, name));
    process.stdout.write(`Copied ${name} → packages/cli/${name}\n`);
  } else {
    process.stderr.write(`pack-assets: WARNING ${name} not found at repo root\n`);
  }
}

// Copy the per-platform agent-integration files into dist/agent-assets/ so the
// published package is self-sufficient: `sprang init --platform <p>` scaffolds
// the slash commands, rules, workflows, skills, and merge.py from here. These
// live at the repo root as the single source of truth; they used to be listed
// in the `files` whitelist but were silently omitted (they don't exist under
// packages/cli/), so the npm package shipped without any agent integration.
const assetsTarget = join(cliDist, 'agent-assets');
rmSync(assetsTarget, { recursive: true, force: true });
mkdirSync(assetsTarget, { recursive: true });
const AGENT_ASSETS = [
  '.claude', '.windsurf', '.devin', '.github', '.vscode',
  '.copilot-plugin', '.claude-plugin', 'skills', 'CLAUDE.md', 'AGENTS.md',
];
// Skip dev-only artifacts that must never reach the published package.
const EXCLUDE = new Set(['worktrees', 'node_modules', '.git', 'dist', 'cache']);
const assetFilter = (src) => !EXCLUDE.has(src.split('/').pop());
for (const name of AGENT_ASSETS) {
  const src = join(MONO_ROOT, name);
  if (!existsSync(src)) {
    process.stderr.write(`pack-assets: note — ${name} not found at repo root, skipping\n`);
    continue;
  }
  cpSync(src, join(assetsTarget, name), { recursive: true, filter: assetFilter });
}
process.stdout.write(`Copied agent assets → dist/agent-assets/ (${AGENT_ASSETS.length} entries)\n`);

process.stdout.write('pack-assets: done\n');
