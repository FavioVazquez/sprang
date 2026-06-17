/**
 * Framework-agnostic Sprang route handlers.
 *
 * Works in both Vite (dev/preview) and the standalone Node.js HTTP server.
 * The `use(path, handler)` signature matches Connect / Vite's middlewares.use().
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { detectBridge, clearAgentSession } from '../bridge/index.js';
import { askClaudeBackground } from '../bridge/claude.js';
import { askCopilotBackground } from '../bridge/copilot.js';
import { writeWindsurfTrigger, getWindsurfResponsePath } from '../bridge/windsurf.js';

const MAX_SOURCE_FILE_BYTES = 1024 * 1024; // 1 MB cap

const EXT_TO_LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx',
  py: 'python', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin',
  cs: 'csharp', rb: 'ruby', php: 'php', c: 'c', cpp: 'cpp', h: 'c',
  css: 'css', scss: 'scss', html: 'html', md: 'markdown', json: 'json',
  yaml: 'yaml', yml: 'yaml', toml: 'toml', sh: 'bash', bash: 'bash',
  sql: 'sql', graphql: 'graphql', proto: 'protobuf', tf: 'hcl',
};

// Allowlist cache — rebuilt only when knowledge-graph.json mtime changes
let allowlistCache: Set<string> | null = null;
let allowlistCacheMtime = 0;

function resolveGraphFile(fileName: string, getRoot: () => string): string | null {
  const root = getRoot();
  const candidates = [
    path.join(root, '.sprang', fileName),
    path.join(root, fileName),
  ];
  return candidates.find((c) => fs.existsSync(c)) ?? null;
}

function buildFileAllowList(getRoot: () => string): Set<string> {
  const graphFile = resolveGraphFile('knowledge-graph.json', getRoot);
  if (!graphFile) return new Set();
  try {
    const mtime = fs.statSync(graphFile).mtimeMs;
    if (allowlistCache !== null && mtime === allowlistCacheMtime) return allowlistCache;
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

function resolveLocalCli(): string | null {
  const configDir = path.resolve(new URL(import.meta.url).pathname, '../../..');
  const candidates = [path.resolve(configDir, '../cli/dist/index.js')];
  let dir = configDir;
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

type RouteRegistrar = (path: string, handler: (req: IncomingMessage, res: ServerResponse) => void) => void;

/**
 * Register all Sprang API routes.
 *
 * @param register - Connect-compatible middleware registration (e.g. server.middlewares.use)
 * @param getRoot  - Returns the current SPRANG_ROOT; may change at runtime via POST /analyze
 * @param setRoot  - Updates SPRANG_ROOT (e.g. from POST /analyze body)
 */
export function registerRoutes(
  register: RouteRegistrar,
  getRoot: () => string,
  setRoot?: (newRoot: string) => void,
): void {
  // Allow the caller to provide a root setter; default to a no-op warning
  const updateRoot = setRoot ?? ((_r: string) => {
    process.stderr.write('[sprang] registerRoutes: no setRoot provided, root change ignored\n');
  });

  // GET /knowledge-graph.json
  register('/knowledge-graph.json', (_req, res) => {
    const graphFile = resolveGraphFile('knowledge-graph.json', getRoot);
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
  register('/diff-overlay.json', (_req, res) => {
    const overlayFile = resolveGraphFile('diff-overlay.json', getRoot);
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
  register('/file-content.json', (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', 'application/json');
    const url = new URL(req.url ?? '', 'http://localhost');
    const rawPath = url.searchParams.get('path') ?? '';
    if (!rawPath) { res.statusCode = 400; res.end(JSON.stringify({ error: 'Missing path parameter' })); return; }
    const normalized = path.normalize(rawPath).split(path.sep).join('/');
    if (normalized.startsWith('..') || path.isAbsolute(normalized) || normalized.includes('\0')) {
      res.statusCode = 400; res.end(JSON.stringify({ error: 'Invalid path' })); return;
    }
    const allowed = buildFileAllowList(getRoot);
    if (!allowed.has(normalized)) { res.statusCode = 403; res.end(JSON.stringify({ error: 'Path not in analyzed graph' })); return; }
    const projectRoot = getRoot();
    const absPath = path.join(projectRoot, normalized);
    if (!absPath.startsWith(projectRoot)) { res.statusCode = 403; res.end(JSON.stringify({ error: 'Path traversal denied' })); return; }
    if (!fs.existsSync(absPath)) { res.statusCode = 404; res.end(JSON.stringify({ error: 'File not found' })); return; }
    const stat = fs.statSync(absPath);
    if (stat.size > MAX_SOURCE_FILE_BYTES) { res.statusCode = 413; res.end(JSON.stringify({ error: 'File too large', size: stat.size })); return; }
    const content = fs.readFileSync(absPath, 'utf-8');
    const ext = path.extname(absPath).slice(1).toLowerCase();
    res.end(JSON.stringify({ path: normalized, language: EXT_TO_LANG[ext] ?? 'text', content }));
  });

  // GET /bridge-status
  register('/bridge-status', (_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = 200;
    res.end(JSON.stringify(detectBridge(getRoot())));
  });

  // POST /agent-ask
  register('/agent-ask', (req, res) => {
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
          res.statusCode = 400; res.end(JSON.stringify({ error: 'message field required' })); return;
        }
        const userMessage = message.trim().slice(0, 4096);
        const sprangRoot = getRoot();
        const bridge = detectBridge(sprangRoot);
        if (bridge.kind === 'none') { res.statusCode = 503; res.end(JSON.stringify({ error: bridge.detail ?? 'No agent bridge available' })); return; }
        const responsePath = getWindsurfResponsePath(sprangRoot);
        if (fs.existsSync(responsePath)) { try { fs.unlinkSync(responsePath); } catch { /* ignore */ } }
        res.statusCode = 200;
        res.end(JSON.stringify({ ok: true, sent: userMessage, mode: 'async' }));
        if (bridge.kind === 'windsurf') {
          writeWindsurfTrigger(userMessage, sprangRoot);
        } else if (bridge.kind === 'claude') {
          askClaudeBackground(userMessage, sprangRoot, responsePath);
        } else if (bridge.kind === 'copilot') {
          askCopilotBackground(userMessage, sprangRoot, responsePath);
        }
      } catch {
        res.statusCode = 400; res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      }
    });
  });

  // GET /agent-response  (DELETE clears session)
  register('/agent-response', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'DELETE') {
      clearAgentSession(getRoot());
      res.statusCode = 200; res.end(JSON.stringify({ ok: true })); return;
    }
    const responsePath = getWindsurfResponsePath(getRoot());
    if (fs.existsSync(responsePath)) {
      try { res.statusCode = 200; res.end(fs.readFileSync(responsePath, 'utf-8')); }
      catch { res.statusCode = 500; res.end(JSON.stringify({ error: 'Failed to read response' })); }
    } else {
      res.statusCode = 204; res.end();
    }
  });

  // POST /analyze
  register('/analyze', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.method !== 'POST') { res.statusCode = 405; res.end(JSON.stringify({ error: 'POST only' })); return; }
    let raw = '';
    req.on('data', (chunk: Buffer) => { raw += chunk.toString(); });
    req.on('end', () => {
      let params: { path?: string; githubUrl?: string } = {};
      try { if (raw.trim()) params = JSON.parse(raw) as typeof params; } catch { /* use defaults */ }

      if (params.githubUrl) {
        const parsed = parseGitHubUrl(params.githubUrl);
        if (!parsed) { res.statusCode = 400; res.end(JSON.stringify({ error: 'Invalid GitHub URL. Expected: github.com/owner/repo or owner/repo' })); return; }
        const cloneDir = path.join(os.tmpdir(), `sprang-gh-${parsed.owner}-${parsed.repo}`);
        updateRoot(cloneDir);
        allowlistCache = null;
        res.statusCode = 200;
        res.end(JSON.stringify({ ok: true, started: true, mode: 'github', cloning: true, root: cloneDir, repo: `${parsed.owner}/${parsed.repo}` }));
        import('node:child_process').then(({ spawn }) => {
          const cloneExists = fs.existsSync(path.join(cloneDir, '.git'));
          const gitArgs = cloneExists ? ['-C', cloneDir, 'pull', '--ff-only'] : ['clone', '--depth=1', `https://github.com/${parsed.owner}/${parsed.repo}`, cloneDir];
          const gitChild = spawn('git', gitArgs, { stdio: 'ignore' });
          gitChild.on('close', (code) => {
            if (code !== 0) return;
            const inv = cliScanInvocation(cloneDir);
            const scanChild = spawn(inv.cmd, inv.args, { cwd: cloneDir, detached: true, stdio: 'ignore' });
            scanChild.on('error', (err: Error) => { process.stderr.write(`[sprang] analyze scan failed: ${err.message}\n`); });
            scanChild.unref();
          });
        }).catch(() => {/* ignore */});
        return;
      }

      if (params.path) {
        const resolved = path.resolve(params.path);
        if (!fs.existsSync(resolved)) { res.statusCode = 400; res.end(JSON.stringify({ error: `Path not found: ${resolved}` })); return; }
        updateRoot(resolved);
        allowlistCache = null;
      }

      const sprangRoot = getRoot();
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true, started: true, mode: 'local', root: sprangRoot }));
      import('node:child_process').then(({ spawn }) => {
        const inv = cliScanInvocation(sprangRoot);
        const child = spawn(inv.cmd, inv.args, { cwd: sprangRoot, detached: true, stdio: 'ignore' });
        child.on('error', (err: Error) => { process.stderr.write(`[sprang] analyze scan failed: ${err.message}\n`); });
        child.unref();
      }).catch(() => {/* ignore */});
    });
  });

  // GET /analyze-status
  register('/analyze-status', (_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    const progressPath = path.join(getRoot(), '.sprang', 'intermediate', 'phase2-progress.json');
    if (fs.existsSync(progressPath)) {
      try { res.statusCode = 200; res.end(fs.readFileSync(progressPath)); }
      catch { res.statusCode = 500; res.end(JSON.stringify({ error: 'Failed to read progress' })); }
    } else {
      res.statusCode = 204; res.end();
    }
  });

  // GET /health-history.json
  register('/health-history.json', (_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const historyPath = path.join(getRoot(), '.sprang', 'history.json');
    if (fs.existsSync(historyPath)) {
      try { res.statusCode = 200; res.end(fs.readFileSync(historyPath)); }
      catch { res.statusCode = 500; res.end(JSON.stringify({ error: 'Failed to read history' })); }
    } else {
      res.statusCode = 200; res.end('[]');
    }
  });
}
