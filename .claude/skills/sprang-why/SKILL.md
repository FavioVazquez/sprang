---
name: sprang-why
description: Understand why a file or function exists — git history, decision context, team annotations. Use when the user says "/sprang-why", "why does this exist", "who wrote this", "history of this file", or "what decisions led to this".
argument-hint: "<file | path:function>"
---

Explain why a specific file or function exists, who built it, and what decisions
shaped it.

Arguments: `<file path or path:functionName>`

## Instructions

1. Check `.sprang/knowledge-graph.json` exists. If not, run the `sprang-analyze`
   skill first.

2. Call `sprang_query` with the argument to find the matching node ID.

3. Call `sprang_why` with the resolved `node_id` to retrieve `decision_context`:
   - `commits[]`: sha, date, message, author
   - `primary_authors[]`, `last_changed`, `change_frequency`
   - `rationale_snippets[]` (extracted from commit messages)
   - `pr_references[]`, `changelog_entries[]`
   - plus any team annotation and its path

4. Call `sprang_node` with the same `node_id` to get:
   - `layer` (name + id) and `layer_mate_count` — where it fits in the architecture
   - `in_degree` / `out_degree` — how coupled it is
   - `has_annotation` / `annotation_path` — whether team knowledge exists
   - the full 1-hop neighbor list

5. **If decision context is sparse** (skeleton graph), fetch it directly from git:
   ```bash
   git -C "$PROJECT_ROOT" log --follow --format="%H|%ae|%as|%s|%b" -- "$filePath" | head -30
   git -C "$PROJECT_ROOT" blame --line-porcelain "$filePath" 2>/dev/null \
     | grep "^author " | sort | uniq -c | sort -rn | head -5
   git -C "$PROJECT_ROOT" log --follow -5 -p -- "$filePath" 2>/dev/null
   ```

6. If `has_annotation` is true, display the full annotation content prominently.

7. Read the actual source file to understand its current state.

8. **Explain:**
   - **Purpose** — what it does in business terms, not just technical terms
   - **Origin** — when it was created and what need prompted it
   - **Evolution** — key changes in chronological order with dates and authors,
     and what problem each solved
   - **Decision history** — quote the significant commit messages
   - **Current owners** — primary authors; last changed date and author
   - **Change frequency** — commits in the last 90 days. If
     `change_frequency >= 10`, flag as **frequently-churning** — extra care required
   - **Team notes** — any human annotations
   - **Risk context** — risk score and the factors behind it, structural
     warnings, and a recommendation (refactor, stable, critical path). Give
     specific guidance before modifying, especially if `risk_score > 0.7`

9. Cross-reference `pr_references` with related notes or changelog entries.

10. Offer to add an annotation with `sprang_annotate` — it writes
    `.sprang/annotations/<node-id>.md` and shows up in future runs of this skill.

$ARGUMENTS
