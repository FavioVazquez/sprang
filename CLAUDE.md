@AGENTS.md

# Claude Code — Sprang Context

This project has Sprang installed. Read `AGENTS.md` above for the full command reference, MCP tools, and best practices.

## Quick setup

MCP server is configured in `.mcp.json`. Claude Code picks it up automatically.

Build the graph on first use:
```
/sprang
```

## Slash commands (`.claude/commands/`)

| Command | Description |
|---|---|
| `/sprang` | Build or refresh the knowledge graph |
| `/sprang-analyze` | Full LLM-driven codebase analysis |
| `/sprang-chat` | Ask questions about the codebase |
| `/sprang-explain` | Deep-dive on a specific file or function |
| `/sprang-onboard` | Guided architecture tour |
| `/sprang-diff` | Blast radius for current changes |
| `/sprang-domain` | Map code to business processes |
| `/sprang-why` | Git history + decision context |
| `/sprang-health` | Full structural health report |
| `/sprang-team` | Browse/write team annotations |
| `/sprang-knowledge` | Build graph from markdown notes |

## Rules

Rules in `.claude/rules/` are loaded automatically:
- `sprang-context.md` — always-on: use MCP tools before editing
- `sprang-highrisk.md` — triggered for source files: blast radius check
