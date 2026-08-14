#!/usr/bin/env bash
# Sprang SessionStart hook — warns the agent when the knowledge graph is
# missing or stale relative to HEAD, so it doesn't reason from a stale map.
#
# Portable across Devin CLI (.devin/hooks.v1.json) and Claude Code
# (.claude/settings.json). Both deliver the event as JSON on stdin and both
# inject `hookSpecificOutput.additionalContext` into the agent's context.
#
# Always exits 0 — a warning hook must never block a session from starting.

set -uo pipefail

# Drain stdin so the caller never blocks on an unread pipe. SessionStart
# carries no fields we need.
cat >/dev/null 2>&1 || true

PROJECT_DIR="${DEVIN_PROJECT_DIR:-${CLAUDE_PROJECT_DIR:-$PWD}}"
cd "$PROJECT_DIR" 2>/dev/null || exit 0

GRAPH=".sprang/knowledge-graph.json"

emit() {
  # $1 = context text. Encoded via node so quotes/newlines can't break the JSON.
  node -e '
    const text = process.argv[1];
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: text },
    }));
  ' "$1" 2>/dev/null || printf '%s\n' "$1"
}

if [ ! -f "$GRAPH" ]; then
  emit "[sprang] No knowledge graph found — run /sprang to build one before making changes."
  exit 0
fi

GRAPH_HASH=$(node -e '
  try {
    const g = JSON.parse(require("fs").readFileSync(".sprang/knowledge-graph.json", "utf8"));
    process.stdout.write((g.stats && g.stats.gitCommitHash) || "");
  } catch { /* unreadable graph — stay silent, other tooling reports it */ }
' 2>/dev/null || echo "")

HEAD_HASH=$(git rev-parse HEAD 2>/dev/null || echo "")

# Nothing to compare against: not a git repo, or a pre-0.2 graph with no hash.
[ -n "$HEAD_HASH" ] || exit 0
[ -n "$GRAPH_HASH" ] || exit 0

if [ "$GRAPH_HASH" != "$HEAD_HASH" ]; then
  emit "[sprang] Knowledge graph is stale (indexed: ${GRAPH_HASH:0:7}, HEAD: ${HEAD_HASH:0:7}) — run /sprang to refresh before editing files."
fi

exit 0
