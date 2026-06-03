---
name: sprang-analyze
description: Analyze a codebase to produce a rich semantic knowledge graph — file summaries, architecture layers, guided tour, domain map, risk scores. Better than /understand. Use when asked to understand, analyze, or map a codebase.
argument-hint: ["[path] [--full] [--language <lang>] [--chunk <N>]"]
---

Analyze the codebase and produce `.sprang/knowledge-graph.json` with full semantic enrichment.
You (Cascade) are the analysis engine — read every file, write rich summaries, detect architecture, score risk.

Follow the detailed instructions in `.windsurf/workflows/sprang-analyze.md`.

Key options:
- `--full` — force complete rebuild even if graph exists
- `--language <lang>` — output summaries in a specific language (ISO code: zh, ja, ko, es, fr, de, pt, ru)
- `--chunk <N>` — split large graphs into chunks of N nodes (use for projects >2000 nodes)

Quick summary of phases:
1. **Pre-flight** — resolve project root, check `.sprangignore` (respects glob patterns), detect incremental vs full, collect README/manifest context
2. **Scan** — enumerate files (filtered by .sprangignore), detect languages/frameworks, build import map
3. **Analyze files** — **semantic batching** (related files together), batches of up to 20 files, output chunking for large projects
4. **Architecture layers** — cluster into 3-10 logical layers (UI, API, services, data, infra, config, docs, tests, utilities)
5. **Guided tour** — BFS-ordered learning walkthrough from entry point through all layers
6. **Risk + smells** — git churn, coupling, test gaps, blast radius; 8 smell detectors
7. **Save** — write `knowledge-graph.json` with `"kind": "codebase"` + `SPRANG_REPORT.md`

After completion: report files analyzed, nodes/edges, top risks, architecture layers found. Suggest `/sprang-chat` to ask questions, `/sprang-onboard` for guided tour, open dashboard with `pnpm --filter @sprang/dashboard dev`.
