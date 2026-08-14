/**
 * Bridge detection — determines how the dashboard can reach an AI agent.
 *
 * Priority order:
 *  1. devin-local — a Devin session in the surrounding IDE, reachable through
 *                   the Sprang Devin Bridge extension. First because it is
 *                   already authenticated: it needs no second login, unlike the
 *                   CLI, whose credential store is separate from the IDE's.
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
    return { kind: 'devin-local', detail: 'Devin local session (Sprang Devin Bridge extension active)' };
  }
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
    detail: isInsideDevinDesktop()
      ? 'Running inside Devin Desktop, but the Sprang Devin Bridge extension is not active — ' +
        'install it to push questions straight into Devin, or copy the question across manually. ' +
        'Either way Devin answers via the sprang_respond MCP tool.'
      : 'No agent CLI detected. Copy the question into your agent (Devin Desktop, Cursor, …) — ' +
        'it will answer via the sprang_respond MCP tool and the reply appears here.',
  };
}
