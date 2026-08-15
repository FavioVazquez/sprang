#!/usr/bin/env bash
# Sprang PreToolUse hook — warn before editing dangerous code.
#
# AGENTS.md asks the agent to call sprang_node before editing a file and to read
# sprang_why when risk is high. That is a request, and requests are followed
# inconsistently: the agent has to remember, and a busy context is exactly when
# it will not. This hook makes it deterministic — the warning arrives whether or
# not the agent thought to ask.
#
# It injects context; it never blocks. A knowledge tool that refuses edits would
# be uninstalled within a day, and a false positive that halts work is far worse
# than one that adds a sentence. The decision stays with the agent.
#
# Portable across Devin CLI (.devin/hooks.v1.json) and Claude Code
# (.claude/settings.json). Both deliver the event as JSON on stdin.
#
# Silent unless there is something worth saying. Fails open, always.

set -uo pipefail

PAYLOAD=$(cat 2>/dev/null || echo "")
[ -z "$PAYLOAD" ] && exit 0

ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
GRAPH="$ROOT/.sprang/knowledge-graph.json"
[ -f "$GRAPH" ] || exit 0

command -v node >/dev/null 2>&1 || exit 0

printf '%s' "$PAYLOAD" | node -e '
const fs = require("node:fs");
const path = require("node:path");

let raw = "";
process.stdin.on("data", (c) => { raw += c; });
process.stdin.on("end", () => {
  let payload;
  try { payload = JSON.parse(raw); } catch { process.exit(0); }

  // The edited path lives in different fields across runtimes and tools.
  const input = payload.tool_input ?? payload.input ?? {};
  const target = input.file_path ?? input.path ?? input.filePath ?? input.notebook_path;
  if (typeof target !== "string" || !target) process.exit(0);

  const root = process.env.SPRANG_HOOK_ROOT || process.cwd();
  const rel = path.isAbsolute(target) ? path.relative(root, target) : target;
  // Editing outside the project is not our business.
  if (rel.startsWith("..")) process.exit(0);

  let graph;
  try {
    graph = JSON.parse(fs.readFileSync(path.join(root, ".sprang", "knowledge-graph.json"), "utf-8"));
  } catch { process.exit(0); }

  const node = (graph.nodes || []).find(
    (n) => n.type === "file" && (n.location?.file === rel || n.id === `file:${rel}`),
  );
  if (!node) process.exit(0);

  const risk = typeof node.risk_score === "number" ? node.risk_score : 0;
  const factors = node.risk_factors || [];
  const behavioral = node.metadata?.behavioral || {};
  const warnings = node.structural_warnings || [];

  // Behavioural claims apply to source only. A .gitignore or CHANGELOG is
  // touched by nearly every commit, so it accumulates the most "traps" in the
  // repository while being entirely safe to edit. Warning about it trains the
  // agent to ignore the hook — the same reason the risk scorer gates these.
  const category = node.metadata?.fileCategory;
  const isSource = category === undefined || category === "source";

  const lines = [];

  // Traps first: "this was reverted before" is the single most actionable
  // thing we can say, and it is a fact rather than a score.
  if (isSource && behavioral.trap_count > 0) {
    const t = (behavioral.traps || [])[0];
    lines.push(
      `${behavioral.trap_count} previous change(s) here were reverted or urgently fixed` +
        (t ? ` — most recently: "${String(t.subject).slice(0, 80)}"` : "") + ".",
    );
  }

  if (risk >= 0.7) {
    lines.push(`Risk score ${risk.toFixed(2)} (high)${factors.length ? ` — ${factors.slice(0, 4).join(", ")}` : ""}.`);
  } else if (risk >= 0.5 || factors.includes("previously_reverted")) {
    lines.push(`Risk score ${risk.toFixed(2)}${factors.length ? ` — ${factors.slice(0, 3).join(", ")}` : ""}.`);
  }

  if (isSource && behavioral.bus_factor === 1 && behavioral.main_developer) {
    lines.push(`Bus factor 1: ${behavioral.main_developer} holds most of the knowledge here.`);
  }

  const violation = warnings.find((w) => w.category === "layer_violation");
  if (violation) lines.push(`Existing layer violation on this file.`);

  if (node.annotations?.length) {
    lines.push(`A team annotation exists for this file — read it before changing behaviour.`);
  }

  if (lines.length === 0) process.exit(0);

  const context =
    `[sprang] ${rel}\n` +
    lines.map((l) => `  - ${l}`).join("\n") +
    `\n  Call sprang_node("file:${rel}") for detail, sprang_why for history, ` +
    `sprang_coupled to see what changes with it.`;

  // hookSpecificOutput.additionalContext is how both runtimes accept context
  // from a hook. Plain stdout is not injected on PreToolUse.
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        additionalContext: context,
      },
    }),
  );
});
' 2>/dev/null || exit 0

exit 0
