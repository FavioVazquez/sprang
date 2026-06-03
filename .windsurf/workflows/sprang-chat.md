---
description: Ask any question about the codebase using the knowledge graph — "How does auth work?", "What calls this function?", "Which files handle payments?"
---

# /sprang-chat

Answer questions about this codebase using `.sprang/knowledge-graph.json`.

## Graph structure reference
- `nodes[]`: id, type, name, filePath, summary, tags, complexity, languageNotes, risk_score, layer
  - Node types: file, function, class, module, config, document, service, table, endpoint, pipeline, schema, resource
  - IDs: `file:src/auth.ts`, `function:src/auth.ts:verifyToken`, `config:tsconfig.json`
- `edges[]`: source, target, type (imports, contains, calls, configures, documents, deploys, tests, etc.)
- `layers[]`: id, name, description, node_ids
- `tours[]`: id, title, steps[]
- `domains[]`: id, label, flows[]

## How to read efficiently
- Use Grep to find relevant nodes BEFORE reading the full file
- Search `"summary"` and `"name"` fields for the query keywords
- Follow edges to find connected components
- Never dump the full graph into context

## Instructions

1. Check that `.sprang/knowledge-graph.json` exists. If not, tell the user to run `/sprang-analyze` first.

2. **Read project metadata** — grep for `"project_name"`, `"description"`, `"languages"` at the top of the file.

3. **Search for relevant nodes** — grep the graph for the user's query: `$ARGUMENTS`
   - Search `"name"` and `"summary"` fields for keyword matches
   - Search `"tags"` for topic matches
   - Note the `id` of all matching nodes

4. **Find connected edges** — for each matched node ID, grep the edges section for it:
   - As `"source"` → what this node depends on / calls / imports
   - As `"target"` → what depends on / calls / imports this node
   - This gives the 1-hop neighborhood

5. **Read layer context** — find which architectural layers the matched nodes belong to.

6. **Answer the query** grounded in graph data:
   - Reference specific files, functions, and relationships
   - Cite `summary` fields directly (they're Cascade-written, authoritative)
   - Explain which layer(s) are involved and why
   - Follow the dependency chain as far as needed to answer completely
   - If nothing matches, say so and suggest related search terms

7. **Offer follow-ups** — after answering, suggest:
   - `/sprang-explain <file>` for deeper dive into a specific file
   - `/sprang-diff` to see what's currently changing in related code
   - Which tour step covers this topic (grep `tours[*].steps` for matching node IDs)
