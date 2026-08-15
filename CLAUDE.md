@AGENTS.md

# Claude Code — Sprang specifics

`AGENTS.md` above carries the graph location, the before-editing workflow, the 11 skills and the 10 MCP tools. This file only covers what is Claude-specific.

---

## Install

**Plugin marketplace** (skills are namespaced `/sprang:sprang-*`):

```
/plugin marketplace add FavioVazquez/sprang
/plugin install sprang
```

Then build the MCP server in the plugin cache and `/reload-plugins`:

```bash
cd "$(ls -d ~/.claude/plugins/cache/sprang/sprang/*/ | tail -1)" && pnpm install && pnpm build
```

**Project-local** (unnamespaced `/sprang-*`):

```bash
npm install -g @faviovazquez/sprang
sprang init --platform claude
```

---

## Where things live

| Path | Purpose |
|---|---|
| `.mcp.json` | MCP server config — Claude Code picks it up on project open |
| `.claude/skills/<name>/SKILL.md` | The 11 skills. Claude Code merged custom slash commands into skills; there is no `.claude/commands/`. |
| `.claude/rules/*.md` | `sprang-context`, `sprang-highrisk`, `sprang-dashboard` — loaded automatically |
| `.claude/settings.json` | `"hooks"` (SessionStart, PostToolUse) and `"permissions"` |
| `.claude/hooks/*.sh` | The hook scripts themselves |

`.claude/skills/`, `.claude/rules/` and `.claude/hooks/` are **generated** from `skills/` and `.devin/rules/` + `.devin/hooks/` by `pnpm sync:agents`. Edit the canonical source, not these.

**`.mcp.json`:**

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

Copying Sprang into another project: set `SPRANG_ROOT` to that project root and point `args` at wherever `server.js` actually lives.

---

## Hooks

Configured in `.claude/settings.json`, implemented in `.claude/hooks/`. Both receive the event payload as **JSON on stdin** (not an environment variable).

- **`SessionStart` → `session-start.sh`** — emits `hookSpecificOutput.additionalContext` warning Claude when the graph is missing, or when its recorded `gitCommitHash` differs from `HEAD`. Silent when the graph is fresh, when there is no `gitCommitHash`, or outside a git repo.
- **`PostToolUse` (matcher `Bash`) → `post-tool-use.sh`** — parses the tool payload from stdin; if the command was a `git commit` / `merge` / `cherry-pick` / `rebase`, it kicks off a background `--if-stale` Phase 1 refresh. Never blocks, prints nothing, logs to `${TMPDIR:-/tmp}/sprang-autoupdate.log`.

To disable, remove the `"hooks"` key (or a single entry) from `.claude/settings.json`.

---

## Permissions

`.claude/settings.json` pre-approves the commands Sprang needs, so nothing prompts mid-workflow:

```json
{
  "permissions": {
    "allow": [
      "Bash(npx @faviovazquez/sprang*)",
      "Bash(sprang *)",
      "Bash(node packages/mcp/dist/server.js*)",
      "Bash(node packages/cli/dist/index.js*)",
      "Bash(pnpm --filter @sprang/dashboard *)",
      "Bash(git diff*)",
      "Bash(git log*)",
      "Bash(git rev-parse*)",
      "Bash(cat .sprang/agent-conversation.md*)",
      "mcp__sprang__*"
    ]
  }
}
```

`.sprang/agent-conversation.md` is gitignored, so the Read tool is blocked on it — read it with `cat`.

---

## Dashboard Ask Agent

When the `claude` CLI is on `PATH`, the dashboard drives it directly: `claude -p "<question>" --output-format json`, with the session id persisted to `.sprang/claude-session.json` and reused via `--resume`. The Devin CLI bridge takes priority if it is installed and authenticated; if no CLI is drivable, the dashboard falls back to the relay bridge and you answer by calling `sprang_respond`. See the `sprang-dashboard` rule.

```bash
sprang open [path]   # dashboard on http://localhost:7777
```

---

## Note on this repo

In the Sprang source repo, `.sprang/knowledge-graph.json` and `SPRANG_REPORT.md` are gitignored. In projects that *use* Sprang, commit them so the team shares one graph.

Everything else is in [README.md](README.md).
