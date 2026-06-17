---
name: sprang-health
description: Full structural health report — health grade, code smells, security issues, risk nodes, orphans, circular dependencies. Use when the user says "/sprang-health", "health report", "code smells", "show risks", "what's broken", "security issues", or "architectural health".
---

Full structural health report for the knowledge graph.

1. Call `sprang_health` to retrieve the full health report.
2. **Lead with the health grade**: display `health_grade` (A–F) and `health_score` (0–100) prominently. Show the grade breakdown (which factors cost the most points).
3. Display graph phase (`skeleton` or `complete`), generated_at timestamp, total nodes, and total edges.
4. Present the risk distribution table: high, medium, and low counts. Note if high-risk nodes exceed 10% of total.
5. List the top 10 risky nodes with label, type, risk score, and risk factors. Call `sprang_node` on any with `god_node` or `circular_dependency` warnings for detail.
6. List all detected code smell categories from `smell_summary` with counts and a one-sentence description of each smell type.
7. **Report security findings** from `security_summary`: total count, breakdown by severity (high/medium/low) and by category (hardcoded_secret, sql_injection, xss_risk, etc.). Flag any `high` severity findings as immediate priorities.
8. Report `orphan_count` (isolated nodes) and `nodes_without_tests` as actionable gaps to address.
9. If `history` has entries, show the score trend (first vs latest snapshot) to indicate whether health is improving or degrading.
10. Recommend a prioritized action list: security issues first (if high severity), then smells to address, then nodes to add tests for, then when to re-run `/sprang-analyze`.

