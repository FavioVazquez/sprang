# GitHub Copilot — Sprang Context

This workspace has a **Sprang knowledge graph** at `.sprang/knowledge-graph.json`. Use it to understand the codebase before making changes.

## Pre-edit checklist

1. Call `sprang_node` with the file path — check `risk_score` and `structural_warnings`
2. If `risk_score > 0.7`: call `sprang_why` — read the decision context before changing anything
3. After changes: call `sprang_diff_impact` with the changed files — check the blast radius

For architecture questions, read `.sprang/SPRANG_REPORT.md` first.

## MCP tools (9)

| Tool | When to use |
|---|---|
| `sprang_query` | Find nodes by keyword or semantic content |
| `sprang_node` | Full node detail + 1-hop neighborhood, risk, layer |
| `sprang_diff_impact` | Blast radius before committing |
| `sprang_why` | Git history + decision context for a file |
| `sprang_health` | Health grade, smells, risk, security findings, orphans |
| `sprang_tour` | Guided architecture tour |
| `sprang_domain` | Map code to business processes |
| `sprang_annotate` | Write team knowledge to `.sprang/annotations/` |
| `sprang_respond` | Answer a question relayed from the dashboard Ask Agent panel |

`GRAPH_NOT_FOUND` means no graph exists — run `sprang scan .`. `GRAPH_INVALID` means the graph exists but fails schema validation; the error lists the issues, and the fix is `sprang merge` (or re-running `/sprang-analyze`), not another scan.

## Setup

Install the plugin, which registers the 11 `/sprang-*` skills:

```bash
copilot plugin install FavioVazquez/sprang
```

MCP config goes in either location:

- `~/.copilot/mcp-config.json` — global, applies to every workspace
- workspace `.mcp.json` — per project (`sprang init --platform copilot` writes this, plus `.vscode/mcp.json` for the VS Code extension)

```json
{
  "mcpServers": {
    "sprang": {
      "command": "node",
      "args": ["<absolute-path>/packages/mcp/dist/server.js"],
      "env": { "SPRANG_ROOT": "." }
    }
  }
}
```

`npm install -g @faviovazquez/sprang` ships a prebuilt server; if you cloned the repo instead, run `pnpm install && pnpm build` first.

Build or refresh the graph with `sprang scan .` (or `npx @faviovazquez/sprang scan .`).

> In the VS Code Copilot extension, MCP tools are only available in **Agent mode**.

## Dashboard Ask Agent

`sprang open .` serves the dashboard on `http://localhost:7777`. When the `copilot` CLI is the active bridge, the dashboard spawns `copilot --prompt` non-interactively and uses `--resume=<session_id>` for continuity. If no agent CLI is drivable, the dashboard writes the question to `.sprang/agent-question.md` for you to paste in — answer it and call `sprang_respond` so the reply appears in the UI. Conversation history lives in `.sprang/agent-conversation.md` (gitignored — read it with `cat`).

Full documentation: [README.md](../README.md).
