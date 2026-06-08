---
description: Sprang knowledge graph — always-on context and best practices for this workspace.
alwaysApply: true
---

# Sprang Knowledge Graph

This workspace has a Sprang knowledge graph at `.sprang/knowledge-graph.json`.

**Before modifying any file:**
1. Call `sprang_node` with the file path to check `risk_score` and `structural_warnings`
   - If the tool returns an error or null, the graph hasn't been built yet — skip and proceed normally
2. If `risk_score > 0.7`: call `sprang_why` to read decision context and team annotation before changing anything
3. After making changes: call `sprang_diff_impact` with changed files to assess blast radius
   - If `total_impact > 10`, note the scope in your response

**For architecture questions:** check `.sprang/SPRANG_REPORT.md` first.

**To rebuild or build for the first time:** type `/sprang`
