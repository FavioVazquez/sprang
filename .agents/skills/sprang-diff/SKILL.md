---
name: sprang-diff
description: Blast radius analysis for changed files. Pass a list of file paths as $ARGUMENTS, or leave empty to use git-diff to detect changed files automatically.
---

1. If $ARGUMENTS is provided, parse it as a space- or comma-separated list of file paths. Otherwise run `git diff --name-only HEAD` to collect changed files.
2. Call `sprang_diff_impact` with the collected file paths to compute the full blast radius.
3. Report `changed_nodes` (what you directly touched) and `impact_nodes` (everything that depends on those files).
4. Flag all impact nodes with `risk_score >= 0.7` as high-risk dependents requiring careful review.
5. For any high-risk impact node that has `circular_dependency` or `god_node` in `structural_warnings`, call `sprang_node` to retrieve the full warning details.
6. If `total_impact > 10`, recommend explaining the scope of the change in the PR description.
7. Summarize: N files changed, M dependents affected, K high-risk. Safe to proceed or review recommended.
