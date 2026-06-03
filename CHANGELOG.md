# Changelog

All notable changes to Sprang are documented here.  
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).  
Versions follow [Semantic Versioning](https://semver.org/).

---

## [0.1.0] — 2026-06-03

Initial public release of the Sprang knowledge graph platform.

### Packages

| Package | Description |
|---|---|
| `@sprang/core` | Two-phase pipeline, 9 agents, schema, watcher, graph store |
| `@sprang/cli` | `sprang scan \| health \| query \| watch \| status` |
| `@sprang/mcp` | stdio MCP server — 8 tools for Cascade / Devin |
| `@sprang/dashboard` | React + Vite + Sigma.js — 4 views, 25 components |

---

### Added

#### Core pipeline (`@sprang/core`)

- **Two-phase pipeline** — Phase 1 is fully static (< 60s, no network); Phase 2 is driven by Cascade as the intelligence layer with no external API or API key required
- **`project-scanner`** — file discovery, language detection, import graph extraction
- **`file-analyzer`** — AST-level parsing for TypeScript/JavaScript, edge extraction (`imports`, `calls`, `contains`)
- **`smell-detector`** — 8 fully deterministic code smell heuristics: `god_node`, `circular_dependency`, `duplicate_logic`, `unclear_coupling`, `low_cohesion`, `unstable_interface`, `orphan_node`, `over_connected`
- **`risk-scorer`** — composite formula: `blast_radius×0.35 + coupling×0.25 + test_gap×0.25 + churn×0.15`, 0.0–1.0 per node, fully traceable `risk_factors[]`
- **`git-layer`** — decision context from version history: commits, primary authors, PR references, change frequency per 90 days
- **`architecture-analyzer`** — directory cohesion clustering into named architecture layers
- **`domain-analyzer`** — business domain mapping with flows, entry points, business rules
- **`tour-builder`** — BFS-ordered pedagogical tour generation, persona-adaptive (junior / senior / PM)
- **`graph-reviewer`** — final graph validation and `SPRANG_REPORT.md` generation
- **Graph schema** — 16 node types, 10+ edge types, `decision_context`, `structural_warnings`, `risk_score`, `risk_factors`, `knowledgeMeta`
- **Knowledge graph mode** — `kind: "knowledge"` for Obsidian / Logseq / Dendron / Foam / Zettelkasten / plain markdown
- **Live watcher** — chokidar with SHA-256 fingerprinting, 2s debounce, incremental re-analysis, atomic write
- **Zod schema validation** — full round-trip validators for all graph types

#### CLI (`@sprang/cli`)

- `sprang scan [path] [--phase1-only]` — Phase 1 static analysis or full scan trigger
- `sprang health` — print smell summary, risk table, orphans, circular deps
- `sprang query <term>` — fuzzy-search nodes by name or summary
- `sprang watch` — incremental watcher mode
- `sprang status` — graph age, phase, node/edge count

#### MCP server (`@sprang/mcp`)

8 tools exposed over stdio MCP protocol for Cascade and Devin Desktop:

| Tool | Purpose |
|---|---|
| `sprang_node` | Full node + 1-hop neighbors + layer + in/out degree + annotation flag |
| `sprang_query` | Fuzzy-ranked node search with type filter and limit |
| `sprang_diff_impact` | BFS blast-radius from changed files, risk-ranked |
| `sprang_why` | Decision context + git history + team annotation for a node |
| `sprang_health` | Smell summary, top-10 risk, orphans, circular deps, untested nodes |
| `sprang_tour` | Ordered pedagogical tour, persona-filtered |
| `sprang_domain` | Business domain list or detail with flows and entry points |
| `sprang_annotate` | Write `.sprang/annotations/<id>.md` with YAML frontmatter |

- **Hot-reload** — `GraphLoader` re-reads `knowledge-graph.json` on mtime change with no server restart
- **Enriched `sprang_node`** — returns `layer`, `layer_mate_count`, `in_degree`, `out_degree`, `has_annotation`, `annotation_path`

#### Dashboard (`@sprang/dashboard`)

- **Graph view** — Sigma.js force-directed canvas with risk heatmap, layer filter, diff overlay amber highlight, BFS pathfinder
- **Health view** — smell breakdown, top-10 risky nodes, circular deps, orphan count
- **Domains view** — business domain explorer, list view + React Flow layout toggle
- **Learn view** — persona-adaptive guided tour with language lessons, `TourPlayer`
- **25 components**: `CodeViewer`, `DiffToggle`, `ExportMenu`, `FileExplorer`, `FilterPanel`, `GraphCanvas`, `KnowledgeInfo`, `KeyboardShortcutsHelp`, `LayerLegend`, `LearnPanel`, `MobileLayout`, `MobileBottomNav`, `NodePanel`, `NodeTooltip`, `OnboardingOverlay`, `PathFinderModal`, `PersonaSelector`, `ReadingPanel`, `RiskOverlay`, `SearchBar`, `SmellBadge`, `ThemePicker`, `TourPlayer`, `WarningBanner`, `BreadCrumb`
- **Theme system** — dark / light / high-contrast, persisted to `localStorage`
- **Onboarding overlay** — 4-step first-run guide, `localStorage:sprang:onboarded` flag
- **Mobile layout** — animated slide wrapper, `MobileBottomNav` on screens < 768px
- **Keyboard shortcuts** — `Cmd/Ctrl+K` search, `g/h/d/l` view switch, `r` risk overlay, `?` help modal
- **Knowledge graph mode** — `KnowledgeInfo` sidebar, `ReadingPanel` overlay, reading-order Learn tab

#### Developer experience

- **Agentic install prompt** — paste into Cascade; clones, builds, wires MCP config, copies workflows/skills/rules, runs Phase 1 scan, prompts for single Windsurf reload
- **11 slash commands** — `sprang`, `sprang-analyze`, `sprang-knowledge`, `sprang-chat`, `sprang-explain`, `sprang-onboard`, `sprang-diff`, `sprang-domain`, `sprang-why`, `sprang-health`, `sprang-team`; work in both Windsurf/Cascade and Devin Desktop
- **`.devin/rules/`** — `sprang-context.md` (always-on) + `sprang-highrisk.md` (glob-triggered): Cascade automatically checks risk before every edit and blast radius after
- **Symlinks** — `.devin/workflows` → `.windsurf/workflows`, `.devin/skills` → `.windsurf/skills`

---

### Tests

| Package | Runner | Tests |
|---|---|---|
| `@sprang/core` | Vitest | 120 |
| `@sprang/dashboard` | Vitest | 33 |
| `@sprang/mcp` | Vitest | 49 |
| **Total unit** | | **202** |
| `@sprang/dashboard` | Playwright (15 workers) | 15 |

---

### Security

- No external API keys or network calls in Phase 1 — fully air-gapped static analysis
- `.env` gitignored; no secrets committed to repository
- Vitest upgraded to `^4.1.8` (fixes GHSA-5xrq-8626-4rwp — arbitrary file read via Vitest UI server; UI is not exposed in production)
- All MCP tool inputs validated before graph access
- `GraphLoader` reads only from the configured `SPRANG_ROOT` path

---

### Known limitations

- Phase 2 enrichment (summaries, architecture layers, guided tour) requires Cascade / an AI agent — it is not automated on install
- Language support in Phase 1 is TypeScript/JavaScript-first; other languages are scanned for file structure and imports but AST parsing is limited
- Knowledge graph mode (`/sprang-knowledge`) requires markdown files with consistent wikilink or frontmatter conventions for best results

[0.1.0]: https://github.com/FavioVazquez/sprang/releases/tag/v0.1.0
