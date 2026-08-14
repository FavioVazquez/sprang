/**
 * Unified agent bridge entry point.
 *
 * askAgent() picks a bridge at call time and normalises every outcome onto the
 * same file: `.sprang/cascade-response.json`. The dashboard polls that one path
 * regardless of which agent answered.
 *
 *   devin / claude / copilot — spawn the CLI, write the response file
 *   relay                    — stage the question for the user's own agent,
 *                              which answers via the sprang_respond MCP tool
 */

import fs from 'node:fs';
import path from 'node:path';
import { detectBridge, listBridges, type BridgeStatus, type BridgeKind, type BridgeOption } from './detect.js';
import { askClaude, clearClaudeSession } from './claude.js';
import { askCopilot, clearCopilotSession } from './copilot.js';
import { askDevin, clearDevinSession } from './devin.js';
import { writeRelayQuestion, getResponsePath, getRelayQuestionPath } from './relay.js';

export { detectBridge, listBridges, clearClaudeSession, clearCopilotSession, clearDevinSession, getResponsePath };
export type { BridgeStatus, BridgeKind, BridgeOption };

export type AskAgentMode = 'async' | 'sync';

export interface AskAgentResult {
  /** 'async': the answer will arrive later via /agent-response polling (relay).
   *  'sync':  the answer is already written to cascade-response.json (CLI bridges). */
  mode: AskAgentMode;
  ok: boolean;
  bridge: BridgeKind;
  error?: string;
  /** For the relay bridge: the exact text to paste into an agent. */
  prompt?: string;
}

function writeResponse(
  responsePath: string,
  payload: Record<string, unknown>,
): void {
  fs.mkdirSync(path.dirname(responsePath), { recursive: true });
  const tmp = responsePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf-8');
  fs.renameSync(tmp, responsePath);
}

/**
 * Send a question to an agent bridge.
 *
 * `preferred` comes from the dashboard's picker. It is honoured only if that
 * bridge is actually available — an explicit choice should not silently send a
 * question into a void when the CLI behind it is missing or logged out.
 */
export function askAgent(question: string, sprangRoot: string, preferred?: BridgeKind): AskAgentResult {
  const chosen = preferred
    ? listBridges(sprangRoot).find((b) => b.kind === preferred && b.available)
    : undefined;
  const bridge: BridgeStatus = chosen
    ? { kind: chosen.kind, detail: chosen.detail }
    : detectBridge(sprangRoot);
  const responsePath = getResponsePath(sprangRoot);

  // Drop any previous answer so polling can't return a stale one.
  if (fs.existsSync(responsePath)) {
    try { fs.unlinkSync(responsePath); } catch { /* ignore */ }
  }

  // devin-local and relay share one mechanism: stage the question file. The
  // only difference is who picks it up — the bridge extension, or the user.
  if (bridge.kind === 'devin-local' || bridge.kind === 'relay') {
    const prompt = writeRelayQuestion(question, sprangRoot);
    return { mode: 'async', ok: true, bridge: bridge.kind, prompt };
  }

  const ask = bridge.kind === 'devin' ? askDevin
    : bridge.kind === 'claude' ? askClaude
      : askCopilot;

  const result = ask(question, sprangRoot);
  if (!result.ok) {
    return { mode: 'sync', ok: false, bridge: bridge.kind, error: result.error };
  }

  writeResponse(responsePath, {
    response: result.response,
    question,
    written_at: new Date().toISOString(),
    bridge: bridge.kind,
    ...('session_id' in result && result.session_id ? { session_id: result.session_id } : {}),
  });
  return { mode: 'sync', ok: true, bridge: bridge.kind };
}

/** Clear conversation state for every bridge. */
export function clearAgentSession(sprangRoot: string): void {
  clearDevinSession(sprangRoot);
  clearClaudeSession(sprangRoot);
  clearCopilotSession(sprangRoot);
  for (const file of [getResponsePath(sprangRoot), getRelayQuestionPath(sprangRoot)]) {
    if (fs.existsSync(file)) {
      try { fs.unlinkSync(file); } catch { /* ignore */ }
    }
  }
}
