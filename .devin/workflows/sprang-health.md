---
description: Structural health report — shows risk distribution, code smells, orphan nodes, and test coverage gaps
---

1. Call `sprang_health` to retrieve the comprehensive health report for the current knowledge graph.
2. Report the graph phase (`skeleton` or `complete`) and when it was last generated. If it is a skeleton, remind the user that Phase 2 enrichment may still be running.
3. Display the risk distribution: high, medium, and low risk node counts. Highlight if high-risk nodes exceed 10% of total nodes.
4. List the top 10 risky nodes with their labels, types, risk scores, and risk factors. For each factor of `circular_dependency` or `god_node`, call `sprang_node` to provide detail.
5. Report smell categories from `smell_summary` and their counts. Explain each detected smell type in one sentence.
6. Flag the orphan count (nodes with no edges) and `nodes_without_tests` count as actionable items.
7. Recommend next steps: which nodes to refactor first, whether to run `/sprang-diff` before the next commit, and whether to re-run `/sprang` to get a fresh graph.
