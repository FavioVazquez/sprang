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

process.stdout.write('pack-assets: done\n');
