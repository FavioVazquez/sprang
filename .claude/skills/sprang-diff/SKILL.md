---
name: sprang-diff
description: Blast radius analysis for changed files — shows what will break if you change something. Use when the user says "/sprang-diff", "what will break", "blast radius", "impact analysis", or "what depends on this".
argument-hint: "[files...]"
---

Blast radius analysis for changed files — what is affected before you commit.

Arguments: `[file1 file2 ...]` (optional — uses git diff if omitted)

## Instructions

1. Check `.sprang/knowledge-graph.json` exists. If not, run the `sprang-analyze`
   skill first.

2. **Collect changed files.** If arguments were provided, parse them as
   space/comma-separated paths. Otherwise:
   ```bash
   git diff --name-only HEAD 2>/dev/null
   git diff --name-only --cached 2>/dev/null
   # On a feature branch, also compare against the base branch
   git diff main...HEAD --name-only 2>/dev/null || git diff master...HEAD --name-only 2>/dev/null
   ```
   Deduplicate into CHANGED_FILES.

3. Call `sprang_diff_impact` with CHANGED_FILES to compute the full blast radius
   (BFS over incoming edges). It returns `changed_nodes` (directly touched),
   `impact_nodes` (everything that transitively depends on them), `risk_counts`,
   and `total_impact`.

4. Call `sprang_node` on each changed node to get `layer`, `in_degree`,
   `out_degree`, `risk_score`, and `has_annotation`.

5. Identify affected layers — which architectural boundaries the change crosses.

6. Compute the risk assessment:
   - **Blast radius**: count of directly + transitively affected nodes
   - **Cross-layer changes**: how many layer boundaries are crossed
   - **High risk**: any changed or impacted node with `risk_score >= 0.7`
   - **Critical path**: any changed node with `in_degree > 10`
   - For any node with `circular_dependency` or `god_node` in
     `structural_warnings`, explain the specific risk.

7. **Write the diff overlay for the dashboard** — `.sprang/diff-overlay.json`:
   ```json
   {
     "version": "1.0.0",
     "generatedAt": "<ISO timestamp>",
     "baseBranch": "<base branch>",
     "changedFiles": ["<list>"],
     "changedNodeIds": ["<list>"],
     "affectedNodeIds": ["<transitively affected, excluding changedNodeIds>"],
     "blastRadius": 0,
     "crossLayerChanges": 0
   }
   ```
   This drives the amber/warm-gray highlighting in the dashboard Graph view.

8. **Report:**
   - **Changed components** — for each changed file: name, summary, layer, risk score
   - **Blast radius** — direct dependents with summaries; transitive reach (N nodes across M layers)
   - **Affected layers** — each layer touched with a brief impact description
   - **Risk assessment** — high risk (explain why), watch, safe
   - **Recommendations** — what to test before merging, cross-layer concerns,
     and `sprang-explain <highest-risk-changed-file>` for a deeper look

$ARGUMENTS
