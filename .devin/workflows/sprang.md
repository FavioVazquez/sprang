---
description: Build or refresh the Sprang knowledge graph for this workspace
---

1. Check if `.sprang/knowledge-graph.json` exists. If it does, note its `generated_at` timestamp and `phase`.
2. Use the `sprang_health` MCP tool to show current graph status (if graph exists).
3. Run `npx sprang scan .` to trigger a fresh analysis. Phase 1 completes in under 60s and produces the skeleton graph. Phase 2 runs in the background.
4. Once Phase 1 completes, use `sprang_health` to show the new graph summary.
5. Report: files analyzed, nodes created, top 3 highest-risk nodes, any critical structural warnings flagged.
6. Suggest next steps: `/sprang-onboard` for a guided tour, `/sprang-diff` before committing changes.
