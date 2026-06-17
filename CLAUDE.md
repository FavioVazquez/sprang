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

The dashboard opens at `http://localhost:7777` (for daily use, run `preview`):

```bash
pnpm --filter @sprang/dashboard preview
```

For dashboard source development only (hot-reload):
```bash
pnpm --filter @sprang/dashboard dev  # port 7338
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
| `sprang_tour` | `{ tour_id?, persona? }` | Guided walkthrough; persona: `"junior"` / `"senior"` / `"experienced"` / `"pm"` / `"non-technical"` |
| `sprang_domain` | `{ domain_name? }` | Business domain hierarchy |
| `sprang_health` | `{}` | Health grade (A–F), score, smell summary, security summary, top-10 risky nodes, orphans, circular deps, run history |
| `sprang_why` | `{ node_id }` | Git history + decision context + annotation for a node |
| `sprang_annotate` | `{ node_id, content, tags? }` | Write team annotation to `.sprang/annotations/<node>.md` |
| `sprang_respond` | `{ response, question? }` | Dashboard bridge — writes answer to `.sprang/cascade-response.json` |

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

### `cascade-messaging.md` (always active) — Dashboard chat bridge

When you receive a message prefixed with `[SPRANG DASHBOARD MESSAGE]` (from the dashboard Ask Agent panel):
1. **Run `cat .sprang/agent-conversation.md 2>/dev/null || echo "(no history yet)"`** — reads full conversation history (file is gitignored; the Read tool is blocked, use Bash instead)
2. Answer the question fully using MCP tools to ground your answer
3. **Call `sprang_respond`** with your answer so it appears in the dashboard UI

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
      "Bash(git rev-parse*)",
      "Bash(cat .sprang/agent-conversation.md*)"
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

> **Note:** In the Sprang source repo itself, `knowledge-graph.json` and `SPRANG_REPORT.md` are gitignored (this repo uses Sprang but doesn't commit its own graph). In projects that _use_ Sprang, commit these files so the team shares the same graph.

---

## Dashboard

Start the dashboard:
```bash
pnpm --filter @sprang/dashboard preview   # daily use (pre-built dist), http://localhost:7777
pnpm --filter @sprang/dashboard dev        # hot-reload development, http://localhost:7338
sprang open [path] [--auto-scan]           # point at any folder, no cd
```

The dashboard is a polished React + Vite app (Sigma.js, framer-motion) with an OKLCH-tinted surface ramp, three themes (dark / light / high-contrast), Outfit + JetBrains Mono typography, spring-physics motion, and full `prefers-reduced-motion` support. Risk renders as an accessible heat scale.

**Instant analysis (no agent needed):** if no graph exists, the dashboard shows a **landing screen** — type a local path or paste a GitHub URL (`github.com/owner/repo`) and the server runs Phase 1 (static, <60s; GitHub repos are cloned to a temp folder). `sprang open --auto-scan` triggers it without a click.

Views:
- **Graph** (`G` / `1`) — force-directed knowledge graph with risk heat overlay; function call edges and import edges both rendered
- **Health** (`H` / `2`) — letter grade A–F, smell table (incl. `layer_violation`), top-10 risk nodes, security findings, detected design patterns
- **Domains** (`D` / `3`) — business domain hierarchy
- **Architecture** (`A` / `4`) — layer card view (React Flow + ELK)
- **Treemap** (`T` / `5`) — D3 file/folder hierarchy sized by lines, colored by risk score
- **Matrix** (`M` / `6`) — file-to-file adjacency matrix sorted by layer rank
- **Learn** (`L` / `7`) — persona-adaptive guided tour player

Keyboard shortcuts:
- `Cmd/Ctrl K` — open node search
- `R` — toggle risk overlay
- `?` — keyboard shortcuts help
- `Esc` — close panel / search

The **Ask Agent** panel auto-detects the available bridge (Windsurf → Claude Code → Copilot CLI → none). When the Claude Code bridge is active, the Vite server spawns `claude -p` non-interactively and uses `--resume <session_id>` for conversation continuity. The session ID is persisted in `.sprang/claude-session.json`.

---

## CLI Commands

Beyond the slash commands, the `sprang` CLI binary has these commands:

```bash
sprang scan [path] [--phase1-only] [--if-stale]   # build/refresh the graph
sprang open [path] [--port 7777] [--no-browser] [--auto-scan]   # launch dashboard for any repo
sprang diagram [path] [--output file]              # Mermaid architecture diagram
sprang merge [path] [--intermediate dir]           # assemble graph from agent chunks
sprang health [path]                               # print health report to terminal
sprang query "text" [--semantic]                   # search the graph from CLI
sprang watch [path]                                # incremental file watcher
sprang status [path]                               # graph age / phase / node count
sprang install-hooks [path]                        # install git post-commit hook
```

`sprang open` is the zero-friction entry point: point it at any folder and it serves the dashboard. If no graph exists yet, the dashboard shows a landing screen where you can type a local path or paste a GitHub URL — the server clones and scans automatically. Pass `--auto-scan` to skip the button click entirely.

`sprang diagram` reads `.sprang/knowledge-graph.json` and outputs a Mermaid `flowchart TD` — useful for architecture docs or PR descriptions.

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
pnpm --filter sprang test
```

---

## For New Team Members

```
/sprang-onboard
```

This runs an adaptive guided tour based on your persona (junior/senior/PM). Also open the dashboard **Learn** tab (`L` / `7`) for a visual walkthrough.

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
