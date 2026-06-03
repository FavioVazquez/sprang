---
description: Understand why a file or function exists — surfaces git history, decision context, and team annotations
---

# /sprang-why

Explain why a specific file or function exists, who built it, and what decisions shaped it.

Arguments: `$ARGUMENTS` — file path or `path:functionName`

## Instructions

1. Check `.sprang/knowledge-graph.json` exists. If not, run `/sprang-analyze` first.

2. **Find the target node** — grep the graph for `$ARGUMENTS`. Get its `id`, `summary`, `decision_context`, `annotations`, `risk_factors`, `structural_warnings`.

3. **Read decision context from the graph** (`decision_context` field):
   - `commits[]`: sha, date, message, author, diff_summary
   - `primary_authors[]`
   - `last_changed`
   - `change_frequency`
   - `rationale_snippets[]` (extracted from commit messages)
   - `pr_references[]`
   - `changelog_entries[]`

4. **If decision_context is sparse** (skeleton graph), fetch directly from git:
   ```bash
   # Full commit history for the file
   git -C "$PROJECT_ROOT" log --follow --format="%H|%ae|%as|%s|%b" -- "$filePath" | head -30
   
   # Who wrote the most lines currently
   git -C "$PROJECT_ROOT" blame --line-porcelain "$filePath" 2>/dev/null | grep "^author " | sort | uniq -c | sort -rn | head -5
   
   # Recent changes with full diffs
   git -C "$PROJECT_ROOT" log --follow -5 -p -- "$filePath" 2>/dev/null
   ```

5. **Read team annotations** — grep the graph for `annotations` on this node. These are human-written notes from the team.

6. **Read the actual source file** to understand current state.

7. **Explain:**

   ### Why `<filename>` exists

   **Purpose**: <what it does in business terms, not just technical terms>

   **Origin**: <when it was created, what feature/need prompted it>

   **Evolution**:
   - <key changes in chronological order, with dates and authors>
   - <what problems each change solved>

   **Decision history** (from commit messages):
   > <significant commit message 1>
   > <significant commit message 2>

   **Current owners**: <primary authors>
   **Last changed**: <date> by <author>
   **Change frequency**: <N commits in last 90 days — stable/active/churning>

   **Team notes** (annotations):
   <any human annotations from the team>

   **Risk context**:
   - Risk score: <score> — <why: what factors drive it>
   - Structural warnings: <if any>
   - **Recommendation**: <should this be refactored? is it stable? is it critical path?>

8. Offer to add an annotation:
   > "Would you like to add a note about this file for your team? I can write it to `.sprang/annotations/<filename>.md` and it will show in future `/sprang-why` calls."
