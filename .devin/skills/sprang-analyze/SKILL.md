---
name: sprang-analyze
description: Analyze a codebase to produce a rich semantic knowledge graph — file summaries, architecture layers, guided tour, domain map, risk scores. Use when the user says "/sprang-analyze", "analyze the codebase", "full analysis", or "run sprang-analyze".
argument-hint: "[path] [--full] [--language <lang>] [--chunk <N>]"
---

Analyze the codebase and produce `.sprang/knowledge-graph.json` with full
semantic enrichment. You are the analysis engine — read every file, write rich
summaries, detect architecture, score risk.

> **CRITICAL:** Complete ALL 8 phases (Phase 0 through Phase 7) in one run.
> Stopping early leaves the Architecture, Domains, and Learn tabs empty.
> **NEVER** write `.sprang/knowledge-graph.json` yourself — Phase 7 assembles it.
> **RESUME:** If a graph already exists at `phase: complete`, jump to Phase 4 to
> re-run enrichment only.

For the full phase-by-phase procedure, read `REFERENCE.md` in this skill's
directory. Read it before starting — the summary below is not sufficient to
execute the skill correctly.

## Options

- `--full` — force complete rebuild even if a graph exists
- `--language <lang>` — output summaries in a specific language (ISO code: zh,
  ja, ko, es, fr, de, pt, ru)
- `--chunk <N>` — split node output into chunks of N nodes
- A directory path — analyze that directory instead of cwd

## Phases

1. **Pre-flight** — resolve `PROJECT_ROOT` and `SPRANG_ROOT="$PROJECT_ROOT/.sprang"`,
   read `.sprangignore`, decide incremental vs full, collect README/manifest
   context and the entry point.
2. **Scan** — enumerate files, detect languages/frameworks, build the
   project-internal import map → write `scan-result.json`.
3. **Analyze files** — semantic batching (related files together), max 10 files
   and ~800 lines per batch → write `final-nodes-chunk-*.json` (max 50 nodes
   each), `final-edges.json`, and `assembled-graph.json` (project metadata only).
4. **Architecture layers** — assign every file node to exactly one of 3-10
   layers → write **`final-layers.json`** directly (not `layers.json`).
5. **Guided tour** — 5-8 BFS-ordered steps → write **`final-tours.json`** as an
   array of Tour objects (not a flat step array — each needs `id`, `title`,
   `description`, `steps`).
6. **Domain mapping** — cluster into 2-6 business domains → write
   **`final-domains.json`** with domain/flow/step structure.
7. **Risk + smells + git layer** → write **`risk-scores.json`** as
   `{"<node-id>": {"risk_score": 0.0, "risk_factors": [], "structural_warnings": [], "decision_context": {...}}}`.
   The assemble step applies all of these fields to the nodes.
8. **Assemble** — prefer the CLI `sprang merge "$PROJECT_ROOT"` (normalises +
   validates, no Python needed). If `sprang` is not on PATH, fall back to
   `PROJECT_ROOT="$PROJECT_ROOT" python3 skills/sprang-analyze/scripts/merge.py`.
   Then write `.sprang/SPRANG_REPORT.md`.

> All intermediate files live in `.sprang/intermediate/` and both readers consume
> these exact names: `final-nodes-chunk-*.json`, `final-edges.json`,
> `final-layers.json`, `final-tours.json`, `final-domains.json`,
> `risk-scores.json`, `assembled-graph.json`. All must exist before assembling.

## Schema reminders

- Do NOT emit a `layer` field on nodes — layer membership comes from
  `final-layers.json`. A `layer` of `null` fails validation.
- Use only canonical edge types: `imports`, `exports`, `contains`, `inherits`,
  `implements`, `calls`, `subscribes`, `publishes`, `middleware`, `reads_from`,
  `writes_to`, `transforms`, `validates`, `depends_on`, `tested_by`,
  `configures`, `related`, `similar_to`, `deploys`, `serves`, `provisions`,
  `triggers`, `migrates`, `documents`, `routes`, `defines_schema`,
  `contains_flow`, `flow_step`, `cross_domain`, `cites`, `contradicts`,
  `builds_on`, `exemplifies`, `categorized_under`, `authored_by`.
- Test coverage is `tested_by`: source file → the test file that covers it (note
  the direction: source → test).

## After completion

Report files analyzed, nodes/edges, top risks, layers and domains found. Suggest
the `sprang-chat` skill to ask questions, `sprang-onboard` for the guided tour,
and `pnpm --filter @sprang/dashboard dev` to open the dashboard.
