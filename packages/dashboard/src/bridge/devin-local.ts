/**
 * Devin local bridge — pushes a question into the authenticated Devin session
 * running in the surrounding IDE (Devin Desktop).
 *
 * This is the *only* bridge that reaches an IDE-hosted agent. The others spawn
 * a CLI, which Devin local is not: its credentials live in the IDE, not in the
 * CLI credential store (`devin auth status` reports "Not logged in" even while
 * Devin Desktop is signed in and working). The only entry point is the VS Code
 * command `devin.sendChatActionMessage`, which nothing outside the editor can
 * invoke — hence the companion extension.
 *
 * Protocol, deliberately identical to the manual relay:
 *   dashboard → .sprang/agent-question.md → extension → Devin chat
 *   Devin → sprang_respond MCP tool → .sprang/cascade-response.json → dashboard
 *
 * So the only thing the extension changes is who performs the paste. If it is
 * not installed, detection falls through and the user pastes the same file.
 */

import fs from 'node:fs';
import path from 'node:path';

/** Written by the extension on activation, removed on deactivation. */
const MARKER = path.join('.sprang', '.devin-bridge-active');

/** A marker left behind by a crashed window shouldn't strand every question. */
const MARKER_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * True when a Devin local session is present *and* can be pushed to.
 *
 * Both halves matter: `WINDSURF_IDE_TYPE` proves the dashboard was launched
 * from inside Devin Desktop, but without the extension there is nothing
 * listening, so we would select a bridge that can never answer. The marker is
 * therefore required; the env var alone is not enough.
 */
export function isDevinLocalAvailable(sprangRoot: string): boolean {
  const marker = path.join(sprangRoot, MARKER);
  try {
    const stat = fs.statSync(marker);
    return Date.now() - stat.mtimeMs < MARKER_MAX_AGE_MS;
  } catch {
    return false;
  }
}

/** True if this process was started from inside Devin Desktop / Windsurf. */
export function isInsideDevinDesktop(): boolean {
  return (
    process.env['WINDSURF_IDE_TYPE'] !== undefined ||
    process.env['WINDSURF_CASCADE_TERMINAL_KIND'] !== undefined
  );
}
