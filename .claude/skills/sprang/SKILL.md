---
name: sprang
description: Build or refresh the Sprang knowledge graph for this workspace. Use when the user says "/sprang", "build the knowledge graph", "scan the codebase", "index this project", or "run sprang".
argument-hint: "[path]"
---

Build or refresh the Sprang knowledge graph for this workspace. This skill is a
router: it inspects the workspace and delegates to `sprang-analyze` (code) or
`sprang-knowledge` (markdown notes).

## Instructions

1. Check whether `.sprang/knowledge-graph.json` exists. If it does, note its
   `generated_at` timestamp, `phase` (`skeleton` or `complete`), and `kind`
   (`codebase` or `knowledge`).

2. If a graph exists, call the `sprang_health` MCP tool to show current status
   (grade, node/edge counts, top risks).

3. Decide which analysis to run:
   - Directory contains source code (`.ts`, `.py`, `.go`, `.rs`, etc.) → run the
     `sprang-analyze` skill.
   - Directory contains primarily markdown notes (Obsidian vault, Logseq,
     Dendron, Foam, Zettelkasten, plain `.md`) → run the `sprang-knowledge` skill.
   - Both are present → ask the user which they want.

4. For codebase analysis, produce the skeleton graph first (try in order):
   ```bash
   npx @faviovazquez/sprang scan . 2>/dev/null \
     || node packages/cli/dist/index.js scan . 2>/dev/null \
     || echo "Skipping skeleton — sprang-analyze will build from scratch"
   ```
   Then run `sprang-analyze` for full semantic enrichment (all phases).

5. For a knowledge base, run `sprang-knowledge` directly — no CLI prerequisite.

6. When the analysis finishes, call `sprang_health` again to show the new graph
   summary.

7. Report: nodes created, edges, top insights, any warnings flagged.

8. Suggest next steps:
   - `sprang-onboard` — guided architecture tour (codebase)
   - `sprang-chat` — ask questions about the graph
   - `sprang-diff` — blast radius before committing changes (codebase)
   - Open the dashboard: `pnpm --filter @sprang/dashboard dev`

## Notes

- Never hand-write `.sprang/knowledge-graph.json`. It is produced by
  `sprang merge` (or the bundled `merge.py`) at the end of analysis.
- MCP tools available: `sprang_query`, `sprang_node`, `sprang_diff_impact`,
  `sprang_tour`, `sprang_domain`, `sprang_health`, `sprang_why`,
  `sprang_annotate`, `sprang_respond`.
