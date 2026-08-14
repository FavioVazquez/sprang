---
name: sprang-team
description: Browse and write team annotations attached to graph nodes — institutional knowledge, decision history, ownership. Use when the user says "/sprang-team", "add annotation", "team knowledge", "who owns this", or "document this decision".
argument-hint: "[node-id]"
---

Browse, read, write, and maintain team annotations attached to knowledge graph
nodes.

Arguments: `[node path or ID]` (optional — browses all annotations if omitted)

## Instructions

1. Check `.sprang/knowledge-graph.json` exists. If not, run the `sprang-analyze`
   skill first.

2. **Discover annotations:**
   ```bash
   ls .sprang/annotations/ 2>/dev/null || echo "(none)"
   ```
   For each `.md` file found, read its YAML frontmatter: `node_id`,
   `node_label`, `annotated_at` (ISO timestamp), `tags`.

3. **If no annotations exist yet**, say so, jump to step 7 to suggest
   candidates, then offer to write the first one.

4. **Present the annotation index**, sorted by `annotated_at` descending:

   | Node | ID | Annotated | Tags |
   |------|----|-----------|------|
   | `<node_label>` | `<node_id>` | `<date>` | `<tags>` |

5. **If an argument names a node path or ID:**
   - Find the matching annotation file(s)
   - Call `sprang_why` with that `node_id` for the full annotation + decision context
   - Call `sprang_node` for current structural state (risk_score, in/out degree, layer)
   - Display side by side: **Team note** | **Current state** | **Git history**

6. **Staleness detection** — for each annotated node:
   - Call `sprang_node` to get `node.decision_context.last_changed` and current
     `in_degree`/`out_degree`
   - Use `last_changed` if present; if absent (most nodes have no git history),
     fall back to `graph.stats.generated_at` as a "last analyzed" proxy
   - If that date is after `annotated_at` → flag as **possibly stale**
   - If `risk_score` has increased significantly → flag as **risk escalated**
   - Report a staleness summary table: node label, annotated date, last
     changed/analyzed date

   Then report annotation stats: total annotations, nodes with annotations,
   how many are stale, and the most annotated layers.

7. **Suggest unannotated candidates** — nodes with `risk_score > 0.6`, or on the
   critical path (`in_degree > 10`), that have no annotation file. List each with
   its risk score and risk factors.

8. **Offer to write an annotation** using the `sprang_annotate` MCP tool:
   - `node_id`: the target node ID
   - `content`: markdown covering purpose, decisions, caveats, and ownership
   - `tags`: relevant topic tags

   It writes `.sprang/annotations/<sanitized-node-id>.md`. These files should be
   committed.

9. Offer to save an annotation report to `docs/ANNOTATIONS.md` for team visibility.

$ARGUMENTS
