import { resolve, dirname, join, relative } from 'node:path';
import { existsSync, readFileSync, writeFileSync, renameSync, realpathSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { Command } from 'commander';
import { fileURLToPath } from 'node:url';

const CYAN  = '\x1b[36m';
const GREEN = '\x1b[32m';
const DIM   = '\x1b[2m';
const RESET = '\x1b[0m';

function findMcpServerPath(): string {
  const cliDist = dirname(fileURLToPath(import.meta.url));

  // npm package layout: dist/mcp-server.js (sibling of dist/index.js)
  const npmMcp = join(cliDist, 'mcp-server.js');
  if (existsSync(npmMcp)) return realpathSync(npmMcp);

  // Monorepo layout: walk up looking for packages/mcp/dist/server.js
  let dir = cliDist;
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, 'packages', 'mcp', 'dist', 'server.js');
    if (existsSync(candidate)) return realpathSync(candidate);
    const parent = resolve(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  // Fall back to the npm layout path even if it doesn't exist yet
  return npmMcp;
}

export function makeInitCommand(): Command {
  const cmd = new Command('init');
  cmd
    .description('Install Sprang MCP server config into a project (.mcp.json)')
    .argument('[path]', 'Target project root (defaults to current directory)')
    .option('-y, --yes', 'Skip interactive prompt')
    .action(async (pathArg: string | undefined, options: { yes?: boolean }) => {
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

      const mcpServerPath = findMcpServerPath();
      const mcpPath = join(projectRoot, '.mcp.json');

      let existing: Record<string, unknown> = {};
      if (existsSync(mcpPath)) {
        try { existing = JSON.parse(readFileSync(mcpPath, 'utf-8')) as Record<string, unknown>; } catch { /* start fresh */ }
      }

      const updated = {
        ...existing,
        mcpServers: {
          ...(existing['mcpServers'] as Record<string, unknown> ?? {}),
          sprang: {
            command: 'node',
            args: [mcpServerPath],
            env: { SPRANG_ROOT: '.' },
          },
        },
      };

      const tmp = mcpPath + '.tmp';
      writeFileSync(tmp, JSON.stringify(updated, null, 2) + '\n', 'utf-8');
      renameSync(tmp, mcpPath);

      process.stdout.write(`  ${GREEN}✓${RESET} Wrote ${relative(process.cwd(), mcpPath)}\n`);
      process.stdout.write(`\n  MCP server: ${DIM}${mcpServerPath}${RESET}\n`);
      process.stdout.write(`
  ${GREEN}Done!${RESET} Next steps:

    ${CYAN}sprang scan${RESET} [path]   — build knowledge graph
    ${CYAN}sprang open${RESET} [path]   — open dashboard

  In your AI assistant: ${DIM}sprang_health(), sprang_query("...")${RESET}
\n`);
    });

  return cmd;
}
