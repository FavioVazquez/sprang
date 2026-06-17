# GitHub Copilot — Sprang Context

This workspace has a **Sprang knowledge graph** at `.sprang/knowledge-graph.json`. Use it to understand the codebase before making changes.

## MCP Tools (Copilot Agent Mode)

The `sprang` MCP server provides 9 tools — use them in Copilot agent mode:

| Tool | When to use |
|---|---|
| `sprang_query` | Find nodes by keyword or semantic content |
| `sprang_node` | Get full node detail + 1-hop neighborhood |
| `sprang_diff_impact` | Blast radius analysis before committing |
| `sprang_tour` | Get the guided architecture tour |
| `sprang_domain` | Map code to business processes |
| `sprang_health` | Full risk + smell + orphan report |
| `sprang_why` | Git history + decision context for a file |
| `sprang_annotate` | Write team knowledge to `.sprang/annotations/` |
| `sprang_respond` | Send answer to dashboard Ask Agent panel |

## Pre-edit checklist

Before modifying any file:
1. Call `sprang_node` with the file path — check `risk_score` and `structural_warnings`
2. If `risk_score > 0.7`: call `sprang_why` — read decision context before changing
3. After changes: call `sprang_diff_impact` with changed files — check blast radius

## Architecture

- `.sprang/SPRANG_REPORT.md` — human-readable architecture summary
- `.sprang/knowledge-graph.json` — full knowledge graph
- `.sprang/annotations/` — team knowledge notes per node

## Setup

The MCP server is configured in `.vscode/mcp.json`. Copilot picks it up in agent mode automatically.

The server binary must be built from the Sprang repository before first use:
```bash
cd <path-to-sprang-repo>   # e.g. ~/.sprang/repo or ~/tools/sprang
pnpm install && pnpm build
```

To build or refresh the knowledge graph: run `sprang scan .` (or `npx @faviovazquez/sprang scan .` if the CLI is not on your PATH).

## Dashboard Ask Agent

The Sprang dashboard has an **Ask Agent** panel. When the Copilot CLI bridge is active, the dashboard spawns `copilot --prompt` non-interactively and uses `--resume=<session_id>` for conversation continuity. Conversation history is maintained in `.sprang/agent-conversation.md` (gitignored — read with `cat`, not the Read tool).
