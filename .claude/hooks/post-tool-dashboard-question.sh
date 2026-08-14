#!/usr/bin/env bash
# Sprang PostToolUse hook — pick up a dashboard question while the agent works.
#
# Coverage, and why three hooks rather than one:
#
#   PostToolUse (this)  — fires after every tool call, so while the agent is
#                         doing anything at all a question is picked up within
#                         seconds. This is the widest net.
#   Stop                — listens for a window after a turn ends. Devin kills a
#                         hook at roughly two minutes regardless of the timeout
#                         configured, so that window is ~110s, not arbitrary.
#   UserPromptSubmit    — catch-all: whatever is still pending when you type.
#
# Together these cover everything except "the agent is idle and you never come
# back", which no API can reach.
#
# Injects via additionalContext rather than blocking: a tool call is in the
# middle of a turn, and derailing it would be worse than answering a moment
# later.

set -uo pipefail

cat >/dev/null 2>&1 || true   # drain stdin; the tool payload is not needed here

PROJECT_DIR="${DEVIN_PROJECT_DIR:-${CLAUDE_PROJECT_DIR:-$PWD}}"
cd "$PROJECT_DIR" 2>/dev/null || exit 0

QUESTION_FILE=".sprang/agent-question.md"
[ -f "$QUESTION_FILE" ] || exit 0

HOOK_LOG="${SPRANG_HOOK_LOG:-$HOME/.sprang-hooks.log}"
hlog() { printf '[%s] posttool-hook: %s\n' "$(date -Is)" "$1" >> "$HOOK_LOG" 2>/dev/null || true; }

# Consume before emitting so the question is delivered exactly once, whichever
# of the three hooks gets there first.
CONSUMED=".sprang/agent-question.delivered.md"
mv -f "$QUESTION_FILE" "$CONSUMED" 2>/dev/null || exit 0

QUESTION=$(cat "$CONSUMED" 2>/dev/null)
[ -n "$QUESTION" ] || exit 0
hlog "delivering a pending question mid-turn"

node -e '
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext:
        "A question is pending from the Sprang dashboard. Finish what you are doing, " +
        "then answer it and call the sprang_respond MCP tool so the answer reaches " +
        "the dashboard.\n\n" + process.argv[1],
    },
  }));
' "$QUESTION" 2>/dev/null || {
  mv -f "$CONSUMED" "$QUESTION_FILE" 2>/dev/null
  exit 0
}

exit 0
