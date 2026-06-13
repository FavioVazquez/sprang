import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { detectBridge, clearAgentSession } from './src/bridge/index.js';
import { askClaudeBackground } from './src/bridge/claude.js';
import { askCopilotBackground } from './src/bridge/copilot.js';
import { writeWindsurfTrigger, getWindsurfResponsePath } from './src/bridge/windsurf.js';

const MAX_SOURCE_FILE_BYTES = 1024 * 1024; // 1 MB cap for source files

// Allowlist cache — rebuilt only when knowledge-graph.json mtime changes
let allowlistCache: Set<string> | null = null;
let allowlistCacheMtime = 0;

// Mutable project root — can be overridden at runtime via POST /analyze
let currentRoot: string = process.env['SPRANG_ROOT'] ?? process.cwd();

function getSprangRoot(): string {
  return currentRoot;
}

// ── Resolve how to invoke the Sprang CLI for the landing-screen scan ──────────
// Priority (so it "just works" in every scenario):
//   1. Local monorepo build — node <repo>/packages/cli/dist/index.js (dev / repo
//      install / marketplace install where the repo is present)
//   2. `sprang` on PATH — globally installed or `pnpm link --global`
//   3. `npx sprang` — published-to-npm fallback (auto-install with -y)
const CONFIG_DIR = path.dirname(fileURLToPath(import.meta.url)); // packages/dashboard

function resolveLocalCli(): string | null {
  const candidates = [path.resolve(CONFIG_DIR, '../cli/dist/index.js')];
  let dir = CONFIG_DIR;
  for (let i = 0; i < 6; i++) {
    candidates.push(path.join(dir, 'packages/cli/dist/index.js'));
    dir = path.dirname(dir);
  }
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

function findOnPath(bin: string): string | null {
  const dirs = (process.env['PATH'] ?? '').split(path.delimiter);
  for (const d of dirs) {
    if (!d) continue;
    const full = path.join(d, bin);
    try { fs.accessSync(full, fs.constants.X_OK); return full; } catch { /* not here */ }
  }
  return null;
}

function cliScanInvocation(targetDir: string): { cmd: string; args: string[] } {
  const scanArgs = ['scan', '--phase1-only', targetDir];
  const local = resolveLocalCli();
  if (local) return { cmd: process.execPath, args: [local, ...scanArgs] };
  if (findOnPath('sprang')) return { cmd: 'sprang', args: scanArgs };
  return { cmd: 'npx', args: ['-y', 'sprang', ...scanArgs] };
}

function parseGitHubUrl(input: string): { owner: string; repo: string } | null {
  const cleaned = input.trim()
    .replace(/^https?:\/\//, '')
    .replace(/^github\.com\//, '')
    .replace(/\.git$/, '')
    .replace(/\/$/, '');
  const parts = cleaned.split('/');
  if (parts.length >= 2 && parts[0] && parts[1]) {
    return { owner: parts[0], repo: parts[1] };
  }
  return null;
}

function resolveGraphFile(fileName: string): string | null {
  const root = getSprangRoot();
  const candidates = [
    path.join(root, '.sprang', fileName),
    path.join(root, fileName),
  ];
  return candidates.find((c) => fs.existsSync(c)) ?? null;
}

/** Build the allowlist of relative file paths from the graph so we only serve
 *  files that are actually part of the analyzed project (security guard).
 *  Result is cached and invalidated only when the graph file's mtime changes. */
function buildFileAllowList(): Set<string> {
  const graphFile = resolveGraphFile('knowledge-graph.json');
  if (!graphFile) return new Set();
  try {
    const mtime = fs.statSync(graphFile).mtimeMs;
    if (allowlistCache !== null && mtime === allowlistCacheMtime) {
      return allowlistCache;
    }
    const allowed = new Set<string>();
    const raw = JSON.parse(fs.readFileSync(graphFile, 'utf-8')) as {
      nodes?: Array<{ filePath?: unknown; location?: { file?: unknown } }>;
    };
    for (const node of raw.nodes ?? []) {
      const fp = node.filePath ?? node.location?.file;
      if (typeof fp === 'string' && fp.length > 0) {
        const normalized = path.normalize(fp).split(path.sep).join('/');
        if (!normalized.startsWith('..') && !path.isAbsolute(normalized)) {
          allowed.add(normalized);
        }
      }
    }
    allowlistCache = allowed;
    allowlistCacheMtime = mtime;
    return allowed;
  } catch {
    return allowlistCache ?? new Set();
  }
}

const EXT_TO_LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx',
  py: 'python', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin',
  cs: 'csharp', rb: 'ruby', php: 'php', c: 'c', cpp: 'cpp', h: 'c',
  css: 'css', scss: 'scss', html: 'html', md: 'markdown', json: 'json',
  yaml: 'yaml', yml: 'yaml', toml: 'toml', sh: 'bash', bash: 'bash',
  sql: 'sql', graphql: 'graphql', proto: 'protobuf', tf: 'hcl',
};

type ConnectServer = { middlewares: import('vite').Connect.Server };

// ---------------------------------------------------------------------------
// Response file path (shared by all bridge kinds)
// ---------------------------------------------------------------------------
function getResponseFilePath(): string {
  return path.join(getSprangRoot(), '.sprang', 'cascade-response.json');
}

function attachSprangMiddlewares(server: ConnectServer) {
  // GET /knowledge-graph.json
  server.middlewares.use('/knowledge-graph.json', (_req: import('http').IncomingMessage, res: import('http').ServerResponse) => {
    const graphFile = resolveGraphFile('knowledge-graph.json');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (graphFile) {
      res.setHeader('Content-Type', 'application/json');
      res.end(fs.readFileSync(graphFile));
    } else {
      res.statusCode = 404;
      res.end('Not Found');
    }
  });

  // GET /diff-overlay.json
  server.middlewares.use('/diff-overlay.json', (_req: import('http').IncomingMessage, res: import('http').ServerResponse) => {
    const overlayFile = resolveGraphFile('diff-overlay.json');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (overlayFile) {
      res.setHeader('Content-Type', 'application/json');
      res.end(fs.readFileSync(overlayFile));
    } else {
      res.statusCode = 404;
      res.end('Not Found');
    }
  });

  // GET /file-content.json?path=<relpath>
  // Returns { path, language, content } for files in the analyzed project.
  // Only serves paths that appear as filePath/location.file in the graph (allowlist).
  server.middlewares.use('/file-content.json', (req: import('http').IncomingMessage, res: import('http').ServerResponse) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', 'application/json');

    const url = new URL(req.url ?? '', 'http://localhost');
    const rawPath = url.searchParams.get('path') ?? '';

    if (!rawPath) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: 'Missing path parameter' }));
      return;
    }

    // Normalize and security-check path
    const normalized = path.normalize(rawPath).split(path.sep).join('/');
    if (normalized.startsWith('..') || path.isAbsolute(normalized) || normalized.includes('\0')) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: 'Invalid path' }));
      return;
    }

    // Check against allowlist
    const allowed = buildFileAllowList();
    if (!allowed.has(normalized)) {
      res.statusCode = 403;
      res.end(JSON.stringify({ error: 'Path not in analyzed graph' }));
      return;
    }

    const projectRoot = getSprangRoot();
    const absPath = path.join(projectRoot, normalized);
    if (!absPath.startsWith(projectRoot)) {
      res.statusCode = 403;
      res.end(JSON.stringify({ error: 'Path traversal denied' }));
      return;
    }

    if (!fs.existsSync(absPath)) {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'File not found' }));
      return;
    }

    const stat = fs.statSync(absPath);
    if (stat.size > MAX_SOURCE_FILE_BYTES) {
      res.statusCode = 413;
      res.end(JSON.stringify({ error: 'File too large', size: stat.size }));
      return;
    }

    const content = fs.readFileSync(absPath, 'utf-8');
    const ext = path.extname(absPath).slice(1).toLowerCase();
    const language = EXT_TO_LANG[ext] ?? 'text';

    res.end(JSON.stringify({ path: normalized, language, content }));
  });

  // GET /bridge-status — returns which agent bridge is currently active.
  server.middlewares.use('/bridge-status', (_req: import('http').IncomingMessage, res: import('http').ServerResponse) => {
    res.setHeader('Content-Type', 'application/json');
    const status = detectBridge(getSprangRoot());
    res.statusCode = 200;
    res.end(JSON.stringify(status));
  });

  // POST /agent-ask  { "message": "..." }
  // Routes to the appropriate agent bridge (windsurf / claude / copilot).
  server.middlewares.use('/agent-ask', (req: import('http').IncomingMessage, res: import('http').ServerResponse) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
    if (req.method !== 'POST') { res.statusCode = 405; res.end(JSON.stringify({ error: 'POST only' })); return; }

    const MAX_BODY_BYTES = 64 * 1024;
    let body = '';
    let bodyBytes = 0;
    let aborted = false;
    req.on('data', (chunk: Buffer) => {
      if (aborted) return;
      bodyBytes += chunk.length;
      if (bodyBytes > MAX_BODY_BYTES) {
        aborted = true;
        res.statusCode = 413;
        res.end(JSON.stringify({ error: 'Request body too large' }));
        return;
      }
      body += chunk.toString('utf-8');
    });
    req.on('end', () => {
      if (aborted) return;
      try {
        const { message } = JSON.parse(body) as { message?: string };
        if (!message || typeof message !== 'string' || message.trim() === '') {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: 'message field required' }));
          return;
        }
        const userMessage = message.trim().slice(0, 4096);
        const sprangRoot = getSprangRoot();
        const bridge = detectBridge(sprangRoot);

        if (bridge.kind === 'none') {
          res.statusCode = 503;
          res.end(JSON.stringify({ error: bridge.detail ?? 'No agent bridge available' }));
          return;
        }

        // Clear any previous response so the dashboard knows to wait for the new one
        const responsePath = getWindsurfResponsePath(sprangRoot);
        if (fs.existsSync(responsePath)) { try { fs.unlinkSync(responsePath); } catch { /* ignore */ } }

        // Return 200 immediately — all bridges are fire-and-forget from the HTTP perspective.
        // Claude/Copilot spawn in the background and write cascade-response.json when done.
        // The dashboard polls /agent-response to pick up the result.
        res.statusCode = 200;
        res.end(JSON.stringify({ ok: true, sent: userMessage, mode: bridge.kind === 'windsurf' ? 'async' : 'async' }));

        if (bridge.kind === 'windsurf') {
          writeWindsurfTrigger(userMessage, sprangRoot);
        } else if (bridge.kind === 'claude') {
          askClaudeBackground(userMessage, sprangRoot, responsePath);
        } else if (bridge.kind === 'copilot') {
          askCopilotBackground(userMessage, sprangRoot, responsePath);
        }
      } catch {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      }
    });
  });

  // GET /agent-response
  // Polls for the response written by the sprang_respond MCP tool.
  server.middlewares.use('/agent-response', (req: import('http').IncomingMessage, res: import('http').ServerResponse) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'DELETE') {
      clearAgentSession(getSprangRoot());
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    const responsePath = getResponseFilePath();
    if (fs.existsSync(responsePath)) {
      try {
        const data = fs.readFileSync(responsePath, 'utf-8');
        res.statusCode = 200;
        res.end(data);
      } catch {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: 'Failed to read response' }));
      }
    } else {
      res.statusCode = 204;
      res.end();
    }
  });

  // POST /analyze — optional JSON body: { path?: string; githubUrl?: string }
  // If body is empty, scans SPRANG_ROOT (existing behaviour).
  // If path is given, updates currentRoot to that path then scans.
  // If githubUrl is given, clones to /tmp/sprang-gh-<owner>-<repo>/ then scans.
  server.middlewares.use('/analyze', (req: import('http').IncomingMessage, res: import('http').ServerResponse) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.method !== 'POST') { res.statusCode = 405; res.end(JSON.stringify({ error: 'POST only' })); return; }

    let raw = '';
    req.on('data', (chunk: Buffer) => { raw += chunk.toString(); });
    req.on('end', () => {
      let params: { path?: string; githubUrl?: string } = {};
      try { if (raw.trim()) params = JSON.parse(raw) as typeof params; } catch { /* use defaults */ }

      // GitHub URL — clone then scan
      if (params.githubUrl) {
        const parsed = parseGitHubUrl(params.githubUrl);
        if (!parsed) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: 'Invalid GitHub URL. Expected: github.com/owner/repo or owner/repo' }));
          return;
        }
        const cloneDir = path.join(os.tmpdir(), `sprang-gh-${parsed.owner}-${parsed.repo}`);
        currentRoot = cloneDir;
        allowlistCache = null; // invalidate on root change
        res.statusCode = 200;
        res.end(JSON.stringify({ ok: true, started: true, mode: 'github', cloning: true, root: cloneDir, repo: `${parsed.owner}/${parsed.repo}` }));

        import('node:child_process').then(({ spawn }) => {
          // If already cloned, just pull; otherwise clone fresh
          const cloneExists = fs.existsSync(path.join(cloneDir, '.git'));
          const gitArgs = cloneExists
            ? ['-C', cloneDir, 'pull', '--ff-only']
            : ['clone', '--depth=1', `https://github.com/${parsed.owner}/${parsed.repo}`, cloneDir];
          const gitChild = spawn('git', gitArgs, { stdio: 'ignore' });
          gitChild.on('close', (code) => {
            if (code !== 0) return;
            const inv = cliScanInvocation(cloneDir);
            const scanChild = spawn(inv.cmd, inv.args, {
              cwd: cloneDir, detached: true, stdio: 'ignore',
            });
            scanChild.on('error', (err) => {
              process.stderr.write(`[sprang] analyze scan failed to start: ${err.message}\n`);
            });
            scanChild.unref();
          });
        }).catch(() => {/* ignore */});
        return;
      }

      // Local path — validate and update root
      if (params.path) {
        const resolved = path.resolve(params.path);
        if (!fs.existsSync(resolved)) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: `Path not found: ${resolved}` }));
          return;
        }
        currentRoot = resolved;
        allowlistCache = null; // invalidate on root change
      }

      const sprangRoot = getSprangRoot();
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true, started: true, mode: 'local', root: sprangRoot }));

      import('node:child_process').then(({ spawn }) => {
        const inv = cliScanInvocation(sprangRoot);
        const child = spawn(inv.cmd, inv.args, {
          cwd: sprangRoot, detached: true, stdio: 'ignore',
        });
        child.on('error', (err) => {
          process.stderr.write(`[sprang] analyze scan failed to start: ${err.message}\n`);
        });
        child.unref();
      }).catch(() => {/* ignore */});
    });
  });

  // GET /analyze-status — returns current analysis progress
  server.middlewares.use('/analyze-status', (_req: import('http').IncomingMessage, res: import('http').ServerResponse) => {
    res.setHeader('Content-Type', 'application/json');
    const progressPath = path.join(getSprangRoot(), '.sprang', 'intermediate', 'phase2-progress.json');
    if (fs.existsSync(progressPath)) {
      try {
        res.statusCode = 200;
        res.end(fs.readFileSync(progressPath));
      } catch {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: 'Failed to read progress' }));
      }
    } else {
      res.statusCode = 204;
      res.end();
    }
  });

  // GET /health-history.json — serves .sprang/history.json
  server.middlewares.use('/health-history.json', (_req: import('http').IncomingMessage, res: import('http').ServerResponse) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const historyPath = path.join(getSprangRoot(), '.sprang', 'history.json');
    if (fs.existsSync(historyPath)) {
      try {
        res.statusCode = 200;
        res.end(fs.readFileSync(historyPath));
      } catch {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: 'Failed to read history' }));
      }
    } else {
      res.statusCode = 200;
      res.end('[]');
    }
  });
}

// Serve knowledge-graph.json, file-content.json, and diff-overlay.json
// Works in both `vite` (dev) and `vite preview` (serves pre-built dist/) modes.
const sprangGraphPlugin = () => ({
  name: 'sprang-graph-serve',
  configureServer(server: import('vite').ViteDevServer) {
    attachSprangMiddlewares(server);
  },
  configurePreviewServer(server: import('vite').PreviewServer) {
    attachSprangMiddlewares(server);
  },
});

export default defineConfig({
  plugins: [react(), sprangGraphPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  build: {
    // @xyflow/react (React Flow) + ELK are inherently large (~1.5 MB combined).
    // They're lazy-loaded — only downloaded when visiting Architecture/Domains views.
    // The main bundle is ~142 KB; this limit silences the warning for the lazy chunk.
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return;
          // Isolate react-force-graph and its entire dependency stack in their own chunk.
          // react-force-graph → 3d-force-graph → three.js + d3-force, creating circular deps
          // with vendor (React) and vendor-graph (Sigma/D3). Isolating the whole stack
          // prevents the circular that corrupts Sigma.js (EventEmitter undefined crash).
          // Graph3DCanvas imports 3d-force-graph + react-kapsule directly (not react-force-graph).
          // Isolate the entire 3D force-graph stack to keep it out of the eagerly-loaded
          // vendor chunk (mixing it in creates circular chunk deps that crash Sigma.js init).
          if (id.includes('3d-force-graph') || id.includes('three-forcegraph') ||
              id.includes('three-render-objects') || id.includes('super-three') ||
              id.includes('react-kapsule') || id.includes('kapsule') ||
              id.includes('ngraph') || id.includes('d3-force-3d') ||
              id.includes('d3-binarytree') || id.includes('d3-octree') ||
              id.includes('accessor-fn') || id.includes('data-bind-mapper') ||
              id.includes('tinycolor2') || id.includes('index-array-by') ||
              id.includes('float-tooltip') || id.includes('jerrypick') ||
              id.includes('canvas-color-tracker') || id.includes('@tweenjs') ||
              id.includes('nipplejs') || id.includes('bezier-js') ||
              id.includes('/three/') || id.includes('/three@') ||
              id.includes('three.module') || id.includes('three.cjs')) {
            return 'vendor-3d';
          }
          // Co-locate `events` (Node.js EventEmitter polyfill) with Sigma.js to avoid
          // circular chunk initialization order that corrupts EventEmitter (undefined crash).
          if (id.includes('sigma') || id.includes('graphology') || id.includes('d3-force') ||
              id.includes('/events/') || id.includes('/events@')) {
            return 'vendor-graph';
          }
          if (id.includes('@xyflow') || id.includes('elkjs')) {
            return 'vendor-flow';
          }
          if (id.includes('framer-motion')) {
            return 'vendor-motion';
          }
          if (id.includes('prism-react-renderer')) {
            return 'vendor-prism';
          }
          if (id.includes('@radix-ui') || id.includes('cmdk') || id.includes('lucide-react') || id.includes('class-variance') || id.includes('clsx') || id.includes('tailwind-merge')) {
            return 'vendor-ui';
          }
          // React and react-dom share internals — keep them together in the main vendor chunk
          return 'vendor';
        },
      },
    },
  },
  server: {
    port: 7338,
    host: true,
  },
  preview: {
    port: 7777,
    host: true,
  },
});
