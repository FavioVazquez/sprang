---
name: sprang-team
description: Browse and write team annotations attached to graph nodes — institutional knowledge, decision history, ownership. Use when the user says "/sprang-team", "add annotation", "team knowledge", "who owns this", or "document this decision".
---

Follow the detailed instructions in `.windsurf/workflows/sprang-team.md`.

Quick steps:
1. Check `.sprang/knowledge-graph.json` exists — if not, tell the user to run `/sprang-analyze` first.
2. List all files in `.sprang/annotations/` to find every annotated node.
3. For each annotation file, read YAML frontmatter: `node_id`, `node_label`, `annotated_at`, `tags`.
4. If no annotations exist: suggest candidates using step 8 below, then offer to write the first one.
5. Present annotation index table sorted by `annotated_at` descending.
6. If `$ARGUMENTS` is a node path or ID: call `sprang_why` + `sprang_node` for that node and display annotation, decision context, and current structural state side-by-side.
7. **Staleness detection** — for each annotated node:
   - Call `sprang_node` to check `in_degree`/`out_degree` and `node.decision_context.last_changed`
   - Use `last_changed` if present; otherwise fall back to `graph.stats.generated_at` as the "last analyzed" proxy
   - If the fallback date > `annotated_at`: flag as ⚠️ **possibly stale** (graph was re-analyzed since annotation was written)
   - Report a staleness summary table
8. **Suggest unannotated candidates**: nodes with `risk_score > 0.6` OR `in_degree > 10` that have no annotation file.
9. **Offer to write**: use `sprang_annotate` MCP tool to create `.sprang/annotations/<node-id>.md` with purpose, decisions, caveats, and ownership.
10. Optionally save annotation report to `docs/ANNOTATIONS.md`.
