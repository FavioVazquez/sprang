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

export interface BridgeOption {
  kind: BridgeKind;
  /** Whether this bridge can actually answer right now. */
  available: boolean;
  detail: string;
  /** Human label for the picker. */
  label: string;
}

const LABELS: Record<BridgeKind, string> = {
  'devin-local': 'Devin (this editor session)',
  devin: 'Devin CLI',
  claude: 'Claude Code',
  copilot: 'Copilot CLI',
  relay: 'Copy / paste',
};

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

/**
 * Every bridge and whether it can answer right now.
 *
 * Auto-selection alone is not enough: a machine can easily have Devin, Claude
 * and Copilot installed at once, and picking by fixed priority silently routes
 * a question to an agent the user did not intend — or, worse, to one whose
 * credentials have quietly expired. The dashboard shows this list so the choice
 * is explicit and the reason a bridge is unavailable is visible.
 */
export function listBridges(sprangRoot: string): BridgeOption[] {
  const devinLocal = isDevinLocalAvailable(sprangRoot);
  const devinCli = isDevinCLIAvailable();
  const claude = isClaudeCLIAvailable();
  const copilot = isCopilotCLIAvailable();

  return [
    {
      kind: 'devin-local',
      available: devinLocal,
      label: LABELS['devin-local'],
      detail: devinLocal
        ? 'Answered in your editor session, with its full context'
        : 'No dashboard-question hook configured — run `sprang init --platform devin`',
    },
    {
      kind: 'devin',
      available: devinCli,
      label: LABELS.devin,
      detail: devinCli
        ? (process.env['WINDSURF_API_KEY'] ? 'Authenticated via WINDSURF_API_KEY' : 'Authenticated CLI on PATH')
        : 'Not installed, or not logged in (`devin auth login`, or export WINDSURF_API_KEY)',
    },
    {
      kind: 'claude',
      available: claude,
      label: LABELS.claude,
      detail: claude ? 'claude CLI on PATH' : 'claude CLI not found',
    },
    {
      kind: 'copilot',
      available: copilot,
      label: LABELS.copilot,
      detail: copilot ? 'copilot CLI on PATH' : 'copilot CLI not found',
    },
    {
      kind: 'relay',
      available: true,
      label: LABELS.relay,
      detail: 'Always available — you paste the question into any agent',
    },
  ];
}

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
