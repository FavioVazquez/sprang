---
description: Structural health report — shows risk distribution, code smells, orphan nodes, and test coverage gaps
---

# /sprang-health

Show the structural health of the codebase from the knowledge graph.

## Instructions

1. Check `.sprang/knowledge-graph.json` exists. If not, run `/sprang-analyze` first.

2. Read graph metadata: `phase`, `generated_at`, `project_name`, `stats`.

3. Read all nodes to compute:
   - Risk distribution: count nodes by risk_score bucket (high ≥0.7, medium ≥0.4, low <0.4)
   - Top 10 riskiest nodes (highest risk_score) with their risk_factors
   - Test coverage: nodes with at least one `tested_by` edge vs total code nodes
   - Orphan nodes: nodes with 0 edges (neither source nor target in any edge)
   - God nodes: nodes with >15 edges total

4. Read `stats.smell_summary` for smell distribution.

5. Read layers to identify:
   - Layers with no test coverage
   - Layers with disproportionate risk concentration

6. **Report:**

   ## Health Report: <project_name>
   Generated: <generated_at> | Phase: <phase>
   <if phase=skeleton: "⚠️ Run /sprang-analyze for full semantic analysis and accurate scores">

   ### Overview
   - **Nodes**: <N> | **Edges**: <E> | **Layers**: <L>

   ### Risk Distribution
   ```
   High   (≥0.7): ████░░░░░░  N nodes
   Medium (≥0.4): ████████░░  N nodes
   Low    (<0.4): ██████████  N nodes
   ```

   ### Top Risky Nodes
   | File | Risk | Factors |
   |------|------|---------|
   | <name> | 0.XX | high_coupling, no_test_coverage |

   ### Code Smells
   | Smell | Count | Severity |
   |-------|-------|----------|
   | god_node | N | high |
   | circular_dependency | N | high |
   | orphan_node | N | low |

   ### Test Coverage
   - **Covered**: N nodes (X%)
   - **Uncovered**: N nodes
   - **Layers with no test coverage**: <list>

   ### Orphan Nodes
   <list files with no connections — may be dead code or need cleanup>

   ### Recommendations
   1. <highest priority fix — e.g., "Add tests for <high-risk untested file>">
   2. <second priority — e.g., "Refactor <god_node> — it has 23 dependencies">
   3. <third priority>

7. Suggest: `/sprang-explain <top-risky-file>` to understand the highest-risk node, or `/sprang-analyze --full` to refresh.
