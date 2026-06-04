---
name: sprang-diff
description: Blast radius analysis for changed files — shows what will break if you change something. Use when the user says "/sprang-diff", "what will break", "blast radius", "impact analysis", or "what depends on this".
---

Blast radius analysis for changed files.

Arguments: `[file1 file2 ...]` (optional — uses git diff if omitted)

1. If arguments provided, parse as space/comma-separated file paths. Otherwise run:
   ```bash
   git diff --name-only HEAD && git diff --name-only --cached
   ```
   and deduplicate.
2. Call `sprang_diff_impact` with the collected file paths to compute the full blast radius (BFS over incoming edges).
3. Report `changed_nodes` (directly touched) and `impact_nodes` (everything that transitively depends on those files).
4. Call `sprang_node` on each changed node to get `layer`, `in_degree`, `out_degree`, and `has_annotation`.
5. Flag all impact nodes with `risk_score >= 0.7` as high-risk dependents requiring careful review.
6. For any high-risk node with `circular_dependency` or `god_node` in `structural_warnings`, explain the specific risk.
7. **Write diff overlay for dashboard** — create `.sprang/diff-overlay.json`:
   ```json
   { "changedNodeIds": [...], "affectedNodeIds": [...], "blastRadius": N, "generatedAt": "<ISO>" }
   ```
   This enables amber/warm-gray highlighting in the Sprang dashboard's Graph view.

$ARGUMENTS
