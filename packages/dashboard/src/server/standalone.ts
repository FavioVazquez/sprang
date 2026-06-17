/**
 * Standalone Sprang dashboard HTTP server.
 *
 * Serves the pre-built React SPA from a static directory and exposes the
 * same 9 API routes as the Vite dev/preview plugin — so `sprang open` works
 * for npm-installed users who don't have Vite on PATH.
 *
 * Static file resolution order:
 *   1. SPRANG_DASHBOARD_DIST env var (set by `sprang open` for npm installs)
 *   2. <this file's dir>/dashboard/          (npm package: dist/dashboard/)
 *   3. <this file's dir>/                    (monorepo: compiled into dist/)
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerRoutes } from './routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MIME: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  js:   'application/javascript; charset=utf-8',
  mjs:  'application/javascript; charset=utf-8',
  css:  'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
  svg:  'image/svg+xml',
  png:  'image/png',
  ico:  'image/x-icon',
  woff: 'font/woff',
  woff2:'font/woff2',
  txt:  'text/plain; charset=utf-8',
};

function findStaticDir(): string {
  const candidates = [
    process.env['SPRANG_DASHBOARD_DIST'] ?? '',
    path.resolve(__dirname, 'dashboard'),
    path.resolve(__dirname),
  ].filter(Boolean);
  return (
    candidates.find((d) => fs.existsSync(path.join(d, 'index.html'))) ?? candidates[0]
  );
}

function serveStatic(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  staticDir: string,
): void {
  const rawUrl = (req.url ?? '/').split('?')[0];
  const decoded = decodeURIComponent(rawUrl);
  // Block path traversal
  const safe = path.normalize(decoded).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(staticDir, safe === '/' ? 'index.html' : safe);

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).slice(1).toLowerCase();
    res.setHeader('Content-Type', MIME[ext] ?? 'application/octet-stream');
    // Long-term cache for hashed assets, no-cache for HTML
    if (ext === 'html') {
      res.setHeader('Cache-Control', 'no-cache');
    } else if (filePath.includes('/assets/')) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
    fs.createReadStream(filePath).pipe(res);
  } else {
    // SPA fallback — serve index.html for unknown paths
    const indexPath = path.join(staticDir, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      fs.createReadStream(indexPath).pipe(res);
    } else {
      res.statusCode = 404;
      res.end('Dashboard not found. Run: pnpm --filter @sprang/dashboard build');
    }
  }
}

function main(): void {
  const port = parseInt(process.env['PORT'] ?? '7777', 10);
  const sprangRoot = process.env['SPRANG_ROOT'] ?? process.cwd();
  const staticDir = findStaticDir();

  let currentRoot = sprangRoot;
  const getRoot = () => currentRoot;
  const setRoot = (r: string) => { currentRoot = r; };

  // Route registry — collects path → handler pairs
  const routes: Array<{ prefix: string; handler: (req: http.IncomingMessage, res: http.ServerResponse) => void }> = [];

  registerRoutes(
    (prefix, handler) => routes.push({ prefix, handler }),
    getRoot,
    setRoot,
  );

  const server = http.createServer((req, res) => {
    const url = req.url ?? '/';

    // CORS headers for API routes
    res.setHeader('Access-Control-Allow-Origin', `http://localhost:${port}`);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Match API routes (exact prefix)
    for (const { prefix, handler } of routes) {
      if (url === prefix || url.startsWith(prefix + '?')) {
        handler(req, res);
        return;
      }
    }

    // Static file / SPA fallback
    serveStatic(req, res, staticDir);
  });

  server.listen(port, () => {
    process.stdout.write(`Sprang dashboard: http://localhost:${port}\n`);
    process.stdout.write(`Project root:     ${currentRoot}\n`);
    if (!fs.existsSync(path.join(staticDir, 'index.html'))) {
      process.stderr.write(`WARNING: Dashboard static files not found at ${staticDir}\n`);
      process.stderr.write('Run: pnpm --filter @sprang/dashboard build\n');
    }
  });

  process.on('SIGINT', () => { server.close(); process.exit(0); });
  process.on('SIGTERM', () => { server.close(); process.exit(0); });
}

main();
