---
description: Guided architecture tour for new team members — walk through the codebase using the Sprang knowledge graph
---

1. Ensure the graph exists by checking `.sprang/knowledge-graph.json`. If missing, run `/sprang` first.
2. Call `sprang_health` to get the overall picture: node count, edge count, and top-risk areas to be aware of.
3. Call `sprang_tour` with `persona: "junior"` to retrieve the full guided tour. Present each step in order: step title, explanation, and relevant node details.
4. For any tour node with `risk_score > 0.6`, pause and call `sprang_why` to explain the decision context — why does this node exist, who changed it, what were the reasons.
5. Call `sprang_domain` to list all business domains and explain how the code maps to real-world concepts.
6. Summarize the three most important architectural insights from the tour and note any high-risk nodes the new team member should be careful with.
7. Suggest reading `.sprang/SPRANG_REPORT.md` for the full architectural overview and offer to run `/sprang-diff` before any first commit.
