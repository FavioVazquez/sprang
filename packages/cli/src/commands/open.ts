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
    .option('--auto-scan', 'Automatically start Phase 1 scan when the dashboard opens (no button click required)')
    .action(async (pathArg: string | undefined, options: { port: string; browser: boolean; autoScan?: boolean }) => {
      const projectRoot = resolve(pathArg ?? process.cwd());

      if (!existsSync(projectRoot)) {
        process.stderr.write(`Error: Path not found: ${projectRoot}\n`);
        process.exit(1);
      }

      process.stdout.write(`Opening Sprang dashboard for: ${projectRoot}\n`);
      process.stdout.write(`Dashboard: http://localhost:${options.port}\n`);

      // Locate the standalone server and dashboard static files.
      // Resolution order (both monorepo dev and npm global install):
      //   1. Sibling npm package: <cli-dist>/dashboard-server.js  (npm global)
      //   2. Monorepo sibling:    packages/dashboard/dist/standalone.js
      const cliDist = resolve(import.meta.dirname ?? __dirname);

      let standaloneServer: string | null = null;
      let dashboardDist: string | null = null;

      // Try npm package layout first (dist/dashboard-server.js)
      const npmServer = join(cliDist, 'dashboard-server.js');
      if (existsSync(npmServer)) {
        standaloneServer = npmServer;
        // Static files are at dist/dashboard/ in the npm package
        const npmStatic = join(cliDist, 'dashboard');
        dashboardDist = existsSync(join(npmStatic, 'index.html')) ? npmStatic : cliDist;
      }

      // Monorepo: walk up looking for packages/dashboard/dist/standalone.js
      if (!standaloneServer) {
        let searchDir = cliDist;
        for (let i = 0; i < 8; i++) {
          const candidate = join(searchDir, 'packages', 'dashboard', 'dist', 'standalone.js');
          if (existsSync(candidate)) {
            standaloneServer = candidate;
            dashboardDist = join(searchDir, 'packages', 'dashboard', 'dist');
            break;
          }
          const parent = resolve(searchDir, '..');
          if (parent === searchDir) break;
          searchDir = parent;
        }
      }

      if (!standaloneServer) {
        process.stderr.write(
          'Dashboard server not found. Run: pnpm --filter @sprang/dashboard build\n'
        );
        process.exit(1);
      }

      const env: NodeJS.ProcessEnv = {
        ...process.env,
        SPRANG_ROOT: projectRoot,
        PORT: options.port,
      };
      if (dashboardDist) {
        env['SPRANG_DASHBOARD_DIST'] = dashboardDist;
      }

      const child = spawn(process.execPath, [standaloneServer], {
        env,
        stdio: 'inherit',
        shell: false,
      });

      if (options.browser) {
        setTimeout(() => {
          const params = new URLSearchParams();
          if (options.autoScan) params.set('autoScan', '1');
          params.set('path', projectRoot);
          const qs = params.toString();
          const url = `http://localhost:${options.port}${qs ? `?${qs}` : ''}`;
          const openCmd = process.platform === 'darwin' ? 'open'
            : process.platform === 'win32' ? 'start'
            : 'xdg-open';
          spawn(openCmd, [url], { shell: process.platform === 'win32' });
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
