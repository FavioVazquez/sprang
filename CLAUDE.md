@AGENTS.md

# Claude Code — Sprang Integration

This project has Sprang installed. The knowledge graph lives at `.sprang/knowledge-graph.json` once built.

---

## Quick Setup

MCP server is configured in `.mcp.json` — Claude Code picks it up automatically on project open.

Build the knowledge graph on first use:

```
/sprang
```

The dashboard opens at `http://localhost:7338`:

```
pnpm --filter @sprang/dashboard dev
```

---

## MCP Server

The Sprang MCP server exposes 9 tools directly in Claude Code. No extra setup needed — `.mcp.json` wires it automatically.

**`.mcp.json` (project root):**
```json
{
  "mcpServers": {
    "sprang": {
      "command": "node",
      "args": ["packages/mcp/dist/server.js"],
      "env": { "SPRANG_ROOT": "." }
    }
  }
}
```

If you copy Sprang into another project: set `SPRANG_ROOT` to the project root, and update `args` to point to wherever `server.js` lives.

### Tool Reference

| Tool | Input | Use for |
|---|---|---|
| `sprang_query` | `{ query, node_types?, limit?, mode? }` | Find nodes by keyword; add `"mode": "semantic"` for embedding search |
| `sprang_node` | `{ node_id }` | Full node + 1-hop neighbors, risk score, layer, annotation status |
| `sprang_diff_impact` | `{ files: string[] }` | BFS blast radius before committing |
| `sprang_tour` | `{ tour_id?, persona? }` | Guided walkthrough; persona: `"junior"` / `"senior"` / `"pm"` |
| `sprang_domain` | `{ domain_name? }` | Business domain hierarchy |
| `sprang_health` | `{}` | Smell summary, top-10 risky nodes, orphans, circular deps |
| `sprang_why` | `{ node_id }` | Git history + decision context + annotation for a node |
| `sprang_annotate` | `{ node_id, content, tags? }` | Write team annotation to `.sprang/annotations/<node>.md` |
| `sprang_respond` | `{ response, question }` | Dashboard bridge — writes answer to `.sprang/cascade-response.json` |

---

## Slash Commands

All 11 commands live in `.claude/commands/` and are available as `/` slash commands:

| Command | Description |
|---|---|
| `/sprang` | Build or refresh the knowledge graph (auto-detects codebase vs markdown notes) |
| `/sprang-analyze [path] [--full] [--language <lang>] [--chunk N]` | Full LLM-driven analysis: summaries, layers, tours, risk |
| `/sprang-knowledge [path] [--format obsidian\|logseq\|...] [--full]` | Build graph from Obsidian, Logseq, Dendron, Foam, Zettelkasten notes |
| `/sprang-chat <question>` | Ask any question about the codebase |
| `/sprang-explain <file or path:function>` | Deep-dive on a specific file or function |
| `/sprang-onboard` | Guided architecture tour — adapts to persona (junior/senior/PM) |
| `/sprang-diff [files...]` | Blast radius for current changes — writes diff overlay for dashboard |
| `/sprang-domain [name]` | Map code to business processes |
| `/sprang-why <file>` | Git history + decision context + team annotations |
| `/sprang-health` | Full health: smells, risk, orphans, circular deps |
| `/sprang-team [node]` | Browse/write team annotations with staleness detection |

---

## Always-On Rules

Rules in `.claude/rules/` load automatically — no configuration needed:

### `sprang-context.md` (always active)

Before modifying any file:
1. Call `sprang_node` with the file path — check `risk_score` and `structural_warnings`
2. If `risk_score > 0.7` — call `sprang_why` to read decision context before changing anything
3. After changes — call `sprang_diff_impact` with changed files to assess blast radius

For architecture questions: check `.sprang/SPRANG_REPORT.md` first.

### `sprang-highrisk.md` (triggered for source files)

When editing a source file:
- Run `sprang_diff_impact` to see what depends on it
- If blast radius > 10 affected nodes: explain the change before submitting
- Check `structural_warnings` — `circular_dependency` or `god_node` warnings need care

---

## Allowed Bash Commands

`.claude/settings.json` pre-approves these for smooth operation:

```json
{
  "permissions": {
    "allow": [
      "Bash(npx sprang*)",
      "Bash(node packages/mcp/dist/server.js*)",
      "Bash(pnpm --filter @sprang/dashboard dev*)",
      "Bash(git diff*)",
      "Bash(git log*)",
      "Bash(git rev-parse*)"
    ]
  }
}
```

---

## Workflow: Before Editing a File

```
1. sprang_node(<file-path>)
   → Check risk_score, in_degree, structural_warnings, has_annotation

2. If risk_score > 0.7:
   sprang_why(<node-id>)
   → Read decision_context.rationale_snippets and annotation

3. Make your changes

4. sprang_diff_impact({ files: [<changed-files>] })
   → Verify blast radius; if total_impact > 10, document scope
```

---

## Workflow: Before a PR

```
/sprang-diff
```

This writes `.sprang/diff-overlay.json` which the dashboard highlights in amber. If `total_impact > 10`, document the scope in your PR description.

---

## Graph Files (commit these)

| File | Description |
|---|---|
| `.sprang/knowledge-graph.json` | Full knowledge graph (`kind: "codebase"` or `kind: "knowledge"`) |
| `.sprang/SPRANG_REPORT.md` | Human-readable architecture summary |
| `.sprang/annotations/` | Team knowledge tied to nodes (YAML frontmatter + markdown) |
| `.sprang/diff-overlay.json` | Blast radius for dashboard highlight (can gitignore) |

---

## Dashboard

Start the dashboard:
```bash
pnpm --filter @sprang/dashboard dev
# Opens at http://localhost:7338
```

Views:
- **Graph** (`G` / `1`) — force-directed knowledge graph with risk heat overlay
- **Health** (`H` / `2`) — smell table, top-10 risk nodes, orphan count
- **Domains** (`D` / `3`) — business domain hierarchy
- **Architecture** (`A` / `4`) — layer card view (React Flow + ELK)
- **Learn** (`L` / `5`) — guided tour player

Keyboard shortcuts:
- `Cmd/Ctrl K` — open node search
- `R` — toggle risk overlay
- `?` — keyboard shortcuts help
- `Esc` — close panel / search

The **Ask Cascade** panel sends messages via `.cascade-trigger-session` → Claude Code receives them and calls `sprang_respond` to display the answer in the UI.

---

## Auto-Update Hooks

Install a git post-commit hook that refreshes the graph after each commit:

```bash
npx sprang install-hooks
```

Or run conditionally (only when graph is stale):

```bash
npx sprang scan --if-stale
```

---

## Claude Code Native Hooks

Two event hooks run automatically inside Claude Code — no installation needed. They are configured in `.claude/settings.json` and implemented as shell scripts in `.claude/hooks/`.

### `SessionStart` — stale graph warning

**Script:** `.claude/hooks/session-start.sh`

Runs every time a Claude Code session opens. Its stdout is injected directly into Claude's context window.

- If no knowledge graph exists: warns Claude to run `/sprang` before making changes.
- If the graph's recorded `gitCommitHash` differs from `HEAD`: tells Claude the graph is stale and shows both short hashes so it knows how far behind it is.
- Silent if graph is fresh, if `gitCommitHash` is absent (pre-v0.2 graph), or if not in a git repo.

Example output Claude sees:
```
[sprang] Knowledge graph is stale (indexed: abc1234, HEAD: def5678) — run /sprang to refresh before editing files.
```

### `PostToolUse` — incremental background refresh

**Script:** `.claude/hooks/post-tool-use.sh`  
**Matcher:** `Bash` tool only

Fires after every Bash tool call. If the command was a `git commit`, `git merge`, `git cherry-pick`, or `git rebase`, it triggers an incremental Phase 1 graph refresh in the background via `--if-stale`. The scan is skipped instantly if the graph is already current.

- Never blocks Claude Code — runs with `nohup ... &`
- Produces no stdout (PostToolUse output is not injected into context)
- Logs to `${TMPDIR:-/tmp}/sprang-autoupdate.log`
- Three guards before acting: git mutating command detected, graph file exists, CLI is built

### Disabling hooks

To disable both hooks, remove the `"hooks"` key from `.claude/settings.json`. To disable a single hook, remove its entry from the `"PostToolUse"` or `"SessionStart"` arrays.

### Hook tests

Both scripts have full unit test coverage in `packages/cli/tests/hooks-scripts.test.ts` (12 tests). Run with:

```bash
pnpm --filter @sprang/cli test
```

---

## For New Team Members

```
/sprang-onboard
```

This runs an adaptive guided tour based on your persona (junior/senior/PM). Also open the dashboard **Learn** tab (`L` / `5`) for a visual walkthrough.

---

## Knowledge Base Mode

For markdown note vaults (Obsidian, Logseq, Dendron, Foam, Zettelkasten):

```
/sprang-knowledge [path] [--format obsidian|logseq|dendron|foam|zettelkasten]
```

The dashboard auto-switches to knowledge view mode with `KnowledgeInfo` sidebar and `ReadingPanel`.

---

## Troubleshooting

**Graph not found:** Run `/sprang` to build it.

**MCP tools not available:** Check `.mcp.json` exists at project root. Restart Claude Code if just added.

**`risk_score` always 0:** Phase 2 enrichment may still be running. Check `.sprang/intermediate/phase2-progress.json`.

**Dashboard blank graph:** The `.sprang/knowledge-graph.json` may not exist yet. Run `/sprang` first.

**Annotation not showing:** Run `sprang_why` with the node ID — it returns `annotation_path` for the file location.
