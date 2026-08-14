---
name: sprang-chat
description: Ask any question about the codebase using the knowledge graph. Use when the user says "/sprang-chat", "ask about the codebase", "what does X do", or any question about code that should be answered from the knowledge graph.
argument-hint: "<question>"
---

Answer questions about this codebase grounded entirely in
`.sprang/knowledge-graph.json`.

## Graph structure reference

- `nodes[]`: `id`, `type`, `name`, `filePath`, `summary`, `tags`, `complexity`,
  `languageNotes`, `risk_score`, `layer`
  - Node types: file, function, class, module, config, document, service, table,
    endpoint, pipeline, schema, resource
  - ID shapes: `file:src/auth.ts`, `function:src/auth.ts:verifyToken`,
    `config:tsconfig.json`
- `edges[]`: `source`, `target`, `type` (e.g. `imports`, `contains`, `calls`,
  `configures`, `documents`, `deploys`, `tested_by`)
- `layers[]`: `id`, `name`, `description`, `node_ids`
- `tours[]`: `id`, `title`, `steps[]`
- `domains[]`: `id`, `label`, `flows[]`

## How to read efficiently

- Prefer the MCP tools (`sprang_query`, `sprang_node`) over reading the raw graph.
- If reading the file directly, grep for the `"summary"` and `"name"` fields
  first — never dump the full graph into context.
- Follow edges to find connected components.

## Instructions

1. Check `.sprang/knowledge-graph.json` exists. If not, tell the user to run the
   `sprang-analyze` skill first.

2. Read project metadata (`project_name`, `description`, `languages`) to anchor
   context.

3. Call `sprang_query` with keywords from the question to find relevant nodes.
   Use multiple search terms if the first returns nothing. If reading the raw
   graph instead, search `"name"`, `"summary"`, and `"tags"` fields and note the
   `id` of every match.

4. For each matched node, call `sprang_node` to get its 1-hop neighborhood
   (in/out degree, layer, neighbors). Raw-graph equivalent: grep the edges for
   the node ID as `"source"` (what it depends on) and as `"target"` (what
   depends on it).

5. Follow edges to trace the dependency chain as far as needed to fully answer.

6. Find which architectural layers the matched nodes belong to
   (`layers[*].node_ids`).

7. Answer grounded in graph data:
   - Cite `summary` fields directly — they are authoritative.
   - Reference specific file paths, functions, and relationships.
   - Explain which layers are involved and why.
   - If nothing matches, say so and suggest related search terms.

8. Offer follow-ups:
   - `sprang-explain <file>` for a deeper dive on a specific file
   - `sprang-diff` if the topic involves recent or pending changes
   - Which tour step covers this topic (check `tours[*].steps` for matching node IDs)

$ARGUMENTS
