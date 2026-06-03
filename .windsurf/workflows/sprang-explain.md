---
description: Deep-dive explanation of a specific file, function, or module — what it does, why it exists, who changed it, what depends on it
---

# /sprang-explain

Provide an in-depth explanation of a specific code component.

Arguments: `$ARGUMENTS` — a file path (e.g., `src/auth/login.ts`) or `path:functionName`

## Instructions

1. Check that `.sprang/knowledge-graph.json` exists. If not, run `/sprang-analyze` first.

2. **Find the target node** — grep the graph for `$ARGUMENTS`:
   - For file paths: search `"filePath"` matches
   - For `path:functionName`: search `"name"` filtered by the file path
   - Note the node's `id`, `type`, `summary`, `tags`, `complexity`, `risk_score`, `risk_factors`, `structural_warnings`, `decision_context`

3. **Find all connected edges** — grep for the node's ID in the edges section:
   - As `source` → things this node imports/calls/depends on (outgoing)
   - As `target` → things that import/call/depend on this node (incoming)
   - Note all connected node IDs and edge types

4. **Read connected nodes** — for each connected node, grep for its `summary` and `name`. Build the full neighborhood picture.

5. **Find the layer** — grep `layers[*].node_ids` for this node's ID to find its architectural layer.

6. **Read git decision context** — if the node has `decision_context`, read it for:
   - Who changed this file and when (`primary_authors`, `last_changed`)
   - Why it was changed (`rationale_snippets` from commit messages)
   - How often it changes (`change_frequency`)

7. **Read the actual source file** — read the file at `filePath` for the full source.

8. **Produce a comprehensive explanation:**

   ### What it does
   <2-3 paragraph explanation of the component's purpose and responsibilities>

   ### Where it fits
   - **Layer**: <layer name and why it's in that layer>
   - **Imports**: <what it depends on and why>
   - **Used by**: <what calls/imports it — the blast radius>

   ### How it works
   <walk through the key functions/classes/logic — reference actual line numbers>

   ### History & Ownership
   - **Last changed**: <date>
   - **Authors**: <list>
   - **Change frequency**: <how often>
   - **Why it exists**: <rationale from commit messages if available>

   ### Risk & Warnings
   - **Risk score**: <score> — <risk factors explained>
   - **Structural warnings**: <any smells detected>
   - **What to watch out for**: <practical advice>

9. Offer to: run `/sprang-diff` to see if this file is changing now, or `/sprang-chat` to ask follow-up questions.
