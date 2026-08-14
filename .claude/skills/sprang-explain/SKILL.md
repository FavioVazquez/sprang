---
name: sprang-explain
description: Deep-dive explanation of a specific file, function, or module. Use when the user says "/sprang-explain", "explain this file", "what does this function do", or "deep dive on X".
argument-hint: "<file | path:function>"
---

In-depth explanation of a specific code component: what it does, why it exists,
who changed it, what depends on it.

Arguments: `<file path or path:functionName>` (e.g. `src/auth/login.ts` or
`src/auth/login.ts:validatePassword`)

## Instructions

1. Check `.sprang/knowledge-graph.json` exists. If not, run the `sprang-analyze`
   skill first.

2. Call `sprang_query` with the argument to find the target node. Note its `id`,
   `type`, `summary`, `tags`, `complexity`, `risk_score`, `risk_factors`,
   `structural_warnings`, and `decision_context`.

3. Call `sprang_node` with the resolved `node_id` to get: `layer` (name + id),
   `layer_mate_count`, `in_degree`, `out_degree`, `has_annotation`, and the full
   1-hop neighborhood with edge directions and types.
   - Outgoing edges → what this node imports, calls, or depends on
   - Incoming edges → what imports, calls, or depends on this node (blast radius)

4. Call `sprang_why` with the same `node_id` for decision context: commit
   history, `primary_authors`, `last_changed`, `rationale_snippets`,
   `change_frequency`, `pr_references`, and any team annotation.

5. Read the actual source file at `filePath` for its current state.

6. Produce a structured explanation:

   ### What it does
   2-3 paragraphs on purpose and responsibilities.

   ### Where it fits
   - **Layer**: layer name and why it belongs there
   - **Imports**: what it depends on and why
   - **Used by**: what calls or imports it — the blast radius

   ### How it works
   Walk through the key functions, classes, and logic with real line numbers.

   ### History & ownership
   - **Last changed**: date
   - **Authors**: primary authors
   - **Change frequency**: commits in the last 90 days
   - **Why it exists**: rationale from commit messages, if available

   ### Risk & warnings
   - **Risk score** and the factors driving it
   - **Structural warnings**: any smells detected
   - **What to watch out for**: practical advice

   ### Next steps
   Suggest edits only after checking `risk_score`. Offer `sprang-diff` to see
   whether this file is currently changing, or `sprang-chat` for follow-ups.

$ARGUMENTS
