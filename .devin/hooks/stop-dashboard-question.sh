#!/usr/bin/env bash
# Sprang Stop hook — deliver a pending dashboard question into THIS session, and
# optionally keep listening for a short while so no typing is needed at all.
#
# Background: nothing outside the editor can start a turn. There is no command
# that submits the chat input, hooks only run on events, and the CLI refuses to
# resume a session the IDE holds a lock on. So the only moment this session can
# pick up a dashboard question is when *something happens* — and the last thing
# that happens is the agent finishing a turn.
#
# That is what this exploits. When a turn ends:
#
#   - If a question is already waiting, deliver it immediately.
#   - Otherwise, if the dashboard says someone is actively using the Ask Agent
#     panel (a heartbeat file refreshed while it is open), wait a little for a
#     question to arrive and deliver it the moment it does. No typing required.
#   - If the dashboard is not open, return instantly and stay out of the way.
#
# The heartbeat gate is the whole trick: holding the turn open is only
# acceptable while you are actually sitting in the dashboard waiting for an
# answer. During ordinary work the panel is closed, no heartbeat is written, and
# this hook costs nothing.
#
# Returning `{"decision":"block","reason":...}` hands the question to the agent
# as its next piece of work.
#
# Loop safety: the question file is consumed (renamed) BEFORE the block is
# emitted, so a question can never be delivered twice and the agent cannot be
# trapped in a stop loop. `stop_hook_active` is honoured as a second guard.

set -uo pipefail

PAYLOAD=$(cat 2>/dev/null || echo "")

PROJECT_DIR="${DEVIN_PROJECT_DIR:-${CLAUDE_PROJECT_DIR:-$PWD}}"
cd "$PROJECT_DIR" 2>/dev/null || exit 0

QUESTION_FILE=".sprang/agent-question.md"
CONSUMED=".sprang/agent-question.delivered.md"
HEARTBEAT=".sprang/.dashboard-listening"

# Never stack on top of another stop hook that is already steering the agent.
if printf '%s' "$PAYLOAD" | grep -q '"stop_hook_active"[[:space:]]*:[[:space:]]*true'; then
  exit 0
fi

# How long to hold the turn open while the dashboard is in use, and how fresh
# the heartbeat must be to count as "in use". Both overridable for testing.
LISTEN_SECONDS="${SPRANG_LISTEN_SECONDS:-45}"
HEARTBEAT_MAX_AGE="${SPRANG_HEARTBEAT_MAX_AGE:-20}"

heartbeat_is_fresh() {
  [ -f "$HEARTBEAT" ] || return 1
  local age
  age=$(( $(date +%s) - $(date -r "$HEARTBEAT" +%s 2>/dev/null || echo 0) ))
  [ "$age" -le "$HEARTBEAT_MAX_AGE" ]
}

deliver() {
  mv -f "$QUESTION_FILE" "$CONSUMED" 2>/dev/null || return 1
  local question
  question=$(cat "$CONSUMED" 2>/dev/null)
  [ -n "$question" ] || return 1
  node -e '
    process.stdout.write(JSON.stringify({ decision: "block", reason: process.argv[1] }));
  ' "$question" 2>/dev/null || {
    # Without node we cannot emit valid JSON; put the question back rather than
    # dropping it, so the extension-free relay path can still show it.
    mv -f "$CONSUMED" "$QUESTION_FILE" 2>/dev/null
    return 1
  }
  return 0
}

# Already waiting → deliver now.
if [ -f "$QUESTION_FILE" ]; then
  deliver && exit 0
  exit 0
fi

# Nothing pending and nobody watching → get out of the way immediately.
heartbeat_is_fresh || exit 0

# Someone is sitting in the dashboard: stay listening briefly so their next
# question is answered without them having to come back here and type.
deadline=$(( $(date +%s) + LISTEN_SECONDS ))
while [ "$(date +%s)" -lt "$deadline" ]; do
  if [ -f "$QUESTION_FILE" ]; then
    deliver && exit 0
    exit 0
  fi
  # Stop early if the dashboard is closed mid-wait.
  heartbeat_is_fresh || exit 0
  sleep 1
done

exit 0
