#!/usr/bin/env node
/**
 * sprang init — project installer
 *
 * Writes .mcp.json and updates CLAUDE.md / AGENTS.md so the user's
 * AI assistant can use the Sprang MCP tools right away.
 *
 * Usage:
 *   npx sprang init            # interactive (prompts for project root)
 *   npx sprang init --yes      # non-interactive (writes to cwd)
 *   npx sprang init --target /path/to/project
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');

const pkg = require('../package.json');

const cyan  = '\x1b[36m';
const green = '\x1b[32m';
const dim   = '\x1b[2m';
const reset = '\x1b[0m';

const args = process.argv.slice(2);
const hasYes = args.includes('--yes') || args.includes('-y');
const targetIdx = args.indexOf('--target');
const targetArg = targetIdx !== -1 ? args[targetIdx + 1] : null;
const showHelp = args.includes('--help') || args.includes('-h');
const showVersion = args.includes('--version') || args.includes('-v');

if (showVersion) { console.log(pkg.version); process.exit(0); }
if (showHelp) {
  console.log(`
${cyan}sprang init${reset} — install Sprang MCP server into your project

Usage:
  npx sprang init [--yes] [--target <path>]

Options:
  --yes, -y          Skip prompts, write to current directory
  --target <path>    Install into specific directory
  --help, -h         Show this help
  --version, -v      Show version
`);
  process.exit(0);
}

// Find where the MCP server lives (relative to this script)
// bin/install.js is in packages/cli/bin/
// MCP server will be at packages/cli/dist/mcp-server.js after prepublishOnly copy
// In the npm global install: <prefix>/lib/node_modules/sprang/dist/mcp-server.js
const BIN_DIR = path.dirname(fs.realpathSync(__filename));
const PACKAGE_ROOT = path.resolve(BIN_DIR, '..');
const MCP_SERVER_PATH = path.join(PACKAGE_ROOT, 'dist', 'mcp-server.js');

function validateTargetPath(raw) {
  if (!raw) return null;
  const resolved = path.resolve(raw);
  const forbidden = ['/', '/etc', '/usr', '/var', '/bin', '/sbin'];
  if (forbidden.includes(resolved)) {
    console.error(`  Error: refusing to install to system path: ${resolved}`);
    process.exit(1);
  }
  if (resolved === os.homedir()) {
    console.error(`  Error: refusing to install directly to $HOME`);
    process.exit(1);
  }
  return resolved;
}

function writeMcpJson(projectRoot) {
  const mcpPath = path.join(projectRoot, '.mcp.json');

  // Check if MCP server is available
  const mcpServerExists = fs.existsSync(MCP_SERVER_PATH);
  const serverPath = mcpServerExists ? MCP_SERVER_PATH : path.join(PACKAGE_ROOT, 'packages', 'mcp', 'dist', 'server.js');

  let existing = {};
  if (fs.existsSync(mcpPath)) {
    try { existing = JSON.parse(fs.readFileSync(mcpPath, 'utf-8')); } catch { /* start fresh */ }
  }

  const updated = {
    ...existing,
    mcpServers: {
      ...(existing.mcpServers ?? {}),
      sprang: {
        command: 'node',
        args: [serverPath],
        env: { SPRANG_ROOT: '.' },
      },
    },
  };

  const tmp = mcpPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(updated, null, 2) + '\n', 'utf-8');
  fs.renameSync(tmp, mcpPath);
  return mcpPath;
}

async function main() {
  console.log(`\n${cyan}Sprang v${pkg.version}${reset} — Knowledge Graph Dashboard\n`);

  let projectRoot = process.cwd();

  if (targetArg) {
    projectRoot = validateTargetPath(targetArg) ?? projectRoot;
  } else if (!hasYes) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    projectRoot = await new Promise((resolve) => {
      rl.question(`  ${dim}Project root${reset} [${process.cwd()}]: `, (ans) => {
        rl.close();
        resolve(ans.trim() || process.cwd());
      });
    });
  }

  if (!fs.existsSync(projectRoot)) {
    console.error(`  Error: Path not found: ${projectRoot}`);
    process.exit(1);
  }

  console.log(`\n  Installing into: ${projectRoot}\n`);

  // Write .mcp.json
  const mcpPath = writeMcpJson(projectRoot);
  console.log(`  ${green}✓${reset} Wrote ${path.relative(projectRoot, mcpPath)}`);

  console.log(`
  ${green}Done!${reset} Build the knowledge graph:

    ${cyan}sprang scan${reset} [path]        # Phase 1: static analysis
    ${cyan}sprang open${reset} [path]        # Open dashboard

  Then ask your AI assistant: ${dim}"/sprang" or "run sprang_health"${reset}
`);
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
