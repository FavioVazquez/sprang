---
name: sprang-why
description: Understand why a file or function exists. Pass a file path or function name as $ARGUMENTS to surface git history, decision context, and team annotations.
---

1. Call `sprang_query` with `$ARGUMENTS` to find the matching graph node ID (file path, function name, class name).
2. Call `sprang_why` with the resolved `node_id` to retrieve: commit history, primary authors, rationale snippets, PR references, and any team annotation content.
3. Call `sprang_node` with the same `node_id` to get enriched structural context:
   - `layer` (name + id) and `layer_mate_count` — where it fits in the architecture
   - `in_degree` / `out_degree` — how coupled it is
   - `has_annotation` / `annotation_path` — whether team knowledge exists
   - Full 1-hop neighbor list
4. If `has_annotation` is true, display the full annotation content prominently.
5. If `decision_context.change_frequency >= 10` (commits in 90 days), flag as 🔴 **frequently-churning** — extra care required.
6. Cross-reference PR references from decision context.
7. Summarize: purpose, origin, ownership, layer, risk level, and specific guidance before modifying (especially if `risk_score > 0.7`).
