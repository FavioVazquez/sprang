---
description: Surface all team annotations — browse knowledge that teammates have written about specific nodes
---

# /sprang-team

Browse, read, write, and maintain team annotations for knowledge graph nodes.

Pass a `$ARGUMENTS` to focus on a specific node, or leave empty to browse all annotations.

## Instructions

1. **Check `.sprang/knowledge-graph.json` exists.** If not, tell the user to run `/sprang-analyze` first.

2. **Discover annotations:**
   ```bash
   ls .sprang/annotations/ 2>/dev/null || echo "(none)"
   ```
   For each `.md` file found, read its YAML frontmatter to extract:
   - `node_id` — which node this annotates
   - `node_label` — human-friendly name
   - `annotated_at` — ISO timestamp
   - `tags` — topic tags

3. **If no annotations exist yet:**
   > No team annotations found. Use `sprang_annotate` (MCP) or `/sprang-why <file>` to add the first annotation.
   Then jump to step 8 (suggest candidates).

4. **Present annotation index** — sorted by `annotated_at` descending:

   | Node | ID | Annotated | Tags |
   |------|----|-----------|------|
   | `<node_label>` | `<node_id>` | `<date>` | `<tags>` |

5. **If `$ARGUMENTS` specifies a node path or ID:**
   - Find matching annotation file(s)
   - Call `sprang_why` with that `node_id` to get the full annotation + decision context
   - Call `sprang_node` with that `node_id` to get current structural context (risk_score, in/out degree, layer)
   - Display side-by-side: **Team note** | **Current state** | **Git history**

6. **Staleness detection** — for each annotated node:
   - Call `sprang_node` to get `node.decision_context.last_changed`
   - Compare to `annotated_at` from the annotation frontmatter
   - If `last_changed` is **after** `annotated_at` → flag as ⚠️ **possibly stale**
   - If `node.risk_score` has increased significantly → flag as 🔴 **risk escalated**

   Report stale annotations:
   > **Possibly stale annotations** (file changed after note was written):
   > - `<node_label>` — annotated <date>, last changed <date> by <author>

7. **Annotation stats:**
   - Total annotations: `<N>`
   - Nodes with annotations: `<list>`
   - Stale: `<M>` need review
   - Most annotated layers: `<layer names>`

8. **Suggest unannotated candidates** — find nodes that are:
   - `risk_score > 0.6` AND have no annotation file
   - OR are on the critical path (in-degree > 10) AND have no annotation

   > **Suggested next annotations** (high-risk, unannotated):
   > 1. `<node_label>` — risk: 0.XX, reason: `<risk_factors>`
   > 2. ...

9. **Offer to write an annotation:**
   > "Would you like me to add an annotation for any of these nodes? I can write it to `.sprang/annotations/<node-id>.md` using `sprang_annotate`."
   
   When writing, use `sprang_annotate` MCP tool with:
   - `node_id`: the target node ID
   - `content`: a markdown note explaining purpose, decisions, caveats, and ownership
   - `tags`: relevant topic tags

10. **Offer to save an annotation report** to `docs/ANNOTATIONS.md` for team visibility.
