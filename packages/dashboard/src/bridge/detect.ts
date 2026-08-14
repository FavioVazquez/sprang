/**
 * Bridge detection — determines how the dashboard can reach an AI agent.
 *
 * Priority order:
 *  1. devin-local — the Devin session already running in your editor, reached
 *                   through the Stop / UserPromptSubmit hooks. First because it
 *                   is already authenticated and already has your context: no
 *                   second login, no extension, no new conversation.
 *  2. devin       — `devin` CLI on PATH and authenticated
 *  3. claude      — `claude` CLI available (Claude Code)
 *  4. copilot     — `copilot` CLI available (GitHub Copilot CLI)
 *  5. relay       — nothing drivable; the user pastes the question themselves
 *
 * Every option below the first converges on the same response file, so the
 * dashboard's polling path never changes. `relay` is always reachable, so
 * there is no "no bridge" state.
 */

import { execFileSync } from 'node:child_process';
import { isDevinCLIAvailable } from './devin.js';
import { isDevinLocalAvailable, isInsideDevinDesktop } from './devin-local.js';

export type BridgeKind = 'devin-local' | 'devin' | 'claude' | 'copilot' | 'relay';

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

export { isDevinCLIAvailable, isDevinLocalAvailable };

/** Detect the best available bridge. */
export function detectBridge(sprangRoot: string): BridgeStatus {
  if (isDevinLocalAvailable(sprangRoot)) {
    return {
      kind: 'devin-local',
      detail: 'Devin session in your editor — delivered by the Sprang lifecycle hooks',
    };
  }
  if (isDevinCLIAvailable()) {
    return {
      kind: 'devin',
      detail: process.env['WINDSURF_API_KEY']
        ? 'devin CLI authenticated via WINDSURF_API_KEY (same account as the IDE)'
        : 'devin CLI available',
    };
  }
  if (isClaudeCLIAvailable()) {
    return { kind: 'claude', detail: 'claude CLI available' };
  }
  if (isCopilotCLIAvailable()) {
    return { kind: 'copilot', detail: 'copilot CLI available' };
  }
  return {
    kind: 'relay',
    detail: isInsideDevinDesktop()
      ? 'Running inside Devin Desktop, but no dashboard-question hook is configured — ' +
        'run `sprang init --platform devin` to install it, or copy the question across ' +
        'manually. Either way Devin answers via the sprang_respond MCP tool.'
      : 'No agent CLI detected. Copy the question into your agent (Devin Desktop, Cursor, …) — ' +
        'it will answer via the sprang_respond MCP tool and the reply appears here.',
  };
}
