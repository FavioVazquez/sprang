Deep-dive explanation of a specific file, function, or module.

Arguments: `<file path or path:functionName>`

1. Call `sprang_query` with the argument to find the target node.
2. Call `sprang_node` with the resolved `node_id` to get: layer (name + id), layer_mate_count, in_degree, out_degree, has_annotation, and full 1-hop neighborhood.
3. Call `sprang_why` to retrieve decision context: commit history, primary authors, rationale snippets, change frequency, and any team annotation.
4. Read the actual source file for current state.
5. Produce a structured explanation:
   - **What it does** — purpose and responsibilities (2-3 paragraphs)
   - **Where it fits** — layer name, imports (outgoing), used by (incoming)
   - **How it works** — key functions/classes with line number references
   - **History** — who wrote it, when, why (from decision_context)
   - **Risk** — risk_score, blast radius, structural warnings
   - **Next steps** — suggest edits only after checking `risk_score`

$ARGUMENTS
