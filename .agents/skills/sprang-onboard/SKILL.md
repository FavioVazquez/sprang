---
name: sprang-onboard
description: Guided architecture tour for new team members. Walks through the codebase structure, domains, and risk areas using the Sprang knowledge graph.
---

1. Ensure `.sprang/knowledge-graph.json` exists. If not, run `/sprang` to build it first.
2. Call `sprang_health` to summarize total nodes, edges, and top risk areas.
3. Call `sprang_tour` with `persona: "junior"` to load the guided architecture tour and present each step with its explanation.
4. For any node with `risk_score > 0.6` encountered in the tour, call `sprang_why` to explain the decision context.
5. Call `sprang_domain` to list all business domains and explain how code maps to real-world processes.
6. Highlight the top 3 highest-risk nodes the newcomer should be aware of before making changes.
7. Recommend reading `.sprang/SPRANG_REPORT.md` and running `/sprang-diff` before submitting the first PR.
