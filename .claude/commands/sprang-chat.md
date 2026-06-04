Ask any question about the codebase using the knowledge graph.

Answer questions grounded entirely in `.sprang/knowledge-graph.json`.

1. Check `.sprang/knowledge-graph.json` exists. If not, tell the user to run `/sprang-analyze` first.
2. Read project metadata (project_name, description, languages) to anchor context.
3. Call `sprang_query` with keywords from the question to find relevant nodes — use multiple search terms if needed.
4. For each matched node, call `sprang_node` to get its 1-hop neighborhood (in/out degree, layer, neighbors).
5. Follow edges to trace the dependency chain as far as needed to fully answer.
6. Find which architectural layers the matched nodes belong to.
7. Answer grounded in graph data — cite `summary` fields directly, reference file paths, name layers.
8. Offer follow-ups: `/sprang-explain <file>` for deep dive, `/sprang-diff` if the topic involves recent changes.

$ARGUMENTS
