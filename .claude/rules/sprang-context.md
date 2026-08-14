---
trigger: glob
globs: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx", "**/*.py", "**/*.go", "**/*.rs", "**/*.java", "**/*.rb", "**/*.php", "**/*.cs", "**/*.kt"]
---

# Sprang Knowledge Graph

This workspace has a Sprang knowledge graph at `.sprang/knowledge-graph.json`.

**Before modifying a source file:**
1. Call `sprang_node` with the file path to check `risk_score` and `structural_warnings`
   - If the tool errors or returns null, the graph isn't built yet — skip and proceed normally
2. If `risk_score > 0.7`: call `sprang_why` for decision context and team annotations before changing anything
3. After changes: call `sprang_diff_impact` with the changed files to assess blast radius
   - If `total_impact > 10`, note the scope in your response

**For architecture questions:** read `.sprang/SPRANG_REPORT.md` first.

**To build or rebuild the graph:** run `/sprang`.

If `sprang_node` reports `GRAPH_INVALID`, the graph file exists but is malformed —
`sprang scan` will not fix that. Run `sprang merge` or `/sprang-analyze` instead.
