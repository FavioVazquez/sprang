---
name: sprang-team
description: Surface all team annotations attached to graph nodes. Browse and display knowledge that teammates have written about specific files and functions.
---

1. List all files in `.sprang/annotations/` to find every node that has a team annotation.
2. For each annotation file, read the YAML frontmatter to extract `node_id`, `node_label`, `annotated_at`, and `tags`.
3. Present a summary table sorted by most-recently-annotated first: node label, node ID, date, and tags.
4. If $ARGUMENTS is provided, filter to annotations whose tags or node labels match the argument.
5. Call `sprang_why` for the top 3 most relevant annotations to display the full content alongside the machine-derived decision context.
6. Call `sprang_node` on each of those 3 nodes to show current risk scores and structural warnings alongside the team notes.
7. Summarize: total annotations found, nodes that are high-risk but lack annotations (candidates for the next annotation session), and any annotations that may be stale based on recent commits.
