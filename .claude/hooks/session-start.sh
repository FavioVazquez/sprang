#!/usr/bin/env bash
# Claude Code SessionStart hook
# stdout IS injected into Claude's context window on session start.
# Warns Claude if the knowledge graph is missing or stale vs HEAD.

set -euo pipefail

GRAPH=".sprang/knowledge-graph.json"

# No graph at all
if [ ! -f "$GRAPH" ]; then
  echo "[sprang] No knowledge graph found — run /sprang to build one before making changes."
  exit 0
fi

# Extract recorded git hash from graph
GRAPH_HASH=$(node -e "
  try {
    const g = JSON.parse(require('fs').readFileSync('.sprang/knowledge-graph.json', 'utf8'));
    process.stdout.write((g.stats && g.stats.gitCommitHash) || '');
  } catch (e) {}
" 2>/dev/null || echo "")

HEAD_HASH=$(git rev-parse HEAD 2>/dev/null || echo "")

# Can't compare if either hash is missing
[ -n "$HEAD_HASH" ] || exit 0
[ -n "$GRAPH_HASH" ] || exit 0

if [ "$GRAPH_HASH" != "$HEAD_HASH" ]; then
  echo "[sprang] Knowledge graph is stale (indexed: ${GRAPH_HASH:0:7}, HEAD: ${HEAD_HASH:0:7}) — run /sprang to refresh before editing files."
fi

exit 0
