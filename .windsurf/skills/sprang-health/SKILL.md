---
name: sprang-health
description: Full structural health report — code smells, risk nodes, orphans, circular dependencies. Use when the user says "/sprang-health", "health report", "code smells", "show risks", "what's broken", or "architectural health".
---

1. Call `sprang_health` to retrieve the full health report from the current knowledge graph.
2. Display graph phase (`skeleton` or `complete`), generated_at timestamp, total nodes, and total edges.
3. Present the risk distribution table: high, medium, and low counts. Note if high-risk nodes exceed 10% of total.
4. List the top 10 risky nodes with label, type, risk score, and risk factors. Call `sprang_node` on any with `god_node` or `circular_dependency` warnings for detail.
5. List all detected code smell categories from `smell_summary` with counts and a one-sentence description of each smell type.
6. Report `orphan_count` (isolated nodes) and `nodes_without_tests` as actionable gaps to address.
7. Recommend a prioritized action list: which smells to address first, which nodes to add tests for, and when to re-run `/sprang`.
