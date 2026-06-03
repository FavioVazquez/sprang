---
description: Blast radius analysis for current staged or unstaged changes — shows what is affected before you commit
---

# /sprang-diff

Analyze your current code changes against the knowledge graph to understand blast radius and risk before committing.

## Instructions

1. Check that `.sprang/knowledge-graph.json` exists. If not, run `/sprang-analyze` first.

2. **Get changed files** (do NOT read the graph yet):
   ```bash
   # Uncommitted changes (staged + unstaged)
   git diff --name-only HEAD 2>/dev/null
   git diff --name-only --cached 2>/dev/null
   # If on a feature branch, also show changes vs main/master
   git diff main...HEAD --name-only 2>/dev/null || git diff master...HEAD --name-only 2>/dev/null
   ```
   Deduplicate and store as CHANGED_FILES list.

3. **Read project metadata** — grep for `project_name` and `description` at the top of `.sprang/knowledge-graph.json`.

4. **Find nodes for changed files** — for each path in CHANGED_FILES, grep the graph for `"filePath": "<path>"`. Get the node's `id`, `summary`, `risk_score`, `complexity`, and `layer`.

5. **Find 1-hop affected nodes** — for each changed node ID, grep the edges section:
   - `"target": "<id>"` → nodes that depend on the changed node (AFFECTED — may break)
   - `"source": "<id>"` → nodes that the changed node depends on (dependencies)

6. **Find 2-hop affected nodes** — for each affected node from step 5, repeat to find transitive blast radius. Stop at 2 hops to keep it practical.

7. **Identify affected layers** — grep `layers[*].node_ids` to find which architectural layers are touched by changed + affected nodes.

8. **Compute risk assessment:**
   - **Blast radius**: total count of directly + transitively affected nodes
   - **Cross-layer changes**: how many layer boundaries are crossed
   - **High-risk changes**: any changed node with `risk_score > 0.6`
   - **Critical path changes**: any changed node that is imported by >10 other nodes

9. **Write diff overlay** for the dashboard:
   ```bash
   cat > ".sprang/diff-overlay.json" << 'EOF'
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
   EOF
   ```

10. **Report to user:**

    ### Changed Components
    For each changed file: name, summary, layer, risk score

    ### Blast Radius
    - **Direct dependents**: <list with summaries>
    - **Transitive reach**: <N> nodes across <M> layers

    ### Affected Layers
    <list layers touched with brief impact description>

    ### Risk Assessment
    - 🔴 **High risk**: <any high-risk nodes — explain why>
    - 🟡 **Watch**: <moderate concerns>
    - 🟢 **Safe**: <low-risk changes>

    ### Recommendations
    - What to test before merging
    - Any cross-layer concerns to review
    - Suggest running `/sprang-explain <highest-risk-changed-file>` for deeper analysis
