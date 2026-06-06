---
name: sprang-explain
description: Deep-dive explanation of a specific file, function, or module. Use when the user says "/sprang-explain", "explain this file", "what does this function do", or "deep dive on X".
argument-hint: ["<file path or path:functionName>"]
---

Provide a comprehensive explanation of a specific code component.

Follow the detailed instructions in `.windsurf/workflows/sprang-explain.md`.

Quick steps:
1. Check `.sprang/knowledge-graph.json` exists. If not, run `/sprang-analyze` first.
2. Call `sprang_query` with `$ARGUMENTS` to find the target node. For a file path use `filePath` search; for `path:functionName` search by name.
3. Call `sprang_node` with the resolved `node_id` to get: layer (name + id), layer_mate_count, in_degree, out_degree, has_annotation, and full 1-hop neighborhood.
4. Call `sprang_why` to retrieve decision context: commit history, primary authors, rationale snippets, change frequency, and any team annotation.
5. Read the actual source file at `filePath` for current state.
6. Produce a structured explanation covering:
   - **What it does** — purpose and responsibilities (2-3 paragraphs)
   - **Where it fits** — layer name, imports (outgoing), used by (incoming)
   - **How it works** — key functions/classes with line number references
   - **History & ownership** — last changed, authors, change frequency, rationale from commits
   - **Risk & warnings** — risk_score, risk_factors, structural_warnings, practical advice
7. If `has_annotation` is true, display the team annotation prominently.
8. Offer: `/sprang-diff` to see if this file is changing now, `/sprang-chat` for follow-up questions.
