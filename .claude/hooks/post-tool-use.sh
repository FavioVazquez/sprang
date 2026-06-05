#!/usr/bin/env bash
# Claude Code PostToolUse hook — Bash matcher
# Fires after every Bash tool call. Detects git commits/merges and
# triggers an incremental graph refresh in the background via --if-stale.
# stdout is NOT injected into Claude's context for PostToolUse, so we
# act silently: update the graph, never block the tool call.

set -euo pipefail

INPUT="${TOOL_INPUT:-}"

# Only act on git mutating operations
printf '%s' "$INPUT" | grep -qE 'git[[:space:]]+(commit|merge|cherry-pick|rebase)' || exit 0

# Only act if a graph exists (don't auto-create one)
[ -f .sprang/knowledge-graph.json ] || exit 0

# Only act if the CLI is built
CLI="packages/cli/dist/index.js"
[ -f "$CLI" ] || exit 0

# Run incremental Phase 1 refresh in the background — skips instantly if
# stats.gitCommitHash already matches HEAD (the --if-stale guard)
nohup node "$CLI" scan --phase1-only --if-stale \
  >"${TMPDIR:-/tmp}/sprang-autoupdate.log" 2>&1 &

exit 0
