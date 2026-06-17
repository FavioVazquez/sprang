---
description: Build or refresh the Sprang knowledge graph for this workspace
---

1. Check if `.sprang/knowledge-graph.json` exists. If it does, note its `generated_at` timestamp, `phase`, and `kind` (`codebase` or `knowledge`).

2. Use the `sprang_health` MCP tool to show current graph status (if graph exists).

3. **Decide which analysis to run:**
   - If the directory contains source code (`.ts`, `.py`, `.go`, `.rs`, etc.) → run `/sprang-analyze`
   - If the directory contains primarily markdown notes (`.md` files, Obsidian vault, Logseq, Zettelkasten, etc.) → run `/sprang-knowledge`
   - If both exist → ask the user which they want (codebase analysis or knowledge graph)

4. **For codebase analysis** (delegates to `/sprang-analyze`):
   - Produce the skeleton graph first (try in order):
     ```bash
     npx sprang scan . 2>/dev/null \
       || node packages/cli/dist/index.js scan . 2>/dev/null \
       || echo "Skipping skeleton — /sprang-analyze will build from scratch"
     ```
   - Then run `/sprang-analyze` for full semantic enrichment (all 7 phases)

5. **For knowledge base** (delegates to `/sprang-knowledge`):
   - Run `/sprang-knowledge` directly — no CLI prerequisite needed

6. Once complete, use `sprang_health` to show the new graph summary.

7. Report: nodes created, edges, top insights, any warnings flagged.

8. Suggest next steps:
   - `/sprang-onboard` — guided architecture tour (codebase)
   - `/sprang-chat` — ask questions about your graph
   - `/sprang-diff` — blast radius before committing changes (codebase)
   - Open dashboard: `pnpm --filter @sprang/dashboard dev`
