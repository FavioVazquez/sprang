---
description: Guided architecture tour for new team members — walks through the codebase structure, domains, and risk areas using the Sprang knowledge graph
---

# /sprang-onboard

Generate a comprehensive onboarding guide for someone new to this codebase.

## Instructions

1. Check `.sprang/knowledge-graph.json` exists. If not, run `/sprang-analyze` first.

2. **Read project metadata** — grep for `project_name`, `description`, `languages`, `frameworks`.

3. **Read layers** — grep for `"layers"` to get all architectural layers with their descriptions and node_ids.

4. **Read the guided tour** — grep for `"tours"` to get the ordered walkthrough steps.

5. **Detect or ask about persona** — adapt the depth of the guide to the audience:
   - `non-technical` — executive / business stakeholder: entry-points and domains only, no code details
   - `pm` — product manager: domain and service nodes, business capability focus
   - `junior` (default) — new developer: all steps with language lessons and step-by-step explanations
   - `senior` or `experienced` — experienced engineer: skip intro, focus on risks, coupling, and architecture decisions

   Read file-level nodes with types: file, config, document, service, pipeline, table, schema, resource, endpoint. Skip function/class nodes — keep the guide high-level. For each: name, filePath, summary, complexity, risk_score, layer.

6. **Read top-risk nodes** — from the file nodes, identify those with `risk_score > 0.5`. Read their `risk_factors` and `structural_warnings`.

7. **Read domain map** — if `domains[]` is non-empty, read it for business-domain context.

8. **Generate the onboarding guide** as clean markdown:

---

## Project Overview
<name, description, languages, frameworks, size (N files, M nodes)>

## Architecture at a Glance
<for each layer: name, description, key files (top 3-5 by importance/centrality)>

## How to Navigate This Codebase

### Entry Point
<explain ENTRY_POINT — what it does and what it bootstraps>

### Guided Tour (recommended learning path)
For each tour step, in order:
> **Step N: <title>**
> <explanation>
> Key files: <linked node names>

### Architecture Layers
For each layer:
> **<Layer Name>**
> <description>
> Files: <list key files with one-line summaries>

## Business Domains
<if domains exist: explain what business processes map to which code>
<if no domains: note this and suggest running `/sprang-domain`>

## What to Read First
Prioritized reading list based on centrality + tour order:
1. <most important file> — <why>
2. ...

## Complexity Hotspots ⚠️
Files to approach carefully (high complexity or risk):
For each high-risk node: name, reason, what to watch for

## Key Patterns & Conventions
<from node summaries and tags — recurring patterns, naming conventions, key abstractions>

## Quick Reference
- **Run the project**: <from README if found>
- **Run tests**: <from manifest/README>
- **Key commands**: <from package.json scripts or Makefile>

---

9. Offer to save the guide to `docs/ONBOARDING.md`:
   > "Would you like me to save this guide to `docs/ONBOARDING.md`? Committing it means your whole team gets it instantly."

10. Suggest: `/sprang-explain <most-complex-file>` to go deeper on the hardest part, `/sprang-chat` to ask any follow-up questions.
