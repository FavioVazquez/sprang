# Changelog

All notable changes to Sprang are documented here.  
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).  
Versions follow [Semantic Versioning](https://semver.org/).

---

## [0.2.1] — 2026-06-04

Security hardening, cross-platform installer, and plugin marketplace manifests.

### Added

- **Cross-platform installer** (`install.sh` + `install.ps1`) — clones the repo, builds all packages, and symlinks skills into the platform's skills directory. Supports `windsurf` (`~/.windsurf/skills/`), `copilot` (`~/.copilot/skills/`), and `claude` (per-project setup guide). `--update` and `--uninstall` flags included. Curl-pipe install supported (`curl -fsSL .../install.sh | bash -s windsurf`).
- **Plugin manifests** — `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` for Claude Code plugin marketplace discovery; `.copilot-plugin/plugin.json` for GitHub Copilot plugin discovery with `skills`/`agents` path references.
- **Comprehensive `CLAUDE.md`** — standalone Claude Code integration reference with full MCP tool table, slash commands, always-on rules, allowed bash permissions, and troubleshooting guide. Imports `AGENTS.md` for platform-agnostic content.

### Fixed

- **`vite.config.ts` — double `res.end()` bug**: the `/cascade-ask` `data` handler could call `res.end()` multiple times when a request body spans more than two chunks past the 64 KB cap. Fixed with `if (aborted) return` guard at top of handler.
- **`vite.config.ts` — file allowlist I/O exhaustion**: `buildFileAllowList()` previously called `JSON.parse` + `readFileSync` on the full graph file on every `/file-content.json` request. Now cached in module scope with mtime invalidation.
- **`vite.config.ts` — CORS wildcard on internal endpoints**: `/cascade-ask` and `/cascade-response` set `Access-Control-Allow-Origin: *`, enabling any website to POST arbitrary prompts to Claude Code while the dashboard is running. Removed — these are same-origin endpoints.
- **`vite.config.ts` — preview server exposed on all interfaces**: `host: true` bound the preview server to `0.0.0.0`. Changed to `host: '127.0.0.1'`.
- **`sprang_why.ts` — weak node ID sanitization**: `sanitizeNodeId` only replaced `:` and `/`; did not strip `..` or path-unsafe characters. Aligned with `sprang_annotate.ts`'s hardened version (strips all path-unsafe chars + applies `basename`).
- **`graph-loader.ts` — unvalidated graph cast**: MCP server cast `JSON.parse` output directly to `KnowledgeGraph` without Zod schema validation. Now uses `knowledgeGraphSchema.safeParse()` — a malformed graph returns `null` instead of crashing tools.
- **Test fixtures in `mcp-tools.test.ts`**: `CommitRef` field `hash` corrected to `sha` (matching `types.ts`); added missing `changelog_entries: []`; fixed `risk_factors` from object array to string enum array — all mismatches surfaced by the new Zod validation.

### Changed

- **`CI` workflow** — added "Validate plugin manifests" step that JSON-parses all five config files (`.claude-plugin/`, `.copilot-plugin/`, `.mcp.json`, `.vscode/mcp.json`) in CI. Added Playwright browser cache (`actions/cache@v4`) to speed up e2e job.
- All package versions bumped from `0.1.0` to `0.2.0` to match CHANGELOG and README badges.

---

## [0.2.0] — 2026-06-04

Six new capabilities: architecture card view, structural fingerprinting, language pattern detection, graph normalization, semantic search, and auto-update hooks. Full Claude Code and GitHub Copilot integration added.

### Added

- **Architecture card view** (`packages/dashboard`) — 4th dashboard tab (`'a'` / `'4'`) with a React Flow + ELK force-directed layer map. `LayerCardNode.tsx` cards (280px wide, dark surface, colored left accent bar, complexity badge) show one card per architectural layer. `elk-layout.ts` runs ELK `"layered"` layout asynchronously with a loading spinner and fallback grid on error. `edge-aggregation.ts` collapses all cross-layer file-level edges to a single weighted edge with stroke width `min(1 + log2(count+1), 5)`. Clicking a layer card dispatches `setFilters({ layerIds })` to filter the main Graph view.

- **Structural fingerprinting** (`packages/core/src/utils/fingerprint.ts`) — SHA-256 content hash + per-language structural signature extraction (functions, classes, imports, exports for TS/JS/Python/Go). `classifyChange` returns `SKIP` (identical hash), `COSMETIC` (hash differs but signatures equal), or `STRUCTURAL` (signatures changed). Fingerprints persisted at `.sprang/cache/fingerprints.json`. Project scanner logs skip/cosmetic/structural counts per run and attaches `changeType` to each `FileRecord`.

- **Language lesson detection** (`packages/core/src/agents/language-lessons.ts`) — pure deterministic detection of 12 programming patterns: closures, async_await, promises, generators, decorators, generics, streams, observers, dependency_injection, middleware, finite_state_machine, immutability. One lesson per file (highest-priority match). Attached to `SprangNode.languageLesson` and `TourStep.languageLesson`. Surfaced in the `sprang_tour` MCP tool response.

- **Graph normalization** (`packages/core/src/graph/normalize.ts`) — six-step pipeline: double-prefix stripping, last-write-wins node dedup, first-occurrence edge dedup, dangling edge removal, `tested_by` canonicalization (auto-flips edges where the target is a test file), and stats recalculation. Runs automatically after Phase 1 in the orchestrator.

- **Monorepo subgraph merging** (`packages/core/src/graph/merge-subgraphs.ts`) — reads `pnpm-workspace.yaml` or `package.json#workspaces`, discovers packages, merges their `.sprang/knowledge-graph.json` files into the root graph with namespaced node IDs (`packagePath:originalId`).

- **Semantic embedding search** (`packages/core/src/utils/embedding-search.ts`) — cosine similarity over TF-IDF vectors. `sprang_query` now accepts `mode: "semantic"` to search by semantic meaning rather than keyword match. Results include a `score` field (0–1 cosine similarity). CLI `query` command gains `--semantic` flag. Embeddings stored at `.sprang/cache/embeddings.json`.

- **Auto-update git hooks** (`packages/cli/src/commands/install-hooks.ts`) — `sprang install-hooks` writes a `post-commit` hook that runs `sprang scan --phase1-only --if-stale` after every commit. The `--if-stale` flag on `sprang scan` compares `stats.gitCommitHash` against `git rev-parse HEAD` and skips the scan when the graph is already current. Git commit hash recorded in `graph.stats.gitCommitHash` after Phase 1.

- **Git worktree detection** (`packages/core/src/orchestrator/runner.ts`) — `resolveSprangDir()` uses `git rev-parse --git-common-dir` to detect linked worktrees and redirect `.sprang/` to the main repo root, so all worktrees share one graph.

- **`.sprang-hooks/session-start.md`** — session-start guide for AI agents: run `sprang scan --phase1-only --if-stale` at session start to auto-refresh stale graphs.

- **Claude Code integration** — `CLAUDE.md` (imports `@AGENTS.md`), `.mcp.json` (MCP server config), `.claude/rules/` (3 always-on/glob rules), `.claude/commands/` (11 slash commands mirroring all Devin workflows), `.claude/settings.json` (pre-approved Bash permissions).

- **GitHub Copilot integration** — `.vscode/mcp.json` (MCP server in `"servers"` format for Copilot), `.github/copilot-instructions.md` (pre-edit checklist, MCP tools reference, setup guide).

### Changed

- `.gitignore` — `.claude/` no longer wholly excluded; now excludes only `.claude/worktrees/` and `.claude/settings.local.json` so project rules/commands are committed.

---

## [0.1.3] — 2026-06-04

Persistent dashboard chat — send messages from the Sprang dashboard to Cascade and maintain conversation context across sessions.

### Added

- **`cascade-messaging` VS Code extension** (`cascade-messaging-0.1.0.vsix`) — watches `.cascade-trigger-session` and forwards messages to Cascade via `devin.sendChatActionMessage`. After each send, polls `~/.windsurf/transcripts/` for the response transcript and appends the full exchange to `.cascade-conversation.md` in the workspace root, so every new Cascade session restores prior context automatically.

- **`.devin/rules/cascade-messaging.md`** — `always_on` rule loaded by every Cascade session that tells Cascade to read `.cascade-conversation.md` before answering and to call `sprang_respond` after every dashboard reply so responses appear in the dashboard UI.

- **`.windsurf/hooks/save-conversation.py`** — `post_cascade_response_with_transcript` hook that reads the JSONL transcript Cascade writes after each session and appends the exchange to `.cascade-conversation.md`. Acts as a fallback alongside the extension's transcript polling.

- **`.windsurf/hooks.json` / `.devin/hooks.json`** — hook registration for both Windsurf and Devin CLI.

- **Dashboard trigger isolation** — dashboard now writes to `.cascade-trigger-session` (instead of `.cascade-trigger`) so `cascade-messaging` and `cascade-bridge` extensions can coexist without collision.

### Changed

- `.gitignore` — runtime cascade files (`.cascade-trigger-session`, `.cascade-trigger`, `.cascade-session`, `.cascade-conversation.md`) and `packages/cascade-messaging/` source are now excluded. Only the compiled `.vsix` is committed.

### Fixed

- **Removed `sprang-refresh` CI workflow** — `knowledge-graph.json` and `SPRANG_REPORT.md` are gitignored (graph output is local to each project), so the nightly refresh job would always produce an empty commit. Workflow deleted.

---

## [0.1.2] — 2026-06-03

Install UX fixes and dashboard `preview` support.

### Fixed

- **Sprang artifacts scanned in target projects** — `.windsurf/workflows/`, `.windsurf/skills/`, `.devin/rules/`, `.devin/workflows/`, `.devin/skills/` are now in `DEFAULT_EXCLUDES` so they never appear as nodes in the knowledge graph of the project being analyzed.
- **Clone step skipped on re-install** — the install prompt said "skip if already exists" but never pulled latest. Now uses `git -C ~/tools/sprang pull --ff-only` when the directory exists so reinstalls always get the newest version.
- **CLI global link** — `pnpm --filter @sprang/cli link --global` fails from the repo root (the `--filter` flag is not valid for `pnpm link`). Install prompt and manual docs now `cd packages/cli` then run `pnpm setup && pnpm link --global` with the required `PNPM_HOME` export. Added a `node dist/index.js` fallback for the scan step in case PATH isn't updated yet.
- **Dashboard blank on `vite preview`** — `sprangGraphPlugin` only registered middlewares in `configureServer` (dev mode). `vite preview` runs a separate `PreviewServer` and never called `configureServer`, so all three API routes (`/knowledge-graph.json`, `/diff-overlay.json`, `/file-content.json`) returned 404 and the graph never loaded. Fixed by extracting a shared `attachSprangMiddlewares()` helper wired into both `configureServer` and `configurePreviewServer`.
- **Dashboard missing from install prompt** — the agentic install prompt had no step to start the dashboard. Added step 7: `SPRANG_ROOT="$PROJECT_DIR" pnpm --filter @sprang/dashboard preview` → `http://localhost:7777`.
- **`preview.port`** defaulted to 4173; now set to `7777` in `vite.config.ts` to match all docs.
- **Playwright browser cache** — `test:e2e` script now runs `playwright install chromium` before `playwright test` so it is self-healing on clean machines and CI runners.
- **CI e2e job added** — new `e2e` job in `ci.yml` builds the dashboard, installs the Chromium binary, and runs all 15 Playwright tests on every push/PR.
- **E2e strict-mode collision** — `MobileBottomNav` renders duplicate `Graph`/`Health`/`Domains` buttons outside `<nav>`, causing Playwright's strict-mode `resolved to 2 elements` error on CI. All tab-click locators now use a `navTab()` helper scoped to `getByRole('navigation')`.

---

## [0.1.1] — 2026-06-03

Multi-language support — Phase 1 pipeline now covers Python, Go, Rust, Java, Ruby, PHP, C/C++, C#, and Kotlin.

### Added

- **Import edge extraction** for all 9 new languages in `@sprang/core` `project-scanner`:
  - Python (`import`, `from … import`, relative dot imports)
  - Go (single and block `import (…)` declarations)
  - Rust (`use crate::`, `use super::`, `mod name;`)
  - Java / Kotlin (`import com.example.Class`)
  - Ruby (`require_relative`, `require`)
  - PHP (`require`, `include`, `use`)
  - C / C++ (`#include "local.h"` — quoted only, system headers skipped)
  - C# (`using Namespace.Class`)
- **Language-aware import path resolver** `resolveLanguageImport()` — maps raw import strings to relative file paths in the project for BFS blast-radius
- **Symbol extraction** (function/class nodes) for all 9 new languages via new `language-parsers/` module:
  - Python: `def`, `async def`, `class` (with export = top-level + not underscore-prefixed)
  - Go: `func`, `type X struct`, `type X interface`
  - Rust: `fn`, `pub fn`, `async fn`, `struct`, `enum`, `trait`
  - Java: `class`, `interface`, `enum`, `record`; method signatures
  - Kotlin: `fun`, `suspend fun`, `class`, `data class`, `object`, `interface`
  - Ruby: `def`, `def self.`, `class`, `module`
  - PHP: `function`, `class`, `interface`, `trait`, `abstract class`
  - C / C++: function definitions, `struct`, `class`, `union`
  - C#: `class`, `interface`, `struct`, `record`; method signatures; `async` detection
- **`ENTRY_POINT_PATTERNS`** expanded to cover Python (`main.py`, `app.py`, `__main__.py`, `manage.py`), Go (`main.go`), Rust (`src/main.rs`, `src/lib.rs`), Java/Kotlin, Ruby, PHP, C/C++, C#
- **9 language test fixtures**: `simple-python`, `simple-go`, `simple-rust`, `simple-java`, `simple-ruby`, `simple-php`, `simple-c`, `simple-csharp`, `simple-kotlin`
- **108 new tests** (228 total in `@sprang/core`):
  - `tests/agents/multi-lang-imports.test.ts` — 50 tests (per-language extraction + resolver)
  - `tests/agents/multi-lang-symbols.test.ts` — 34 tests (per-language symbol parsing)
  - `tests/integration/pipeline-python.test.ts` — 8 tests (full Phase 1 pipeline)
  - `tests/integration/pipeline-multilang.test.ts` — 16 tests (Go, Rust, Java, Ruby, C, Kotlin)

### Changed

- `FileAnalyzerAgent` now processes all 10 source languages (was TS/JS only); TS/JS use existing regex-based extractors, all others use new `language-parsers/` dispatch
- `ProjectScannerAgent` sets `fileCategory=source` for all languages in `SOURCE_LANGUAGES` (was TS/JS only)
- `file-analyzer.ts` import edge resolution replaced with language-aware `resolveLanguageImport()` (backwards compatible)

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
