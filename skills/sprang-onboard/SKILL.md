---
name: sprang-onboard
description: Guided architecture tour for new team members — adapts to junior, senior, or PM persona. Use when the user says "/sprang-onboard", "onboard me", "give me a tour", "I'm new to this codebase", or "walk me through the architecture".
---

Guided architecture tour for new team members.

1. Ensure `.sprang/knowledge-graph.json` exists with `phase: complete`. If not, run `/sprang-analyze` first.
2. Call `sprang_health` to summarize total nodes, edges, top risk areas, and smell counts.
3. Ask about persona (or infer from context):
   - `non-technical` — business-level overview, domain names, no code details
   - `junior` — full tour with explanations (default)
   - `experienced` — skip basics, go straight to risk areas and architecture decisions
4. Call `sprang_tour` with the appropriate persona (`junior`, `senior`, or `pm`) to load the guided tour. Present each step with its explanation.
5. For any tour node with `risk_score > 0.6`, call `sprang_why` to surface decision context and team annotations.
6. Call `sprang_node` on the top 3 highest-risk tour nodes to show layer membership, in/out degree, and annotation status.
7. Call `sprang_domain` to list all business domains and explain how code maps to real-world processes.
8. Highlight the top 3 highest-risk nodes the newcomer must be aware of before making changes.
9. Recommend:
   - Read `.sprang/SPRANG_REPORT.md` for the full architectural summary
   - Run `/sprang-diff` before submitting any PR
   - Open the dashboard: `pnpm --filter @sprang/dashboard dev` → switch to the **Learn** tab
