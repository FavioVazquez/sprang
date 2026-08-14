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

# Diagnostics. A hook that is never invoked, and one that is invoked and then
# killed by its timeout, look identical from the outside — both simply do
# nothing. Logging entry/exit is the only way to tell them apart.
HOOK_LOG="${SPRANG_HOOK_LOG:-$HOME/.sprang-hooks.log}"
hlog() { printf '[%s] stop-hook: %s\n' "$(date -Is)" "$1" >> "$HOOK_LOG" 2>/dev/null || true; }
trap 'hlog "exited (code=$?) after ${SECONDS}s"' EXIT

PAYLOAD=$(cat 2>/dev/null || echo "")
hlog "invoked"


PROJECT_DIR="${DEVIN_PROJECT_DIR:-${CLAUDE_PROJECT_DIR:-$PWD}}"
cd "$PROJECT_DIR" 2>/dev/null || exit 0

QUESTION_FILE=".sprang/agent-question.md"
CONSUMED=".sprang/agent-question.delivered.md"
HEARTBEAT=".sprang/.dashboard-listening"

# Never stack on top of another stop hook that is already steering the agent.
if printf '%s' "$PAYLOAD" | grep -q '"stop_hook_active"[[:space:]]*:[[:space:]]*true'; then
  exit 0
fi

# Two windows, because the panel is often opened *after* the agent goes quiet.
#
# GRACE_SECONDS: always wait this long, even with no heartbeat, so "stop talking
#   to Devin, switch to the dashboard, ask something" is covered. Kept short —
#   this is the only cost paid during ordinary work.
# LISTEN_SECONDS: once the panel is confirmed open, keep listening this long,
#   refreshed for as long as the heartbeat stays fresh. Ends the moment the
#   panel closes.
GRACE_SECONDS="${SPRANG_GRACE_SECONDS:-20}"
LISTEN_SECONDS="${SPRANG_LISTEN_SECONDS:-600}"
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
  hlog "question already pending — delivering"
  deliver
  exit 0
fi

# Listen. The deadline starts as a short grace period and is extended for as
# long as the dashboard keeps reporting that someone is waiting, so the window
# tracks actual use instead of a fixed guess.
now=$(date +%s)
deadline=$(( now + GRACE_SECONDS ))
hard_stop=$(( now + LISTEN_SECONDS ))

hlog "listening (grace=${GRACE_SECONDS}s, max=${LISTEN_SECONDS}s, heartbeat=$(heartbeat_is_fresh && echo fresh || echo none))"
while [ "$(date +%s)" -lt "$deadline" ]; do
  if [ -f "$QUESTION_FILE" ]; then
    hlog "question arrived after ${SECONDS}s — delivering"
    deliver
    exit 0
  fi
  if heartbeat_is_fresh; then
    # Panel is open: keep the window rolling, up to the hard stop.
    extended=$(( $(date +%s) + HEARTBEAT_MAX_AGE ))
    [ "$extended" -gt "$hard_stop" ] && extended=$hard_stop
    [ "$extended" -gt "$deadline" ] && deadline=$extended
  fi
  sleep 1
done

exit 0
