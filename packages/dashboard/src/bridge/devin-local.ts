/**
 * Devin local bridge — delivers a dashboard question into the Devin session
 * already running in your editor, with all of its context.
 *
 * How it works, and why it is done this way:
 *
 * The dashboard is an HTTP server; it cannot inject a message into a running
 * IDE conversation. Two routes were measured:
 *
 *   1. An editor extension calling `devin.sendChatActionMessage`. Reaches the
 *      chat *panel*, not this session. `explainAndFixProblem` opens a NEW
 *      conversation answered by Cascade; `codeBlockMention` does land in the
 *      current conversation but only inserts text — no command exists to submit
 *      the chat input, so it cannot be automatic. Worse, when both routes were
 *      live the extension won the race every time (it fires instantly, the hook
 *      waits for a turn boundary), so questions were silently answered by the
 *      wrong agent. The extension is therefore not used.
 *
 *   2. Devin lifecycle hooks, which run *inside* this session. A `Stop` hook
 *      returning `decision: "block"` hands the question to the agent when a turn
 *      ends; a `UserPromptSubmit` hook injects it the moment you type. Verified
 *      end-to-end: dashboard → question file → hook → this conversation →
 *      sprang_respond → dashboard.
 *
 * Route 2 wins on every axis: no install, full context, working MCP.
 *
 * Known limitation: a hook only runs when something happens. A question asked
 * while the session is completely idle waits for the next turn or keystroke.
 * Reaching a truly idle session is not possible with the APIs that exist.
 */

import fs from 'node:fs';
import path from 'node:path';

const HOOKS_FILE = path.join('.devin', 'hooks.v1.json');

/** Hook scripts that consume `.sprang/agent-question.md`. */
const QUESTION_HOOK_EVENTS = ['Stop', 'UserPromptSubmit'] as const;

interface HookEntry {
  hooks?: Array<{ command?: string }>;
}

/**
 * True when this project wires at least one hook that delivers dashboard
 * questions into the running Devin session.
 *
 * Deliberately checks the hook *configuration* rather than "am I inside Devin
 * Desktop": being in the IDE proves nothing if no hook is listening, and
 * selecting a bridge that cannot answer is worse than falling through to relay.
 */
export function isDevinLocalAvailable(sprangRoot: string): boolean {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(sprangRoot, HOOKS_FILE), 'utf-8')) as
      Record<string, HookEntry[] | undefined>;
    return QUESTION_HOOK_EVENTS.some((event) =>
      (cfg[event] ?? []).some((entry) =>
        (entry.hooks ?? []).some((h) => (h.command ?? '').includes('dashboard-question')),
      ),
    );
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
