---
name: sprang-analyze
description: Analyze a codebase to produce a rich semantic knowledge graph — file summaries, architecture layers, guided tour, domain map, risk scores. Use when the user says "/sprang-analyze", "analyze the codebase", "full analysis", or "run sprang-analyze".
---

Analyze a codebase to produce a rich semantic knowledge graph — file summaries, architecture layers, guided tour, domain map, risk scores.

Arguments: `[path] [--full] [--language <lang>] [--chunk <N>]`

Produce `.sprang/knowledge-graph.json` for the project with full semantic enrichment.
You are the analysis engine — read every file and write rich understanding into the graph.

> **CRITICAL:** Complete ALL 6 phases in one run. Do not stop after Phase 2 — Architecture and Learn tabs need Phases 3–6.
> **RESUME:** If graph already exists at `phase: enriched`, skip Phases 0–2 and start at Phase 3.

Follow the detailed instructions in `.windsurf/workflows/sprang-analyze.md`.

Key options:
- `--full` — force complete rebuild even if graph exists
- `--language <lang>` — output summaries in ISO language code (zh, ja, ko, es, fr, de, pt, ru)
- `--chunk <N>` — split output into chunks of N nodes

Quick phases:
1. **Pre-flight** — resolve project root, check `.sprangignore`, detect incremental vs full, collect README/manifest context
2. **Scan** — enumerate files, detect languages/frameworks, build import map
3. **Analyze files** — semantic batching (related files together), **max 10 files/batch, max 800 lines/batch**, always write results as chunk files (never inline JSON)
4. **Detect architecture** — layer assignment (data/domain/api/ui/infra), dependency graph, cycle detection
5. **Build tour** — 5-8 ordered pedagogical steps based on graph topology
6. **Domain mapping** — cluster imports into business domain → flow → step hierarchy
7. **Risk scoring** — blast radius, coupling, test gap, churn (0.0–1.0 per node)
8. **Finalize** — write complete `knowledge-graph.json` (phase: "complete"), write `SPRANG_REPORT.md`

$ARGUMENTS
