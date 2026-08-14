#!/usr/bin/env bash
# Sprang Stop hook — deliver a pending dashboard question into THIS session.
#
# Why this exists: the dashboard cannot push into a running IDE agent. The
# bridge extension can only reach the *chat panel* (Cascade) via
# devin.sendChatActionMessage, which opens a separate conversation with none of
# this session's context. A Stop hook runs inside the Devin session itself, so
# the question is answered by the agent you are already talking to — with its
# full context, rules, and MCP tools.
#
# Mechanism: when the agent finishes a turn, Devin runs this hook. Returning
# `{"decision":"block","reason":...}` makes the agent keep going and address the
# reason, so the pending question becomes its next piece of work.
#
# Trade-off, stated plainly: this is not a true async push. It fires when a turn
# ends, so a question asked while the session sits idle waits until the next
# turn. That is the cost of needing no extension and staying in-context.
#
# Loop safety matters more than delivery here: the question file is consumed
# (renamed) BEFORE the block is emitted, so a question can never be re-delivered
# and the agent cannot be trapped in a stop loop. `stop_hook_active` is honoured
# as a second guard.

set -uo pipefail

PAYLOAD=$(cat 2>/dev/null || echo "")

PROJECT_DIR="${DEVIN_PROJECT_DIR:-${CLAUDE_PROJECT_DIR:-$PWD}}"
cd "$PROJECT_DIR" 2>/dev/null || exit 0

QUESTION_FILE=".sprang/agent-question.md"
[ -f "$QUESTION_FILE" ] || exit 0

# Never stack on top of another stop hook that is already steering the agent.
if printf '%s' "$PAYLOAD" | grep -q '"stop_hook_active"[[:space:]]*:[[:space:]]*true'; then
  exit 0
fi

# Consume first. If anything below fails, the worst case is a lost question —
# far better than an agent that cannot stop.
CONSUMED=".sprang/agent-question.delivered.md"
mv -f "$QUESTION_FILE" "$CONSUMED" 2>/dev/null || exit 0

QUESTION=$(cat "$CONSUMED" 2>/dev/null)
[ -n "$QUESTION" ] || exit 0

node -e '
  const reason = process.argv[1];
  process.stdout.write(JSON.stringify({ decision: "block", reason }));
' "$QUESTION" 2>/dev/null || {
  # Without node we cannot emit valid JSON; put the question back for the
  # extension or the user rather than dropping it.
  mv -f "$CONSUMED" "$QUESTION_FILE" 2>/dev/null
  exit 0
}

exit 0
