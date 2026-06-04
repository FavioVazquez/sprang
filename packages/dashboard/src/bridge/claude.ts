/**
 * Claude Code bridge — sends a question to `claude -p` non-interactively
 * and returns the text response.
 *
 * Session continuity: the session_id from the first call is persisted to
 * .sprang/claude-session.json and reused via --resume on subsequent calls,
 * giving the user a continuous conversation thread.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const SESSION_FILE = '.sprang/claude-session.json';
const CLAUDE_TIMEOUT_MS = 120_000; // 2 min max per call

/** MCP tools sprang is allowed to use. Listed explicitly so we don't
 *  accidentally grant broader permissions than needed. */
const ALLOWED_MCP_TOOLS = [
  'mcp__sprang__sprang_query',
  'mcp__sprang__sprang_node',
  'mcp__sprang__sprang_diff_impact',
  'mcp__sprang__sprang_tour',
  'mcp__sprang__sprang_domain',
  'mcp__sprang__sprang_health',
  'mcp__sprang__sprang_why',
  'mcp__sprang__sprang_annotate',
].join(',');

interface ClaudeJsonOutput {
  type?: string;
  result?: string;
  session_id?: string;
  error?: string;
}

interface SessionData {
  session_id: string;
  created_at: string;
}

function loadSessionId(sprangRoot: string): string | null {
  const sessionFile = path.join(sprangRoot, SESSION_FILE);
  try {
    const data = JSON.parse(fs.readFileSync(sessionFile, 'utf-8')) as SessionData;
    return data.session_id ?? null;
  } catch {
    return null;
  }
}

function saveSessionId(sprangRoot: string, sessionId: string): void {
  const sessionFile = path.join(sprangRoot, SESSION_FILE);
  const dir = path.dirname(sessionFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const data: SessionData = { session_id: sessionId, created_at: new Date().toISOString() };
  const tmp = sessionFile + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, sessionFile);
}

export type ClaudeAskResult =
  | { ok: true; response: string; session_id: string }
  | { ok: false; error: string };

/**
 * Send a question to Claude Code non-interactively.
 * Uses --resume <session_id> if a prior session exists, otherwise starts fresh.
 * Persists the resulting session_id for the next call.
 */
export function askClaude(question: string, sprangRoot: string): ClaudeAskResult {
  const sessionId = loadSessionId(sprangRoot);

  const prompt = `You are answering a question from the Sprang dashboard about this codebase.
Use the available MCP tools (sprang_query, sprang_node, sprang_health, etc.) to ground your answer in the knowledge graph.
Be concise — this answer will be displayed in a small chat panel.

Question: ${question}`;

  const args = [
    '-p', prompt,
    '--output-format', 'json',
    '--allowedTools', ALLOWED_MCP_TOOLS,
    '--no-interactive',
  ];

  if (sessionId) {
    args.push('--resume', sessionId);
  }

  let result: ReturnType<typeof spawnSync>;
  try {
    result = spawnSync('claude', args, {
      cwd: sprangRoot,
      timeout: CLAUDE_TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024, // 10 MB
      encoding: 'utf-8',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `claude CLI error: ${msg}` };
  }

  if (result.error) {
    return { ok: false, error: `claude CLI error: ${result.error.message}` };
  }

  if (result.status !== 0) {
    const stderr = (result.stderr ?? '').slice(0, 500);
    return { ok: false, error: `claude exited with code ${result.status}: ${stderr}` };
  }

  const stdout = (String(result.stdout ?? '')).trim();
  if (!stdout) {
    return { ok: false, error: 'claude returned empty output' };
  }

  // claude --output-format json emits a JSON object per line; take the last one
  // that has type == "result"
  let parsed: ClaudeJsonOutput | null = null;
  for (const line of stdout.split('\n').reverse()) {
    try {
      const obj = JSON.parse(line) as ClaudeJsonOutput;
      if (obj.type === 'result' || obj.result !== undefined) {
        parsed = obj;
        break;
      }
    } catch {
      // skip non-JSON lines
    }
  }

  if (!parsed) {
    // Fallback: treat entire stdout as plain text response
    return {
      ok: true,
      response: stdout,
      session_id: sessionId ?? 'unknown',
    };
  }

  if (parsed.error) {
    return { ok: false, error: parsed.error };
  }

  const response = parsed.result ?? stdout;
  const newSessionId = parsed.session_id ?? sessionId ?? 'unknown';

  if (parsed.session_id) {
    saveSessionId(sprangRoot, parsed.session_id);
  }

  return { ok: true, response, session_id: newSessionId };
}

/** Clear the persisted session so the next question starts a fresh conversation. */
export function clearClaudeSession(sprangRoot: string): void {
  const sessionFile = path.join(sprangRoot, SESSION_FILE);
  if (fs.existsSync(sessionFile)) fs.unlinkSync(sessionFile);
}
