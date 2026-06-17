---
name: sprang
description: Build or refresh the Sprang knowledge graph for this workspace. Use when the user says "/sprang", "build the knowledge graph", "scan the codebase", "index this project", or "run sprang".
---

1. Check if `.sprang/knowledge-graph.json` exists — note its `generated_at`, `phase`, and `kind` (`codebase` or `knowledge`).
2. **Detect what to analyze:**
   - If the target directory has source code (`.ts`, `.py`, `.go`, `.rs`, etc.) → run `/sprang-analyze` for full LLM-driven codebase analysis.
   - If it contains primarily markdown notes (`.md`, Obsidian vault, Logseq, Zettelkasten) → run `/sprang-knowledge` for note graph analysis.
   - If both → ask the user which they want.
3. For **codebase**: run `npx @faviovazquez/sprang scan $ARGUMENTS` (use cwd if no args) to produce the skeleton graph (<60s), then follow `/sprang-analyze` for full enrichment.
4. For **knowledge base**: follow `/sprang-knowledge` directly — no CLI prerequisite needed.
5. Read `.sprang/SPRANG_REPORT.md` and display key findings.
6. Report: nodes created, edges, top insights, smells detected (codebase) or top connected notes (knowledge).
7. Suggest next steps: `/sprang-onboard` (codebase tour), `/sprang-chat` (ask questions), `/sprang-diff` (blast radius before commits), or open dashboard with `pnpm --filter @sprang/dashboard dev`.
