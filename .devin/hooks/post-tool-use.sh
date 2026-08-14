#!/usr/bin/env bash
# Sprang PostToolUse hook — after the agent runs a git command that moves HEAD,
# refresh the knowledge graph in the background so the next question is answered
# against the current tree.
#
# Portable across Devin CLI (.devin/hooks.v1.json) and Claude Code
# (.claude/settings.json).
#
# IMPORTANT: both runtimes deliver the event as JSON on **stdin** — there is no
# TOOL_INPUT environment variable. Reading one (as this hook did before v0.3.0)
# always produced an empty string, so the refresh never fired.
#
# Never blocks and never prints: PostToolUse stdout is not injected into context.

set -uo pipefail

PAYLOAD=$(cat 2>/dev/null || echo "")

# Pull the shell command out of tool_input, tolerating either the `command`
# field (exec/Bash) or a raw string payload.
COMMAND=$(printf '%s' "$PAYLOAD" | node -e '
  let raw = "";
  process.stdin.on("data", (c) => { raw += c; });
  process.stdin.on("end", () => {
    try {
      const d = JSON.parse(raw);
      const input = d.tool_input ?? d.toolInput ?? {};
      process.stdout.write(String(input.command ?? input.cmd ?? ""));
    } catch {
      process.stdout.write("");
    }
  });
' 2>/dev/null || echo "")

# Fall back to the legacy env var so a project still on an old hooks.json works.
[ -n "$COMMAND" ] || COMMAND="${TOOL_INPUT:-}"

printf '%s' "$COMMAND" | grep -qE 'git[[:space:]]+(commit|merge|cherry-pick|rebase)' || exit 0

PROJECT_DIR="${DEVIN_PROJECT_DIR:-${CLAUDE_PROJECT_DIR:-$PWD}}"
cd "$PROJECT_DIR" 2>/dev/null || exit 0

# Only refresh a graph that already exists — never auto-create one.
[ -f .sprang/knowledge-graph.json ] || exit 0

# Prefer a locally built CLI (this repo, or a project that vendored it);
# otherwise use the published package.
if [ -f packages/cli/dist/index.js ]; then
  REFRESH=(node packages/cli/dist/index.js)
elif command -v sprang >/dev/null 2>&1; then
  REFRESH=(sprang)
else
  exit 0
fi

# --if-stale returns immediately when stats.gitCommitHash already matches HEAD.
nohup "${REFRESH[@]}" scan --phase1-only --if-stale \
  >"${TMPDIR:-/tmp}/sprang-autoupdate.log" 2>&1 &

exit 0
