---
name: sprang-why
description: Understand why a file or function exists. Pass a file path or function name as $ARGUMENTS to surface git history, decision context, and team annotations.
---

1. Call `sprang_query` with "$ARGUMENTS" to find the matching graph node ID for the file or function.
2. Call `sprang_why` with the resolved `node_id` to retrieve decision context: commit history, primary authors, rationale snippets from commit messages, and PR references.
3. If `annotation_path` is returned in the response, read and display the full annotation content written by teammates.
4. Call `sprang_node` with the same node ID to show structural context: what this node imports, what depends on it, and its risk score.
5. If `decision_context.change_frequency >= 10` (commits in 90 days), flag this as a frequently-churning node requiring extra attention.
6. Cross-reference with any changelog entries or PR references found in the decision context to link to external discussion.
7. Summarize: the purpose of the node, its origin, who owns it, current risk level, and any guidance before modifying it.
