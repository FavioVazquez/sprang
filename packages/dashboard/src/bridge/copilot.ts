/**
 * Copilot CLI bridge — sends a question to `copilot -p` non-interactively
 * and returns the text response.
 *
 * Copilot CLI uses `copilot -p "question"` for non-interactive mode.
 * Session continuity: `copilot --continue` resumes the most recent session.
 * Output is plain text (not JSON like Claude Code).
 *
 * Docs: https://docs.github.com/en/copilot/how-tos/copilot-cli/automate-copilot-cli/quickstart
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const SESSION_FILE = '.sprang/copilot-session.json';
const COPILOT_TIMEOUT_MS = 120_000; // 2 min max

interface CopilotSessionData {
  has_session: boolean;
  created_at: string;
}

function loadHasSession(sprangRoot: string): boolean {
  const sessionFile = path.join(sprangRoot, SESSION_FILE);
  try {
    const data = JSON.parse(fs.readFileSync(sessionFile, 'utf-8')) as CopilotSessionData;
    return data.has_session === true;
  } catch {
    return false;
  }
}

function saveHasSession(sprangRoot: string): void {
  const sessionFile = path.join(sprangRoot, SESSION_FILE);
  const dir = path.dirname(sessionFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const data: CopilotSessionData = { has_session: true, created_at: new Date().toISOString() };
  const tmp = sessionFile + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, sessionFile);
}

export type CopilotAskResult =
  | { ok: true; response: string }
  | { ok: false; error: string };

/**
 * Send a question to Copilot CLI non-interactively.
 * Uses --continue when a prior session exists, otherwise starts fresh.
 */
export function askCopilot(question: string, sprangRoot: string): CopilotAskResult {
  const hasSession = loadHasSession(sprangRoot);

  const prompt = `You are answering a question from the Sprang dashboard about this codebase.
Use the available MCP tools (sprang_query, sprang_node, sprang_health, etc.) to ground your answer in the knowledge graph.
Be concise — this answer will be displayed in a small chat panel.

Question: ${question}`;

  const args = ['-p', prompt];
  if (hasSession) {
    args.push('--continue');
  }

  const result = spawnSync('copilot', args, {
    cwd: sprangRoot,
    timeout: COPILOT_TIMEOUT_MS,
    maxBuffer: 10 * 1024 * 1024,
    encoding: 'utf-8',
  });

  if (result.error) {
    return { ok: false, error: `copilot CLI error: ${result.error.message}` };
  }

  if (result.status !== 0) {
    const stderr = (result.stderr ?? '').slice(0, 500);
    return { ok: false, error: `copilot exited with code ${result.status}: ${stderr}` };
  }

  const response = (result.stdout ?? '').trim();
  if (!response) {
    return { ok: false, error: 'copilot returned empty output' };
  }

  saveHasSession(sprangRoot);
  return { ok: true, response };
}

/** Clear the persisted session marker. */
export function clearCopilotSession(sprangRoot: string): void {
  const sessionFile = path.join(sprangRoot, SESSION_FILE);
  if (fs.existsSync(sessionFile)) fs.unlinkSync(sessionFile);
}
