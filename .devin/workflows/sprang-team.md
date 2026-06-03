---
description: Surface all team annotations — browse knowledge that teammates have written about specific nodes
---

1. List all files in `.sprang/annotations/` to discover what nodes have team annotations.
2. For each annotation file found, read its YAML frontmatter to extract `node_id`, `node_label`, `annotated_at`, and `tags`.
3. Present a summary table: node label, node ID, annotation date, and tags. Sort by most recently annotated first.
4. For any annotation matching the user's area of interest (or all, if browsing), call `sprang_why` to retrieve the full annotation content alongside the machine-derived decision context.
5. Call `sprang_node` for the top 3 most recently annotated nodes to show their current structural context and risk scores alongside the team notes.
6. Identify nodes that have annotations but whose `risk_score` has increased since the annotation was written (compare annotation date to `decision_context.last_changed`) and flag them as potentially stale.
7. Summarize total annotations, most active annotators (from `decision_context.primary_authors`), and suggest nodes that are high-risk but unannotated as candidates for the next annotation session.
