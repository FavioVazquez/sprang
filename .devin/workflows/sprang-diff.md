---
description: Blast radius analysis for current staged or unstaged changes — shows what is affected before you commit
---

1. Identify changed files using `git diff --name-only HEAD` (or `git diff --cached --name-only` for staged). Collect all modified paths as a list.
2. Call `sprang_diff_impact` with the list of changed file paths to compute the blast radius.
3. Report `changed_nodes` (the files you touched), `total_impact` (how many dependent nodes are affected), and `high_risk_count` (dependents with risk_score >= 0.7).
4. For each node in `impact_nodes` with `risk_score >= 0.7`, call `sprang_node` to retrieve its structural warnings. Flag any `circular_dependency` or `god_node` warnings to the user.
5. If `total_impact > 10`, recommend adding a comment to the PR description explaining the intended scope of the change.
6. Suggest running the test suite for any affected test nodes identified in the impact graph.
7. Summarize: "You changed N files, affecting M dependent nodes (K high-risk). Safe to proceed / Review recommended."
