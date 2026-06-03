# Sprang — Knowledge Graph

This repository has Sprang installed. A knowledge graph is available at `.sprang/knowledge-graph.json` once built.

## Available Commands

| Command | Description |
|---|---|
| `/sprang` | Build or refresh the full knowledge graph |
| `/sprang-onboard` | Guided architecture tour for new team members |
| `/sprang-diff` | Blast radius analysis for your current changes |
| `/sprang-why [file]` | Understand why something exists (git + annotations) |
| `/sprang-health` | Structural health report and code smell summary |
| `/sprang-domain` | Map code to business processes |
| `/sprang-team` | Surface all team annotations |

## Graph Files (commit these)
- `.sprang/knowledge-graph.json` — full knowledge graph
- `.sprang/SPRANG_REPORT.md` — architectural insights
- `.sprang/annotations/` — team knowledge tied to nodes

## For Cascade
MCP tools available: `sprang_query`, `sprang_node`, `sprang_diff_impact`, `sprang_tour`, `sprang_domain`, `sprang_health`, `sprang_why`, `sprang_annotate`

Before editing any file: call `sprang_node` with its path to check risk_score and structural_warnings.

## For Devin Local
All 7 slash commands above work. If no graph exists yet: run `/sprang` to build one.

*New to this codebase? Run `/sprang-onboard` first.*
