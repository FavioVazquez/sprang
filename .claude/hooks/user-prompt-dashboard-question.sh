#!/usr/bin/env bash
# Sprang UserPromptSubmit hook — flush a pending dashboard question as soon as
# you type anything, instead of waiting for the next turn to end.
#
# Companion to stop-dashboard-question.sh. Between them:
#   - Stop            → picked up when the agent finishes a turn
#   - UserPromptSubmit→ picked up the moment you send any message
#
# Together that covers every case except a session sitting completely idle with
# nobody typing, which cannot be reached without an editor extension.
#
# Unlike the Stop hook this must not block; it injects the question as extra
# context alongside whatever you actually typed.

set -uo pipefail

HOOK_LOG="${SPRANG_HOOK_LOG:-$HOME/.sprang-hooks.log}"
hlog() { printf '[%s] prompt-hook: %s\n' "$(date -Is)" "$1" >> "$HOOK_LOG" 2>/dev/null || true; }

cat >/dev/null 2>&1 || true   # drain stdin; the prompt text is not needed
hlog "invoked"

PROJECT_DIR="${DEVIN_PROJECT_DIR:-${CLAUDE_PROJECT_DIR:-$PWD}}"
cd "$PROJECT_DIR" 2>/dev/null || exit 0

QUESTION_FILE=".sprang/agent-question.md"
[ -f "$QUESTION_FILE" ] || exit 0

# Consume before emitting, so a question is delivered exactly once no matter
# which hook gets there first.
CONSUMED=".sprang/agent-question.delivered.md"
mv -f "$QUESTION_FILE" "$CONSUMED" 2>/dev/null || exit 0

QUESTION=$(cat "$CONSUMED" 2>/dev/null)
[ -n "$QUESTION" ] || exit 0
hlog "delivering a pending question"

node -e '
  const question = process.argv[1];
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext:
        "A question is pending from the Sprang dashboard. Answer it in addition to " +
        "the user\u2019s message, and finish by calling the sprang_respond MCP tool so the " +
        "answer reaches the dashboard.\n\n" + question,
    },
  }));
' "$QUESTION" 2>/dev/null || {
  mv -f "$CONSUMED" "$QUESTION_FILE" 2>/dev/null
  exit 0
}

exit 0
