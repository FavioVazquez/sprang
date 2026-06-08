---
name: sprang-analyze
description: Analyze a codebase to produce a rich semantic knowledge graph — file summaries, architecture layers, guided tour, domain map, risk scores. Use when the user says "/sprang-analyze", "analyze the codebase", "full analysis", or "run sprang-analyze".
---

Analyze a codebase to produce a rich semantic knowledge graph — file summaries, architecture layers, guided tour, domain map, risk scores.

Arguments: `[path] [--full] [--language <lang>] [--chunk <N>]`

Produce `.sprang/knowledge-graph.json` for the project with full semantic enrichment.
You are the analysis engine — read every file and write rich understanding into the graph.

> **CRITICAL:** Complete ALL 7 phases in one run. Stopping early leaves the Architecture, Domains, and Learn tabs empty.
> **RESUME:** If graph already exists at `phase: complete`, jump to Phase 4 to re-run enrichment only.

Follow the detailed instructions in `.windsurf/workflows/sprang-analyze.md`.

Key options:
- `--full` — force complete rebuild even if graph exists
- `--language <lang>` — output summaries in ISO language code (zh, ja, ko, es, fr, de, pt, ru)
- `--chunk <N>` — split output into chunks of N nodes

Phases (see workflow for full details):
1. **Pre-flight** — resolve project root, `.sprangignore`, incremental vs full, collect README/manifest context
2. **Scan** — enumerate files, detect languages/frameworks, build import map → `scan-result.json`
3. **Analyze files** — semantic batching, max 10 files/batch, max 800 lines/batch → `final-nodes-chunk-*.json`, `final-edges.json`
4. **Architecture layers** — assign every node to a layer → **write `final-layers.json` directly** (not layers.json)
5. **Guided tour** — 5-8 BFS-ordered steps → **write `final-tours.json` directly** as a Tour object array (not a flat step array)
6. **Domain mapping** — cluster into business domains → **write `final-domains.json`** with domain/flow/step hierarchy
7. **Risk + smells** — git history per node → **write `risk-scores.json`** with `risk_score`, `risk_factors`, `structural_warnings`, AND `decision_context` (commits, authors, rationale_snippets)
8. **Assemble** — run `PROJECT_ROOT="$PROJECT_ROOT" python3 .windsurf/skills/sprang-analyze/scripts/merge.py` (fallback: `skills/sprang-analyze/scripts/merge.py`). Then write `SPRANG_REPORT.md`.

> ⚠️ merge.py reads: `final-nodes-chunk-*.json`, `final-edges.json`, `final-layers.json`, `final-tours.json`, `final-domains.json`, `risk-scores.json`, `assembled-graph.json`. All must exist before running it.

$ARGUMENTS
