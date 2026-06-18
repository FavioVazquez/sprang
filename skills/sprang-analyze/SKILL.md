---
name: sprang-analyze
description: Analyze a codebase to produce a rich semantic knowledge graph — file summaries, architecture layers, guided tour, domain map, risk scores. Use when the user says "/sprang-analyze", "analyze the codebase", "full analysis", or "run sprang-analyze".
argument-hint: ["[path] [--full] [--language <lang>] [--chunk <N>]"]
---

Analyze the codebase and produce `.sprang/knowledge-graph.json` with full semantic enrichment.
You are the analysis engine — read every file, write rich summaries, detect architecture, score risk.

> **CRITICAL:** Complete ALL 8 phases (Phase 0 through Phase 7) in one run. Stopping early leaves the Architecture, Domains, and Learn tabs empty.
> **RESUME:** If graph already exists at `phase: complete`, jump to Phase 4 to re-run enrichment only.

Follow the detailed instructions in `.windsurf/workflows/sprang-analyze.md`.

Key options:
- `--full` — force complete rebuild even if graph exists
- `--language <lang>` — output summaries in a specific language (ISO code: zh, ja, ko, es, fr, de, pt, ru)
- `--chunk <N>` — split output into chunks of N nodes

Phases (full details in `.windsurf/workflows/sprang-analyze.md`):
1. **Pre-flight** — resolve project root, `.sprangignore`, incremental vs full, collect README/manifest context
2. **Scan** — enumerate files, detect languages/frameworks, build import map → write `scan-result.json`
3. **Analyze files** — semantic batching (related files together), max 10 files/batch, max 800 lines/batch → write `final-nodes-chunk-*.json`, `final-edges.json`, `assembled-graph.json`
4. **Architecture layers** — assign every node to a layer → write **`final-layers.json`** directly (not `layers.json`)
5. **Guided tour** — 5-8 BFS-ordered steps → write **`final-tours.json`** as a Tour object array (not a flat step array — must have `id`, `title`, `description`, `steps`)
6. **Domain mapping** — cluster into business domains → write **`final-domains.json`** with domain/flow/step structure
7. **Risk + smells** → write **`risk-scores.json`** as `{"<node-id>": {"risk_score": 0.0, "risk_factors": [], "structural_warnings": [], "decision_context": {...}}}` — merge.py applies all fields to nodes
8. **Assemble** — prefer the CLI `sprang merge "$PROJECT_ROOT"` (normalises + validates, no Python needed); if `sprang` is not on PATH, fall back to `PROJECT_ROOT="$PROJECT_ROOT" python3 .windsurf/skills/sprang-analyze/scripts/merge.py` (or `skills/sprang-analyze/scripts/merge.py`). Then write `SPRANG_REPORT.md`.

> ⚠️ Both readers consume these exact filenames: `final-nodes-chunk-*.json`, `final-edges.json`, `final-layers.json`, `final-tours.json`, `final-domains.json`, `risk-scores.json`, `assembled-graph.json`. All must exist before assembling.

After completion: report files analyzed, nodes/edges, top risks, layers and domains found. Suggest `/sprang-chat` to ask questions, `/sprang-onboard` for guided tour, open dashboard with `pnpm --filter @sprang/dashboard dev`.
