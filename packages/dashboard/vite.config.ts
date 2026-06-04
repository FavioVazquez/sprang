import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const MAX_SOURCE_FILE_BYTES = 1024 * 1024; // 1 MB cap for source files

// Allowlist cache — rebuilt only when knowledge-graph.json mtime changes
let allowlistCache: Set<string> | null = null;
let allowlistCacheMtime = 0;

function getSprangRoot(): string {
  return process.env['SPRANG_ROOT'] ?? process.cwd();
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
// Cascade Bridge helpers
// ---------------------------------------------------------------------------
function getTriggerFilePath(): string {
  // Use .cascade-trigger-session (cascade-messaging extension) for session continuity.
  // cascade-bridge still watches .cascade-trigger — both can coexist.
  return path.join(getSprangRoot(), '.cascade-trigger-session');
}

function getResponseFilePath(): string {
  return path.join(getSprangRoot(), '.sprang', 'cascade-response.json');
}

/** Write a message to .cascade-trigger so the cascade-bridge extension picks it up */
function writeCascadeTrigger(message: string): void {
  const tmp = getTriggerFilePath() + '.tmp';
  fs.writeFileSync(tmp, message, 'utf-8');
  fs.renameSync(tmp, getTriggerFilePath());
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

  // POST /cascade-ask  { "message": "..." }
  // Writes the message to .cascade-trigger so cascade-bridge picks it up.
  server.middlewares.use('/cascade-ask', (req: import('http').IncomingMessage, res: import('http').ServerResponse) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
    if (req.method !== 'POST') { res.statusCode = 405; res.end(JSON.stringify({ error: 'POST only' })); return; }

    const MAX_BODY_BYTES = 64 * 1024; // 64 KB hard cap — protects against memory exhaustion
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
        const userMessage = message.trim().slice(0, 4096); // cap at 4096 chars for trigger file
        // Clear previous response before asking
        const responsePath = getResponseFilePath();
        if (fs.existsSync(responsePath)) fs.unlinkSync(responsePath);

        // Wrap with mandatory instruction so Cascade always calls sprang_respond
        const triggerMessage = `[SPRANG DASHBOARD MESSAGE — you MUST call the sprang_respond MCP tool with your answer when done, so it appears in the dashboard]

Question: ${userMessage}

After answering, call sprang_respond with: { "response": "<your answer>", "question": "${userMessage.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}" }`;
        writeCascadeTrigger(triggerMessage);
        res.statusCode = 200;
        res.end(JSON.stringify({ ok: true, sent: userMessage }));
      } catch {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      }
    });
  });

  // GET /cascade-response
  // Polls for the response written by the sprang_respond MCP tool.
  server.middlewares.use('/cascade-response', (req: import('http').IncomingMessage, res: import('http').ServerResponse) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'DELETE') {
      const responsePath = getResponseFilePath();
      if (fs.existsSync(responsePath)) fs.unlinkSync(responsePath);
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
  server: {
    port: 7338,
  },
  preview: {
    port: 7777,
    host: '127.0.0.1',
  },
});
