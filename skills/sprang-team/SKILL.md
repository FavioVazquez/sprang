---
name: sprang-team
description: Browse and write team annotations attached to graph nodes — institutional knowledge, decision history, ownership. Use when the user says "/sprang-team", "add annotation", "team knowledge", "who owns this", or "document this decision".
---

Browse and write team annotations attached to graph nodes.

Arguments: `[node path or ID]` (optional)

1. Check `.sprang/knowledge-graph.json` exists — if not, run `/sprang-analyze` first.
2. List all files in `.sprang/annotations/` to find every annotated node.
3. For each annotation file, read YAML frontmatter: `node_id`, `node_label`, `annotated_at`, `tags`.
4. If no annotations exist: suggest candidates using step 8 below, then offer to write the first one.
5. Present annotation index table sorted by `annotated_at` descending.
6. If argument is a node path or ID: call `sprang_why` + `sprang_node` for that node and display annotation, decision context, and current structural state side-by-side.
7. **Staleness detection** — for each annotated node:
   - Call `sprang_node` to get `node.decision_context.last_changed` and current `in_degree`/`out_degree`
   - If `last_changed > annotated_at`: flag as ⚠️ **possibly stale**
   - Report a staleness summary table
8. **Suggest unannotated candidates**: nodes with `risk_score > 0.6` OR `in_degree > 10` that have no annotation file.
9. **Offer to write**: use `sprang_annotate` MCP tool to create `.sprang/annotations/<node-id>.md` with purpose, decisions, caveats, and ownership.

$ARGUMENTS
