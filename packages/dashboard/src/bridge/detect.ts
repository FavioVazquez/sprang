/**
 * Bridge detection — determines which agent bridge is available at runtime.
 *
 * Priority order:
 *  1. windsurf  — cascade-messaging extension watching .cascade-trigger-session
 *  2. claude    — `claude` CLI available (Claude Code)
 *  3. copilot   — `copilot` CLI available (GitHub Copilot CLI)
 *  4. none      — no bridge; user must ask their agent directly
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export type BridgeKind = 'windsurf' | 'claude' | 'copilot' | 'none';

export interface BridgeStatus {
  kind: BridgeKind;
  detail: string;
}

/** Returns true if running inside Windsurf / Devin Desktop.
 *
 *  Detection signals (any one is sufficient):
 *  1. WINDSURF_CASCADE_TERMINAL_KIND env var — present when Vite is launched from a
 *     Windsurf/Devin Desktop terminal (the most reliable signal when available).
 *  2. .sprang/.cascade-bridge-active marker — written by the cascade-messaging extension
 *     on activation, deleted on deactivation. Works even when the server was started
 *     outside the IDE terminal (e.g. via a script or system service).
 *  3. .cascade-trigger-session exists — legacy fallback (extension wrote it previously). */
export function isWindsurfBridgeActive(sprangRoot: string): boolean {
  if (process.env['WINDSURF_CASCADE_TERMINAL_KIND'] !== undefined) return true;
  if (fs.existsSync(path.join(sprangRoot, '.sprang', '.cascade-bridge-active'))) return true;
  return fs.existsSync(path.join(sprangRoot, '.cascade-trigger-session'));
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

/** Detect the best available bridge. */
export function detectBridge(sprangRoot: string): BridgeStatus {
  // 1. Windsurf extension (real-time, no CLI needed)
  if (isWindsurfBridgeActive(sprangRoot)) {
    return { kind: 'windsurf', detail: 'cascade-messaging extension active' };
  }
  // 2. Claude Code CLI
  if (isClaudeCLIAvailable()) {
    return { kind: 'claude', detail: 'claude CLI available' };
  }
  // 3. GitHub Copilot CLI
  if (isCopilotCLIAvailable()) {
    return { kind: 'copilot', detail: 'copilot CLI available' };
  }
  // 4. No bridge
  return {
    kind: 'none',
    detail:
      'No agent bridge found. Windsurf: install cascade-messaging extension. Claude Code: install claude CLI. Copilot: install GitHub Copilot CLI.',
  };
}
