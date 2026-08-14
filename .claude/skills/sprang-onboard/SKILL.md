---
name: sprang-onboard
description: Guided architecture tour for new team members — adapts to junior, senior, or PM persona. Use when the user says "/sprang-onboard", "onboard me", "give me a tour", "I'm new to this codebase", or "walk me through the architecture".
argument-hint: "[junior|senior|experienced|pm|non-technical]"
---

Generate a guided architecture tour for someone new to this codebase.

## Instructions

1. Ensure `.sprang/knowledge-graph.json` exists with `phase: complete`. If not,
   run the `sprang-analyze` skill first.

2. Read project metadata: `project_name`, `description`, `languages`,
   `frameworks`, node/file counts.

3. Call `sprang_health` to summarize total nodes, edges, top risk areas, health
   grade, and smell counts.

4. **Detect or ask about persona** and adapt depth:
   - `non-technical` — business-level overview, domain names, entry points, no code
   - `pm` — domain and service nodes, business capability focus
   - `junior` (default) — full tour with step-by-step explanations
   - `senior` / `experienced` — skip basics, focus on risk, coupling, architecture decisions

5. Call `sprang_tour` with the persona to load the guided tour. Present each step
   with its title, explanation, and key files. Keep the guide high-level: prefer
   file, config, document, service, pipeline, table, schema, resource, and
   endpoint nodes; skip function/class nodes.

6. For any tour node with `risk_score > 0.6`, call `sprang_why` to surface
   decision context and team annotations.

7. Call `sprang_node` on the top 3 highest-risk tour nodes to show layer
   membership, in/out degree, and annotation status.

8. Call `sprang_domain` to list all business domains and explain how code maps to
   real-world processes. If no domains exist, say so and suggest the
   `sprang-domain` skill.

9. **Produce the onboarding guide** as clean markdown:

   ## Project Overview
   Name, description, languages, frameworks, size (N files, M nodes).

   ## Architecture at a Glance
   For each layer: name, description, top 3-5 key files by centrality.

   ## How to Navigate This Codebase
   - **Entry point** — what it does and what it bootstraps
   - **Guided tour** — each step in order: title, explanation, key files
   - **Architecture layers** — each layer with its files and one-line summaries

   ## Business Domains
   What business processes map to which code.

   ## What to Read First
   Prioritized reading list based on centrality plus tour order, with reasons.

   ## Complexity Hotspots
   The top 3 highest-risk nodes the newcomer must know before making changes:
   name, reason, what to watch for.

   ## Key Patterns & Conventions
   Recurring patterns, naming conventions, and key abstractions from node
   summaries and tags.

   ## Quick Reference
   How to run the project, how to run tests, key commands (from README,
   `package.json` scripts, or Makefile).

10. Offer to save the guide to `docs/ONBOARDING.md` so the whole team gets it.

11. Recommend next steps:
    - Read `.sprang/SPRANG_REPORT.md` for the full architectural summary
    - Run the `sprang-diff` skill before submitting any PR
    - `sprang-explain <most-complex-file>` to go deeper on the hardest part
    - Open the dashboard: `pnpm --filter @sprang/dashboard dev` → **Learn** tab
