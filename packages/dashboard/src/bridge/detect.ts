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

/** Returns true if the cascade-messaging Windsurf extension is active.
 *  Heuristic: check whether .cascade-trigger-session exists OR has been
 *  written in the last 60 s (extension is alive and watching). */
export function isWindsurfBridgeActive(sprangRoot: string): boolean {
  const triggerPath = path.join(sprangRoot, '.cascade-trigger-session');
  if (!fs.existsSync(triggerPath)) return false;
  try {
    const stat = fs.statSync(triggerPath);
    const ageMs = Date.now() - stat.mtimeMs;
    // File present and touched within last 60 s — extension is watching
    return ageMs < 60_000;
  } catch {
    return false;
  }
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
