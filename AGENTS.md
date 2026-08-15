# Sprang — Knowledge Graph

This repository has Sprang installed: a persistent knowledge graph of the codebase (or of a markdown vault) that you can query through MCP tools instead of re-deriving structure from scratch.

**Graph location:** `.sprang/knowledge-graph.json` (built by `/sprang` or `sprang scan`).
Also in `.sprang/`: `SPRANG_REPORT.md` (architecture summary), `annotations/` (team knowledge — commit these), `diff-overlay.json` (blast radius for the dashboard).

If no graph exists yet, run `/sprang`. New to this codebase? Run `/sprang-onboard`.

---

## Before you edit any file

1. `sprang_node(<file-path>)` — check `risk_score`, `structural_warnings`, `in_degree`, `has_annotation`.
2. If `risk_score > 0.7` — `sprang_why(<node-id>)` and read the decision context and annotation before changing anything.
3. After the change — `sprang_diff_impact({ files: [...] })`. If `total_impact > 10`, say so and document the scope.

For architecture questions, read `.sprang/SPRANG_REPORT.md` first.

---

## Skills (11)

| Skill | When to use |
|---|---|
| `/sprang` | Build or refresh the graph — auto-detects codebase vs markdown notes |
| `/sprang-analyze [path] [--full] [--language <lang>] [--chunk N]` | Full LLM-driven analysis: summaries, layers, tour, risk |
| `/sprang-knowledge [path] [--format obsidian\|logseq\|...] [--full]` | Build a graph from markdown notes |
| `/sprang-chat <question>` | Ask any question about the codebase |
| `/sprang-explain <file \| path:function>` | Deep-dive on a file or function |
| `/sprang-onboard [persona]` | Guided architecture tour — junior / senior / pm / non-technical |
| `/sprang-diff [files...]` | Blast radius for current changes; writes the dashboard diff overlay |
| `/sprang-domain [name]` | Map code to business processes |
| `/sprang-why <file>` | Git history + decision context + team annotations |
| `/sprang-health` | Health grade, smells, risk, orphans, circular deps |
| `/sprang-team [node]` | Browse/write team annotations with staleness detection |

---

## MCP tools (12)

| Tool | One-liner |
|---|---|
| `sprang_query` | `{ query, node_types?, limit?, mode? }` — find nodes; `mode: "semantic"` for embedding search |
| `sprang_node` | `{ node_id }` — full node, 1-hop neighbors, layer, degrees, annotation status |
| `sprang_diff_impact` | `{ files }` — BFS blast radius, risk-ranked |
| `sprang_why` | `{ node_id }` — git decision context + team annotation |
| `sprang_coupled` | `{ file, since_months?, limit? }` — files that historically change together with this one, from git. Flags **hidden** couplings with no dependency path — the ones static analysis cannot find. |
| `sprang_traps` | `{ file?, since_months?, limit? }` — past changes here that were reverted or urgently fixed. Read before editing so the same mistake is not repeated. |
| `sprang_owners` | `{ file, since_months? }` — recency-weighted ownership, main developer, bus factor, knowledge diffusion. |
| `sprang_health` | `{}` — grade A–F, score, smells, security summary, top-10 risk, history |
| `sprang_tour` | `{ tour_id?, persona? }` — ordered guided tour |
| `sprang_domain` | `{ domain_name? }` — business domains, flows, entry points |
| `sprang_annotate` | `{ node_id, content, tags? }` — write `.sprang/annotations/<id>.md` |
| `sprang_respond` | `{ response, question? }` — answer a dashboard Ask Agent question |

If a tool returns `GRAPH_NOT_FOUND`, no graph exists — run `/sprang`. If it returns `GRAPH_INVALID`, the graph exists but fails schema validation: the error lists the real issues; re-run `sprang merge` or `/sprang-analyze`. A re-scan will not fix it.

---

## Working on Sprang itself

`skills/`, `.devin/rules/` and `.devin/hooks/` are **canonical**. `.devin/skills/`, `.claude/skills/`, `.claude/rules/` and `.claude/hooks/` are **generated** — edit the canonical source, then run `pnpm sync:agents`. CI fails on drift.

---

Everything else — installation per platform, dashboard, CLI reference, pipeline, schema, troubleshooting — is in [README.md](README.md).
