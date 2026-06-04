Build or refresh the Sprang knowledge graph for this workspace.

1. Check if `.sprang/knowledge-graph.json` exists — note its `generated_at`, `phase`, and `kind` (`codebase` or `knowledge`).
2. Call `sprang_health` to show current graph status (if graph exists).
3. **Decide which analysis to run:**
   - Source code (`.ts`, `.py`, `.go`, `.rs`, etc.) → run `/sprang-analyze`
   - Primarily markdown notes (Obsidian, Logseq, Zettelkasten) → run `/sprang-knowledge`
   - Both → ask the user which they want
4. **For codebase analysis** → run `npx sprang scan .` to produce the skeleton graph, then run `/sprang-analyze` for full enrichment.
5. **For knowledge base** → run `/sprang-knowledge` directly.
6. Once complete, call `sprang_health` to show the new graph summary.
7. Report: nodes created, edges, top insights, any warnings flagged.
8. Suggest next steps: `/sprang-onboard`, `/sprang-chat`, `/sprang-diff`, or open dashboard: `pnpm --filter @sprang/dashboard dev`.
