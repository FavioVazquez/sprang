/**
 * Bridge detection — determines how the dashboard can reach an AI agent.
 *
 * Priority order:
 *  1. devin    — `devin` CLI on PATH and authenticated
 *  2. claude   — `claude` CLI available (Claude Code)
 *  3. copilot  — `copilot` CLI available (GitHub Copilot CLI)
 *  4. relay    — no drivable CLI; the user relays the question to their agent,
 *                which answers via the `sprang_respond` MCP tool
 *
 * `relay` is always reachable, so there is no "no bridge" state: an IDE-hosted
 * agent (Devin Desktop, Cursor, …) has no CLI for the server to spawn but can
 * still answer through MCP.
 */

import { execFileSync } from 'node:child_process';
import { isDevinCLIAvailable } from './devin.js';

export type BridgeKind = 'devin' | 'claude' | 'copilot' | 'relay';

export interface BridgeStatus {
  kind: BridgeKind;
  detail: string;
}

/** Returns true if the `claude` CLI is available on PATH and responds. */
export function isClaudeCLIAvailable(): boolean {
  try {
    execFileSync('claude', ['--version'], { timeout: 3000, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/** Returns true if the GitHub Copilot CLI (`copilot`) is available on PATH. */
export function isCopilotCLIAvailable(): boolean {
  try {
    execFileSync('copilot', ['--version'], { timeout: 3000, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

export { isDevinCLIAvailable };

/** Detect the best available bridge. */
export function detectBridge(_sprangRoot: string): BridgeStatus {
  if (isDevinCLIAvailable()) {
    return { kind: 'devin', detail: 'devin CLI available' };
  }
  if (isClaudeCLIAvailable()) {
    return { kind: 'claude', detail: 'claude CLI available' };
  }
  if (isCopilotCLIAvailable()) {
    return { kind: 'copilot', detail: 'copilot CLI available' };
  }
  return {
    kind: 'relay',
    detail:
      'No agent CLI detected. Copy the question into your agent (Devin Desktop, Cursor, …) — ' +
      'it will answer via the sprang_respond MCP tool and the reply appears here.',
  };
}
