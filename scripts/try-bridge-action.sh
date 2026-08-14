#!/usr/bin/env bash
# Probe how each chat action delivers a dashboard question.
#
# The Devin Desktop chat panel hosts several agents (Cascade, Devin local via
# ACP, …). `devin.sendChatActionMessage` posts to the panel, but which agent
# answers — and whether the message reuses the current conversation or opens a
# new one — depends on the action type. That is not documented anywhere, so the
# only way to know is to try each one and look.
#
# Usage:
#   scripts/try-bridge-action.sh <actionType> ["question"]
#   scripts/try-bridge-action.sh --command <vscode.command>
#   scripts/try-bridge-action.sh --list
#
# After each run, check where the message landed and note the answer:
#   - same conversation you are already in (the goal)
#   - a new conversation, and which agent replied
#   - nothing at all
#
# The extension logs every attempt to ~/.sprang-devin-bridge.log.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
QUESTION_FILE="$ROOT/.sprang/agent-question.md"
LOG="$HOME/.sprang-devin-bridge.log"

# Every member of ChatActionType in the Devin Desktop bundle. Most are plumbing
# (setApiKey, setUserIdentity, …) and are listed only so the probe is exhaustive.
ACTIONS=(
  explainAndFixProblem
  codeBlockMention
  fileMention
  openChatPanel
  toggleFocus
  promise
)

if [ "${1:-}" = "--list" ]; then
  printf 'Candidate action types:\n'
  printf '  %s\n' "${ACTIONS[@]}"
  printf '\nBare commands worth trying:\n'
  printf '  %s\n' devin.triggerCascade devin.addCurrentFileToChat devin.cascade.toggleAgentSelector
  exit 0
fi

mkdir -p "$(dirname "$QUESTION_FILE")"

if [ "${1:-}" = "--command" ]; then
  CMD="${2:?--command needs a command id}"
  printf '#sprang-bridge command=%s\n' "$CMD" > "$QUESTION_FILE"
  printf 'Triggered bare command: %s\n' "$CMD"
else
  ACTION="${1:?usage: try-bridge-action.sh <actionType> [question]}"
  QUESTION="${2:-BRIDGE PROBE ($ACTION): reply with the single word PONG and nothing else.}"
  {
    printf '#sprang-bridge action=%s\n' "$ACTION"
    printf '[SPRANG DASHBOARD MESSAGE]\n\n%s\n' "$QUESTION"
  } > "$QUESTION_FILE"
  printf 'Sent via actionType=%s\n' "$ACTION"
fi

sleep 2
printf '\n--- extension log (last 4 lines) ---\n'
tail -4 "$LOG" 2>/dev/null || printf '(no log yet — is the extension installed and the window reloaded?)\n'
printf '\nNow look at the IDE: did it land in THIS conversation, a new one, or nowhere?\n'
