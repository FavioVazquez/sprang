---
name: sprang
description: Build or refresh the Sprang knowledge graph. Analyzes all files, builds nodes/edges, detects code smells, scores risk.
---

1. Check if `.sprang/knowledge-graph.json` exists and note its age.
2. Run `npx sprang scan $ARGUMENTS` (use current directory if no args).
3. Wait for Phase 1 to complete (skeleton graph, <60s).
4. Read `.sprang/SPRANG_REPORT.md` and display the key findings.
5. Report: total files, nodes created, top risks found, smells detected.
6. Phase 2 analysis continues in background — check back with `/sprang-health` when done.
