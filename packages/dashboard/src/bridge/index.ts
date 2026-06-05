/**
 * Unified agent bridge entry point.
 *
 * askAgent() selects the right bridge at call time:
 *   - windsurf: write trigger file → extension picks up → async (poll /cascade-response)
 *   - claude:   spawn claude -p   → synchronous response → write cascade-response.json
 *   - none:     return error immediately
 */

import fs from 'node:fs';
import path from 'node:path';
import { detectBridge, type BridgeStatus } from './detect.js';
import { askClaude, clearClaudeSession } from './claude.js';
import { askCopilot, clearCopilotSession } from './copilot.js';
import {
  writeWindsurfTrigger,
  getWindsurfResponsePath,
} from './windsurf.js';

export { detectBridge, clearClaudeSession, clearCopilotSession };
export type { BridgeStatus };

export type AskAgentMode = 'async' | 'sync';

export interface AskAgentResult {
  /** 'async': response will arrive via /cascade-response polling (Windsurf).
   *  'sync':  response is already written to cascade-response.json (Claude). */
  mode: AskAgentMode;
  ok: boolean;
  error?: string;
}

/**
 * Send a question to the appropriate agent bridge.
 *
 * For the Windsurf bridge (async): writes the trigger file and returns
 * immediately — the dashboard polls /cascade-response.
 *
 * For the Claude bridge (sync): spawns `claude -p`, waits for the response,
 * writes it to cascade-response.json so the dashboard polling logic works
 * identically regardless of bridge type.
 */
export function askAgent(question: string, sprangRoot: string): AskAgentResult {
  const bridge = detectBridge(sprangRoot);

  // Clear any previous response
  const responsePath = getWindsurfResponsePath(sprangRoot);
  if (fs.existsSync(responsePath)) {
    try { fs.unlinkSync(responsePath); } catch { /* ignore */ }
  }

  if (bridge.kind === 'windsurf') {
    writeWindsurfTrigger(question, sprangRoot);
    return { mode: 'async', ok: true };
  }

  if (bridge.kind === 'copilot') {
    const result = askCopilot(question, sprangRoot);
    if (!result.ok) {
      return { mode: 'sync', ok: false, error: result.error };
    }
    const responsePayload = {
      response: result.response,
      question,
      written_at: new Date().toISOString(),
      bridge: 'copilot',
    };
    const dir = path.dirname(responsePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = responsePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(responsePayload, null, 2), 'utf-8');
    fs.renameSync(tmp, responsePath);
    return { mode: 'sync', ok: true };
  }

  if (bridge.kind === 'claude') {
    const result = askClaude(question, sprangRoot);
    if (!result.ok) {
      return { mode: 'sync', ok: false, error: result.error };
    }
    // Write in the same format sprang_respond MCP tool uses so the
    // dashboard polling code works without modification.
    const responsePayload = {
      response: result.response,
      question,
      written_at: new Date().toISOString(),
      bridge: 'claude',
      session_id: result.session_id,
    };
    const dir = path.dirname(responsePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = responsePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(responsePayload, null, 2), 'utf-8');
    fs.renameSync(tmp, responsePath);
    return { mode: 'sync', ok: true };
  }

  return { mode: 'sync', ok: false, error: bridge.detail };
}

/** Clear conversation state for all bridges. */
export function clearAgentSession(sprangRoot: string): void {
  clearClaudeSession(sprangRoot);
  clearCopilotSession(sprangRoot);
  const responsePath = getWindsurfResponsePath(sprangRoot);
  if (fs.existsSync(responsePath)) {
    try { fs.unlinkSync(responsePath); } catch { /* ignore */ }
  }
}
