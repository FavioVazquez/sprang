/**
 * Copilot CLI bridge — sends a question to `copilot -p` non-interactively
 * and returns the text response.
 *
 * Flags (verified against copilot CLI v1.0.59):
 *   -p / --prompt <text>   non-interactive mode, exits after completion
 *   --output-format json   JSONL output (one JSON object per line)
 *   --resume=<session-id>  resume a specific prior session by ID
 *
 * Session continuity: session_id is parsed from JSONL output and persisted
 * to .sprang/copilot-session.json, then passed via --resume=<id> on the
 * next call. Falls back to plain-text output if JSONL parsing fails.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const SESSION_FILE = '.sprang/copilot-session.json';
const COPILOT_TIMEOUT_MS = 120_000; // 2 min max

interface CopilotSessionData {
  session_id: string;
  created_at: string;
}

interface CopilotJsonLine {
  type?: string;
  session_id?: string;
  message?: { content?: string };
  text?: string;
}

function loadSessionId(sprangRoot: string): string | null {
  const sessionFile = path.join(sprangRoot, SESSION_FILE);
  try {
    const data = JSON.parse(fs.readFileSync(sessionFile, 'utf-8')) as CopilotSessionData;
    return data.session_id ?? null;
  } catch {
    return null;
  }
}

function saveSessionId(sprangRoot: string, sessionId: string): void {
  const sessionFile = path.join(sprangRoot, SESSION_FILE);
  const dir = path.dirname(sessionFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const data: CopilotSessionData = { session_id: sessionId, created_at: new Date().toISOString() };
  const tmp = sessionFile + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, sessionFile);
}

export type CopilotAskResult =
  | { ok: true; response: string; session_id?: string }
  | { ok: false; error: string };

/**
 * Send a question to Copilot CLI non-interactively.
 * Uses --resume=<session_id> when a prior session exists, otherwise starts fresh.
 */
export function askCopilot(question: string, sprangRoot: string): CopilotAskResult {
  const sessionId = loadSessionId(sprangRoot);

  const prompt = `You are answering a question from the Sprang dashboard about this codebase.
Use the available MCP tools (sprang_query, sprang_node, sprang_health, etc.) to ground your answer in the knowledge graph.
Be concise — this answer will be displayed in a small chat panel.

Question: ${question}`;

  const args = ['--prompt', prompt, '--output-format', 'json'];
  if (sessionId) {
    args.push(`--resume=${sessionId}`);
  }

  let result: ReturnType<typeof spawnSync>;
  try {
    result = spawnSync('copilot', args, {
      cwd: sprangRoot,
      timeout: COPILOT_TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024,
      encoding: 'utf-8',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `copilot CLI error: ${msg}` };
  }

  if (result.error) {
    return { ok: false, error: `copilot CLI error: ${result.error.message}` };
  }

  if (result.status !== 0) {
    const stderr = String(result.stderr ?? '').slice(0, 500);
    return { ok: false, error: `copilot exited with code ${result.status}: ${stderr}` };
  }

  const stdout = String(result.stdout ?? '').trim();
  if (!stdout) {
    return { ok: false, error: 'copilot returned empty output' };
  }

  // Parse JSONL — collect text/message lines and find session_id
  let responseText = '';
  let parsedSessionId: string | undefined;
  const textParts: string[] = [];

  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed) as CopilotJsonLine;
      if (obj.session_id) parsedSessionId = obj.session_id;
      // Collect assistant message content
      if (obj.message?.content) textParts.push(obj.message.content);
      else if (obj.text) textParts.push(obj.text);
    } catch {
      // non-JSON line — treat as plain text output
      textParts.push(trimmed);
    }
  }

  responseText = textParts.join('\n').trim() || stdout;

  if (parsedSessionId) {
    saveSessionId(sprangRoot, parsedSessionId);
  }

  return { ok: true, response: responseText, session_id: parsedSessionId };
}

/** Clear the persisted session marker. */
export function clearCopilotSession(sprangRoot: string): void {
  const sessionFile = path.join(sprangRoot, SESSION_FILE);
  if (fs.existsSync(sessionFile)) fs.unlinkSync(sessionFile);
}
