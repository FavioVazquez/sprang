---
description: Understand why a file or function exists — surfaces git history, decision context, and team annotations
---

1. Identify the target file or function from the user's request (use $ARGUMENTS or ask for clarification if ambiguous).
2. Call `sprang_query` with the file name or function name to find the matching node ID.
3. Call `sprang_why` with the resolved `node_id` to retrieve the full decision context: commit history, primary authors, rationale snippets, PR references, and any changelog entries.
4. Check if an annotation file exists (indicated by `annotation_path` in the response). If present, read and display the annotation content.
5. If `decision_context.change_frequency` is high (>= 10 commits in 90 days), note that this is a frequently-changing node and extra care is needed.
6. Cross-reference with `sprang_node` to show structural context: what does this node connect to, and what depends on it.
7. Summarize: the origin story of the node, who owns it, why it was built the way it was, and what to watch out for when modifying it.
