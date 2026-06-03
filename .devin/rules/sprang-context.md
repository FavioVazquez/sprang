---
trigger: always_on
---

# Sprang Knowledge Graph

This workspace has a Sprang knowledge graph at `.sprang/knowledge-graph.json`.

**Before modifying any file:**
1. Call `sprang_node` with the file path to check its `risk_score` and `structural_warnings`
2. If `risk_score > 0.7`: call `sprang_why` to understand the decision context before changing anything
3. After making changes: call `sprang_diff_impact` with changed files to assess blast radius

**For architecture questions:** check `.sprang/SPRANG_REPORT.md` first.

**To rebuild:** type `/sprang`
