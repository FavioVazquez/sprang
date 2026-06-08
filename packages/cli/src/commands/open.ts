import { resolve, join } from 'node:path';
import { existsSync } from 'node:fs';
import { Command } from 'commander';
import { spawn } from 'node:child_process';

export function makeOpenCommand(): Command {
  const cmd = new Command('open');
  cmd
    .description('Open the Sprang dashboard pointed at a project folder')
    .argument('[path]', 'Path to the project root to open', undefined)
    .option('--port <number>', 'Port for the dashboard server', '7777')
    .option('--no-browser', 'Do not open browser automatically')
    .action(async (pathArg: string | undefined, options: { port: string; browser: boolean }) => {
      const projectRoot = resolve(pathArg ?? process.cwd());

      if (!existsSync(projectRoot)) {
        process.stderr.write(`Error: Path not found: ${projectRoot}\n`);
        process.exit(1);
      }

      process.stdout.write(`Opening Sprang dashboard for: ${projectRoot}\n`);
      process.stdout.write(`Dashboard: http://localhost:${options.port}\n`);

      // Find the dashboard package dist relative to this CLI
      // The CLI is at packages/cli/dist/index.js — dashboard is at packages/dashboard/dist/
      const cliDist = resolve(import.meta.dirname ?? __dirname);
      // Walk up to find the monorepo root (has pnpm-workspace.yaml)
      let searchDir = cliDist;
      let dashboardDist: string | null = null;
      for (let i = 0; i < 8; i++) {
        const candidate = join(searchDir, 'packages', 'dashboard', 'dist');
        if (existsSync(candidate)) {
          dashboardDist = candidate;
          break;
        }
        const parent = resolve(searchDir, '..');
        if (parent === searchDir) break;
        searchDir = parent;
      }

      if (!dashboardDist) {
        process.stderr.write(
          'Dashboard dist not found. Run: pnpm --filter @sprang/dashboard build\n'
        );
        process.exit(1);
      }

      // Find the dashboard package.json directory to run vite preview from
      const dashboardPkg = resolve(dashboardDist, '..');

      const env = { ...process.env, SPRANG_ROOT: projectRoot };
      const child = spawn(
        'npx',
        ['vite', 'preview', '--port', options.port, '--host'],
        {
          cwd: dashboardPkg,
          env,
          stdio: 'inherit',
          shell: false,
        }
      );

      if (options.browser) {
        // Give the server a moment to start, then open browser
        setTimeout(() => {
          const openCmd = process.platform === 'darwin' ? 'open'
            : process.platform === 'win32' ? 'start'
            : 'xdg-open';
          spawn(openCmd, [`http://localhost:${options.port}`], { shell: process.platform === 'win32' });
        }, 1500);
      }

      child.on('error', (err) => {
        process.stderr.write(`Failed to start dashboard: ${err.message}\n`);
        process.exit(1);
      });

      process.on('SIGINT', () => { child.kill(); process.exit(0); });
      process.on('SIGTERM', () => { child.kill(); process.exit(0); });
    });

  return cmd;
}
