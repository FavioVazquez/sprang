# Changelog

All notable changes to Sprang are documented here.  
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).  
Versions follow [Semantic Versioning](https://semver.org/).

---

## [0.2.1] — 2026-06-08

Security scanning, health grading, run history, architecture diagrams, on-demand dashboard analysis, a point-and-analyze landing screen, CodeFlow-parity static analysis (call graph, design patterns, layer violations), and three new visualization modes (3D graph, treemap, matrix) — all deterministic, no API key required.

### Fixed (installer and agentic install — 2026-06-11)

- **`install.sh` and `install.ps1` next-steps output** — after linking skills for `windsurf` or `copilot`, the scripts now print a complete "Next steps" guide: exact MCP config JSON to write (with the resolved `REPO_DIR` path already filled in), rules/hooks/workflows copy commands, and a link to the full docs. Previously the scripts printed "Run /sprang now" which was misleading — the MCP server and project rules still needed to be set up.
- **Agentic install prompt (Windsurf / Devin Desktop)** — step 5 now writes `.devin/config.json` with the actual absolute `SPRANG_DIR` path instead of copying the Sprang repo's template. The template uses a relative `packages/mcp/dist/server.js` path that only resolves from inside the Sprang repository; copying it verbatim into a user's project would silently fail to connect the MCP server in Devin Desktop.
- **`copilot-instructions.md` setup section** — replaced the ambiguous `pnpm build` instruction (which, if run inside a user's project, would build the user's project rather than the Sprang MCP server) with a clear `cd <path-to-sprang-repo> && pnpm install && pnpm build` with an explanatory note.

### Added (documentation — 2026-06-11)

- **"The Leap" section** — Kierkegaard's *det qualitative Spring* concept explained near the top of the README: why incremental tools (grep, LSP, LLM context windows) can't answer "what breaks before it breaks?", and how Sprang's persistent graph infrastructure fills that gap.
- **"Not just codebases" callout** — knowledge-base use case (Obsidian, Logseq, Dendron, Foam, plain markdown) promoted near the top alongside the codebase use case.
- **"What existing tools don't do" comparison table** — explicit comparison against grep/LSP, LLM context, and Sourcegraph across 9 dimensions (why code exists, blast radius, risk score, persistence, MCP access, offline support, knowledge bases, team annotations).
- **"Workflows in practice" section** — 5 real-world scenarios with full command sequences: Day 1 at a new company, before refactoring a module, PM domain review, reviewing a risky PR, and exploring an Obsidian vault.
- **Supported languages row** in the capabilities table: TypeScript, JavaScript, Python, Go, Rust, Java, Kotlin, Ruby, PHP, C, C++, C# plus Markdown.
- **Attributions section** — proper credits for Understand Anything (Egonex AI / Lum1104) and CodeFlow (braedonsaunders), replacing the closing footnote.
- **7-view count corrected** throughout README, AGENTS.md, CLAUDE.md — all references to "5 views" updated to "7 views" (Graph/Health/Domains/Architecture/Treemap/Matrix/Learn); keyboard shortcuts table updated to include Treemap (`t`/`5`), Matrix (`m`/`6`), and fix Learn to `l`/`7`.

### Added (platform verification — 2026-06-11)

Real end-to-end validation that the Windsurf/Devin Desktop and GitHub Copilot integrations work, not just that their code paths are mocked correctly. **38 new tests** (654 unit / 72 e2e totals).

- **Platform bridge e2e suite** (`packages/dashboard/e2e/bridge.spec.ts`, 8 tests; run with `pnpm --filter @sprang/dashboard test:e2e:bridge`) — a new Playwright config (`playwright.bridge.config.ts`) boots two preview servers whose `PATH` is prefixed with **mock platform CLIs** (`e2e/mock-bin/`): a mock `claude` that answers `--version` and emits the documented JSON result contract, a mock `copilot` that emits the JSONL contract, and a failing `claude` shim that shadows any real CLI so detection falls through to copilot. Nothing is stubbed in-process — the server really spawns the executables, really parses stdout, really persists session files, and really writes `cascade-response.json`. Covered: bridge detection priority (windsurf marker > claude > copilot), the full `POST /agent-ask` → background spawn → `GET /agent-response` pipeline for both CLIs, `--allowedTools` includes all sprang MCP tools (incl. `sprang_respond`), `--resume <id>` (claude) and `--resume=<id>` (copilot) session continuity across asks, the Windsurf `.cascade-trigger-session` protocol (`[SPRANG DASHBOARD MESSAGE` prefix + `sprang_respond` instruction, atomic write), and `DELETE /agent-response` clearing sessions so the next ask starts fresh. Each server gets an isolated `SPRANG_ROOT` (`e2e/.bridge-root-*`, gitignored). Wired into CI as a separate step.
- **Platform parity test suite** (`packages/cli/tests/platform-parity.test.ts`, 22 tests) — locks the cross-platform invariants: all 6 manifests (`.claude-plugin/plugin.json` + `marketplace.json`, `.copilot-plugin/plugin.json`, `.devin/config.json`, `.mcp.json`, `.vscode/mcp.json`) parse, plugin versions match the package version, `.copilot-plugin` skills path resolves to `.windsurf/skills/` with all 11 skills, `.claude-plugin` skills + `${CLAUDE_PLUGIN_ROOT}` MCP server path resolve, all three MCP configs point at the built `packages/mcp/dist/server.js`, `skills/` ↔ `.windsurf/skills/` contain the same 11 skills with valid frontmatter and Windsurf trigger phrases, 11 workflows + 11 Claude commands match the skill set, the 3 rules are byte-identical between `.windsurf/rules/` and `.devin/rules/`, both `hooks.json` files wire `save-conversation.py`, `.claude/settings.json` hooks scripts exist and are executable, `copilot-instructions.md` names all 9 MCP tools, and the `cascade-messaging-0.1.0.vsix` extension artifact exists.
- **Windsurf conversation hook real-execution tests** (`packages/cli/tests/windsurf-hook.test.ts`, 8 tests) — runs `.windsurf/hooks/save-conversation.py` via real `python3` with fixture JSONL transcripts: happy path appends `**User:**`/`**Cascade:**` markdown to `.sprang/agent-conversation.md`, only the last exchange is logged, multiple planner responses join with a blank line, append-across-runs, and silent no-op on missing transcript / malformed stdin / unset `WINDSURF_WORKSPACE_ROOT` / missing response.
- **CI** — new "Run platform bridge e2e tests" step in the e2e job.

### Added (visualizations and animation — 2026-06-08)

- **3D graph view** — new `Graph3DCanvas.tsx` component using `react-force-graph` (Three.js / WebGL). Node size proportional to `risk_score`; color follows the same OKLCH heat scale as the 2D risk overlay. Gentle auto-rotation on load (stops on first user interaction); respects `prefers-reduced-motion`. Selecting a node pans the camera to it. `GraphView` toolbar gains a `2D | 3D` pill toggle; state persisted in `graphViewMode` zustand slice.
- **Treemap view** — new `TreemapView.tsx` page using `d3-hierarchy`. Files nested in their folder structure; tile area = lines of code; tile color = `risk_score` heat. Layer accent bars at the top of each tile. Labels and sub-labels (lines count) rendered when tile is large enough. Staggered entry animation via `motion.g`. Zoom controls. Added as tab 5 (`T` key shortcut).
- **Matrix view** — new `MatrixView.tsx` page, pure SVG. File-to-file dependency adjacency matrix sorted by architectural layer rank (infrastructure → ui). Cell fill intensity = edge weight; hover highlights full row and column. Scroll-to-zoom (0.4–3×). Click a row to select that node. Added as tab 6 (`M` key shortcut).
- **`graphTransform.ts`** — shared data adapter module: `toForceGraphData()` (KnowledgeGraph → react-force-graph nodes/links), `toHierarchyData()` (→ d3 hierarchy tree), `toMatrixData()` (→ sorted file list + edge cells, capped at 150 nodes).
- **`AnimatedCount.tsx`** — spring number counter via `useSpring` + `useTransform`. Respects `useReducedMotion`. Used in `HealthView` stat cards (nodes, edges, orphan count, risk counts).
- **View transitions upgraded** — all 7 tab views now animate with opacity + y-slide (`initial: y: 8 → animate: y: 0 → exit: y: -8`, duration 180ms) rather than bare opacity. `AnimatePresence mode="wait"` already in place.
- **HealthView table row stagger** — smell and risky-nodes table rows animate in with a staggered fade+slide (`delay: index × 40ms`, capped at 400ms). Motion-reduce aware.
- **FileExplorer expand/collapse** — folder children wrapped in `AnimatePresence` + `motion.div` with `height: 0 → auto` transition. Chevron icon rotates 90° via `motion.span`.
- **LayerCardNode stagger** — architecture layer cards enter with `scale: 0.92 → 1, opacity: 0 → 1`, staggered by `colorIndex × 60ms`.
- **ArchitectureView reveal** — React Flow canvas wraps in `motion.div` (scale + opacity) that fires when ELK layout resolves.
- **GraphCanvas selected-node pulse ring** — `AnimatePresence` `motion.div` ring positioned over the Sigma canvas at the selected node's viewport coordinates; pulses `scale: [1, 1.6, 1]` on repeat.

### Planned (deferred visualizations)

- **Circular bundle view** — D3 hierarchical edge bundling; files on a circle, imports as bezier curves.
- **Sankey flow diagram** — `d3-sankey`; import volume flowing between architectural layers.
- **Hotspot heatmap** — scatter plot of `risk_score` vs `change_frequency` (requires git-layer Phase 2 data).
- **Call-graph explorer** — function subgraph modal using `internalCalls`/`externalCalls` data.
- **Timeline view** — per-file commit activity over 90 days (requires git-layer Phase 2 data).

### Added (new features)

- **Dashboard landing screen — instant, agent-free analysis.** When no graph exists, the dashboard now shows a `LandingScreen` (`packages/dashboard/src/components/LandingScreen.tsx`) with a single smart input that auto-detects a local path vs. a GitHub URL (live `Local` / `GitHub` badge as you type). Local paths are validated server-side; GitHub URLs (`github.com/owner/repo`, `owner/repo`, or full URL) are shallow-cloned to a temp folder (`/tmp/sprang-gh-<owner>-<repo>/`) and never stored. `POST /analyze` now accepts a JSON body (`{ path?, githubUrl? }`), updates the server's mutable project root, and chains the Phase 1 scan after the clone. Cycling progress messages, an indeterminate progress bar, example chips, and a subtle "Retry loading existing graph" affordance. This is the CodeFlow-style zero-friction entry point.
- **`sprang open --auto-scan`** — new flag on the `open` command. Appends `?autoScan=1&path=<root>` to the dashboard URL so Phase 1 starts the moment the browser opens — no button click. `sprang open` with no graph now lands on the analyze screen instead of an error.
- **Function-to-function call graph** — `file-analyzer` now extracts call sites from every function body (`extractCallSites()`, comment/string-literal aware, keyword-filtered) and creates `calls` edges: internal (same-file, precisely resolved) and external (exported function in a directly-imported file). Each function node gets `internalCalls`, `externalCalls`, `callerCount`, and `isUnused` in its metadata. The `calls` edge type existed in the schema since the first release but was never produced until now.
- **Three new design-pattern detectors** — `detectPatterns()` now also recognizes `context_provider` (`createContext()` + `.Provider`), `decorator` (capitalized decorator on its own line, e.g. `@Injectable`), and `event_emitter` (extends/instantiates an EventEmitter). `context_provider` added to the `DetectedPattern` type. Brings detected patterns to 9: singleton, factory, observer, strategy, decorator, react_hook, context_provider, event_emitter, dependency_injection.
- **Architecture layer-violation detection** — `architecture-analyzer` now defines a dependency hierarchy (`infrastructure < config < schema < data < domain < api < ui`; `util`/`test` exempt) and flags `imports` edges where a lower layer depends on a higher one (e.g. data → ui). Each violation becomes a `layer_violation` structural warning on the source node (severity `high` when the rank gap ≥ 3), surfacing automatically in `smell_summary`, the health grade, and the dashboard. New `layer_violation` `SmellCategory`; the zod validator was also backfilled with the previously-missing `name_duplicate`.
- **11 new unit tests** — 3 layer-violation cases (flags upward import, ignores downward, exempts util/test) and 8 call-graph/pattern cases (internal + external `calls` edges, caller counts, self-call exclusion, context_provider / event_emitter / decorator detection) via a new `call-graph` fixture. 1 new e2e test (landing screen detects GitHub URL input) plus updated landing-screen tests. Totals: 624 unit, 64 e2e.
- **`SecurityScannerAgent`** — deterministic Phase 2 agent, zero LLM calls, zero API keys. Scans every file node against 20 regex patterns across 8 categories: `hardcoded_secret`, `sql_injection`, `xss_risk`, `unsafe_eval`, `unsafe_exec`, `unsafe_deserialization`, `path_traversal`, `weak_crypto`. Findings stored as `node.security_warnings[]` with category, severity, line number, matched pattern, and code snippet. High-severity findings boost `risk_score` by +0.15. Summary written to `graph.stats.security_summary`.
- **Health letter grade (A–F)** — `calcHealthGrade()` in `@sprang/core` computes a 0–100 score from five deterministic penalty factors: dead code (orphan %), circular dependencies, god nodes, average coupling, and high-severity security findings. Maps to A (≥90) / B (≥80) / C (≥70) / D (≥60) / F (<60). `gradeColor()` returns the hex color for each grade (green → red).
- **`sprang_health` MCP tool** — extended output: `health_grade`, `health_score`, `grade_color`, `grade_breakdown` (per-factor penalties), `security_summary`, and `history` (last 30 run snapshots). The grade and breakdown are computed live from the graph on every call.
- **Run history** — `appendSnapshot()` / `loadHistory()` in `@sprang/core`. Every `sprang scan` run appends a `HistorySnapshot` to `.sprang/history.json` (max 50 entries, atomic write via temp-rename). Snapshots record: timestamp, git hash, phase, health score/grade, node/edge counts, risk summary, smell count, security count.
- **Pattern detection** — `file-analyzer` now runs `detectPatterns()` on each file: identifies `singleton` (private constructor + static instance), `factory` (create*/make* functions), `observer` (addEventListener/subscribe/emit), `react_hook` (exported use* with hooks inside), `strategy` (implements *Strategy), `dependency_injection` (constructor with multiple typed params). Stored as `node.detected_patterns[]`.
- **`name_duplicate` code smell** — `smell-detector` now calls `detectNameDuplicates()`: flags function or class names that appear in 3+ different files using LCS similarity. Adds `name_duplicate` entries to `smell_summary` and `structural_warnings`.
- **LCS similarity utilities** — `lcsLength()`, `lcsSimilarity()`, `structuralFingerprint()` added to `@sprang/core`. O(m×n) time, O(min(m,n)) space with rolling-array optimization. `structuralFingerprint()` strips comments, normalizes string/number literals for structural comparison.
- **Mermaid diagram generation** — `generateMermaid()` in `@sprang/core`. Reads layer assignments from the graph, counts cross-layer edges, outputs a `flowchart TD` Mermaid block. Falls back to top-20 file nodes when no layers exist.
- **`sprang open [path] [--port 7777] [--no-browser]`** — new CLI command. Launches the dashboard (`vite preview`) pointed at any project folder without changing directories. Walks up the directory tree to find `packages/dashboard/dist`, sets `SPRANG_ROOT`, opens the browser after a 1.5s delay. Entry point for using Sprang on other people's repos.
- **`sprang diagram [path] [--output file]`** — new CLI command. Reads `.sprang/knowledge-graph.json` and outputs a fenced Mermaid block to stdout or a file. Zero dependencies beyond the graph file — useful for architecture docs and PR descriptions.
- **Dashboard: `HealthGrade` component** — animated A–F badge with spring entrance animation (framer-motion). Color-coded per grade (green → red). Shows score/100. Tooltip with full penalty breakdown.
- **Dashboard: `Sparkline` component** — pure SVG area sparkline (no library). Gradient fill, stroke line, endpoint dot. Used for health score trend in the Health view.
- **Dashboard: `HealthView` additions** — health grade badge + score sparkline in the heading, security issues section (severity grid + list of flagged nodes with category/line/snippet), detected patterns section (green checkmark badges per pattern type).
- **Dashboard: `NodePanel` additions** — security warnings section (collapsible, severity-colored cards with category, line number, matched snippet), detected patterns section (green `CheckCircle` badges).
- **Dashboard: on-demand analysis** — `POST /analyze` endpoint spawns `sprang scan --phase1-only` as a fire-and-forget background process. `GET /analyze-status` polls `.sprang/intermediate/phase2-progress.json`. `GET /health-history.json` serves `.sprang/history.json` (returns `[]` if missing). `ErrorScreen` gains an "Analyze this project" button wired to `POST /analyze`.
- **27 new unit tests**: 15 for `health-grade` (grade boundaries, all 5 penalty factors with cap enforcement, `gradeColor`, score clamping) and 12 for `similarity` (`lcsLength`, `lcsSimilarity`, `structuralFingerprint`).
- **4 new e2e tests** (tests 37–40): `/health-history.json` returns array, `/analyze-status` returns 204 when no progress file, `POST /analyze` returns `{ok:true, started:true}`, health view shows grade badge.
- **Complete persona system** — `sprang_tour` MCP tool now accepts all 5 personas: `junior` (all steps + language lessons), `senior` / `experienced` (skip intro, architectural focus), `pm` (domain and service nodes, business focus), `non-technical` (entry-points and domains only, no code details). `experienced` is an alias for `senior`. Dashboard `PersonaSelector` expanded to 4 options: Business / Product / Learn / Deep Dive. `LearnPanel` shows persona-specific hint text for all values. `/sprang-onboard` command documents all 4 personas with their MCP values across all 3 platforms. 2 new MCP tests (65 total).
- **7 new e2e tests** (tests 50–56): keyboard shortcuts 1/2/3 (graph/health/domains), persona selector shows all 4 options, tour start button + step advance + exit, health view security findings section. 56 e2e tests total.

### Fixed (e2e test — 2026-06-08, codeflow real-world validation)

- **CommonJS `require()` not detected as imports.** Projects using `const { x } = require('./path')` produced no import edges, so `sprang_diff_impact` showed 0 blast radius, `sprang diagram` showed no arrows, and `sprang query` couldn't trace connectivity. Fixed: added `CJS_REQUIRE_RE` pattern alongside the existing ESM regex in `extractTsJsImports()`. Now `require('./file')` generates the same import edges as `import x from './file'`.
- **`sprang query` CLI ignored positional path argument.** `health`, `status`, `scan`, and `diagram` all accept `[path]` as a positional argument, but `query` required `-p <path>`. Running `sprang query "keyword" /path/to/project` searched the wrong directory (CWD). Fixed: added optional second positional `[path]` argument; `-p` still works as an option alias.
- **`sprang diagram` showed no edges in flat (Phase 1) mode.** `generateFlatMermaid` sliced alphabetically-first 20 file nodes, often omitting the lib/src targets that entry points import. Import edges were always between in-set source and out-of-set target, so the diagram was always node-only with no arrows. Fixed: nodes now sorted by degree (most-connected first) up to 30, ensuring entry point + its dependency targets appear together in the diagram.
- 5 new tests: 2 CommonJS `extractImportsForLanguage` cases (JS/TS), 3 `generateMermaid` cases (flat with edges, degree-priority, layer diagram). Core suite: 436 tests.

### Fixed (analysis pipeline and workflow correctness — 2026-06-08)

- **`merge.py` — risk scores not applied to nodes.** `risk-scores.json` was read but the values were never merged into node objects; all nodes had `risk_score: null` after Phase 2 completed. Fixed: merge.py now applies `risk_score`, `risk_factors`, `decision_context`, and `structural_warnings` from `risk-scores.json` onto matching node objects by ID before writing the final graph.
- **`merge.py` — domains not loaded from `final-domains.json`.** The domains array was always empty (`[]`) in the assembled graph because merge.py only read domain data from `assembled-graph.json`, which agents don't write. Fixed: merge.py now explicitly looks for `final-domains.json` (and `domains.json` as fallback) in the intermediate directory.
- **`merge.py` — `stats.phase2_completed_at` never set.** The field was always `null` because no code wrote it. Fixed: merge.py now reads the last-modified timestamp from `phase6-done.json` or `phase5-done.json` and applies it to `stats.phase2_completed_at`.
- **`sprang-analyze` workflow — Domain Mapping phase missing entirely.** Phase 5 (domain-analyzer → `final-domains.json`) was completely absent from the workflow. Every analysis run produced `domains: []` regardless of codebase content. Fixed: Phase 5 added with the full domain object structure (`id`, `name`, `description`, `flows[]`, `entry_points[]`, `business_rules[]`) written to `final-domains.json`.
- **`sprang-analyze` workflow — risk-scores.json format missing `decision_context`.** Phase 6 spec described only `risk_score` and `risk_factors` but not `decision_context` or `structural_warnings`. Agents wrote incomplete objects. Fixed: Phase 6 now specifies the full format including all four fields.
- **`sprang-analyze` workflow — resume check used non-existent phase value.** Phase 0 checked `phase: enriched` to decide whether to skip to enrichment. `'enriched'` is not a valid Zod enum value (only `'skeleton' | 'complete'`), so the resume path was never taken. Fixed: changed to `phase: complete`.
- **`sprang-analyze` workflow — Phase 3/4 writing wrong filenames.** Phase 3 wrote `layers.json` and Phase 4 wrote `tours.json`, but merge.py reads `final-layers.json` and `final-tours.json`. Layer and tour data was always discarded at assembly. Fixed: both phases now write the correct `final-layers.json` and `final-tours.json` filenames directly.
- **`sprang-analyze` workflow — tour written as a flat step array.** Phase 4 wrote a flat `TourStep[]`, but merge.py and the Zod schema require `Tour[]` objects with `{ id, title, description, steps[] }`. The Learn tab was always empty after analysis. Fixed: Phase 4 now wraps steps in a proper Tour object envelope.
- **Phase count inconsistency across all platform copies.** Workflow, SKILL.md files, and the Claude command all said "7 phases" or "6 phases" but the workflow has Phase 0 through Phase 7 = 8 phases total. Fixed: all copies now consistently say "8 phases (Phase 0 through Phase 7)".
- **`sprang-onboard` persona mismatch.** The command offered `non-technical` and `experienced` as persona choices but `sprang_tour` MCP tool only accepts `junior`, `senior`, and `pm`. Tour calls with unrecognised personas silently defaulted to `junior`. Fixed: the command now explicitly maps `non-technical` → `pm` and `experienced` → `senior` before calling `sprang_tour`.
- **`sprang-knowledge` workflow filename inconsistency.** Phase 3 wrote `knowledge-layers.json` and Phase 4 wrote `knowledge-tour.json`, but Phase 5 loaded `final-layers.json` / `final-tours.json`. The intermediate files never matched — knowledge graph analyses always had no layers or tour. Fixed: all phases now use `final-layers.json` and `final-tours.json`.
- **`sprang-team` staleness detection broken for most nodes.** The staleness check compared `decision_context.last_changed` against `annotated_at`, but only ~5% of nodes have git history in `decision_context`. The check silently produced no results for the other 95%. Fixed: when `last_changed` is absent, falls back to `graph.stats.generated_at` as the "last analyzed" proxy so staleness detection works for all annotated nodes.
- **`.windsurf/rules/` directory missing.** The three always-on rules (`sprang-context.md`, `cascade-messaging.md`, `sprang-highrisk.md`) were only present in `.devin/rules/` but not in `.windsurf/rules/`. Windsurf/Cascade never loaded them automatically. Fixed: `.windsurf/rules/` created with all three rule files.
- **`sprang_respond` missing from Claude bridge `--allowedTools`.** The dashboard Ask Agent panel spawns `claude -p` with an explicit `--allowedTools` list. `mcp__sprang__sprang_respond` was not in that list, so the Claude bridge could not write answers back to `cascade-response.json` — dashboard responses never appeared. Fixed: `mcp__sprang__sprang_respond` added to `ALLOWED_MCP_TOOLS` in `claude.ts`.
- **Vite bundle — main chunk was 2.4 MB.** sigma/graphology (~950 KB), React Flow + ELK (~1.5 MB), framer-motion, and Radix UI were all bundled into the main chunk, causing a large initial load. Fixed: `manualChunks` function in `vite.config.ts` splits vendor code into separate lazy-loaded chunks (`vendor-graph`, `vendor-flow`, `vendor-motion`, `vendor-ui`). `DomainView` and `ArchitectureView` converted to `React.lazy()` with `Suspense` wrappers. Main chunk reduced from 2.4 MB to 142 KB.

### Fixed (correctness and platform polish from 2026-06-06 session)

- **`sprang_query` — multi-word queries returned zero results.** Fixed: query tokenized on whitespace; each token matched independently against `label`, `id`, and `summary`. Scoring rewards full-phrase and label matches.
- **`sprang_query` — node IDs (file paths) not searched.** Fixed: text scorer now checks `node.id.toLowerCase()` against both full phrase and each token.
- **`sprang_node` / `sprang_why` / `sprang_annotate` — bare path lookups returned `NODE_NOT_FOUND`.** Fixed: `resolveNode` tries exact → `file:` prefix → strip prefix → suffix match.
- **`sanitizeNodeId` — `basename()` caused monorepo annotation collisions.** Fixed: full path preserved; only path-unsafe characters replaced.
- **`GraphPhase` — dead `'enriched'` value removed** from schema.
- **`merge-subgraphs.ts` — layers, tours, and domains not merged.** Fixed: `mergeLayers`, `mergeTours`, `mergeDomains` helpers added.
- **`graph-loader.ts` — Zod validation failures were silent.** Fixed: error written to `process.stderr` with the validation issue.
- **`graph-loader.ts` — TOCTOU race in hot-reload.** Fixed: single `stat()` call, result reused.
- **`ArchitectureView.tsx` — React hooks ordering violation.** Fixed: `useMemo` moved before its dependent `useEffect`.
- **`AskCascadePanel.tsx` — Escape key did not close the panel.** Fixed.
- **`claude` bridge — `--mcp-config` not passed explicitly.** Fixed: `--mcp-config <sprangRoot>/.mcp.json` added when file exists.
- **`install.sh` — heredoc injection + regex grep.** Fixed: `printf '%s\n'` quoting + `grep -qF` literal match.
- **`install.ps1` — unquoted paths + `mklink` fallback.** Fixed: proper quoting + `New-Item -ItemType SymbolicLink`.
- **`merge.ts` — path containment not enforced.** Fixed: guard rejects paths outside `projectRoot`.
- **`.devin/config.json` — hardcoded developer machine path.** Fixed: replaced with relative `packages/mcp/dist/server.js`.
- **`.copilot-plugin/plugin.json` — wrong `skills` path.** Fixed: `"../.windsurf/skills/"`.
- **All 11 `.windsurf/skills/*/SKILL.md` — missing trigger phrases in descriptions.** Fixed.
- **`DEFAULT_EXCLUDES` — scanner indexed its own worktrees.** Fixed: `.claude/worktrees/**`, `test-results/**`, `playwright-report/**` added.
- **CI manifest validation — `.devin/config.json` not checked.** Fixed.
- **`sprang_why` — `phase_note` field** added when `decision_context` is absent.
- **`.sprang/annotations/.gitkeep`** — tracks empty annotations dir in fresh clones.
- **`.gitignore`** — transient runtime files now properly excluded: `cascade-response.json`, `claude-session.json`, `copilot-session.json`, `agent-conversation.md`, `.cascade-bridge-active`, `diff-overlay.json`, `packages/dashboard/.sprang/`.

### Changed

- All package versions bumped from `0.2.0` to `0.2.1`.
- `sprang_health` MCP tool description updated to reflect extended output.
- `sprang-health` command/skill/workflow: now leads with health grade, reports security findings, shows history trend.
- Test counts: **608 unit tests** (431 core + 85 dashboard + 65 mcp + 27 cli), **56 e2e tests** — all passing.

---

## [0.2.0] — 2026-06-05

### Fixed

- **`sprang_query` — multi-word queries returned zero results.** The text-mode search only did a single `includes()` check on the full query string. A query like `"schema types"` never matched because no node label is `"schema types"` verbatim. Fixed: query is now tokenized on whitespace and each token is matched independently against `label`, `id`, and `summary`. Scoring rewards full-phrase matches over token matches, and label matches over ID/path matches.
- **`sprang_query` — node IDs (file paths) not searched.** Querying `"src/auth"` returned nothing even though `file:src/auth.ts` existed. Fixed: the text scorer now also checks `node.id.toLowerCase()` against both the full phrase and each token.
- **`sprang_node` / `sprang_why` / `sprang_annotate` — bare path lookups returned `NODE_NOT_FOUND`.** Graph stores IDs with `file:` prefix; tool inputs often omit it. Fixed: `resolveNode` helper tries exact match → `file:` prefix → strip `file:` prefix → suffix match. All three tools now resolve any reasonable node ID form.
- **`sanitizeNodeId` — `basename()` caused monorepo collisions.** Two files at `packages/a/src/utils.ts` and `packages/b/src/utils.ts` both sanitized to `utils.ts`, making one annotation overwrite the other. Fixed: `basename()` removed; full path preserved with only path-unsafe characters replaced.
- **`GraphPhase` — dead `'enriched'` value removed.** `'skeleton' | 'complete'` is the correct schema; `'enriched'` was never written or read by any agent code. Removes Zod validation false positives.
- **`merge-subgraphs.ts` — layers, tours, and domains not merged.** Parallel agent worktrees produced subgraphs with their own layer/tour/domain data; the merge step only joined `nodes` and `edges`. Fixed: `mergeLayers`, `mergeTours`, `mergeDomains` helpers added.
- **`graph-loader.ts` — Zod validation failures were silent.** An invalid `knowledge-graph.json` caused `getGraph()` to return `null` with no log output, making MCP tools fail with `GRAPH_NOT_FOUND` rather than a helpful error. Fixed: error is now written to `process.stderr` with the validation issue.
- **`graph-loader.ts` — TOCTOU race in hot-reload.** Two `stat()` calls (mtime check + size check) could race with a concurrent file write. Fixed: single `stat()` call, result reused.
- **`ArchitectureView.tsx` — `aggregateLayerEdges` `useMemo` declared after the `useEffect` that consumes it.** Caused a React hooks ordering violation (benign at runtime, but wrong). Fixed: `useMemo` moved before its dependent `useEffect`.
- **`AskCascadePanel.tsx` — Escape key did not close the panel.** Fixed: `keydown` listener added in the panel open `useEffect`.
- **`claude` bridge — `--mcp-config` not passed explicitly.** When `SPRANG_ROOT` was not the project root, `claude -p` launched without the MCP server, so sprang tools were unavailable in Ask Agent sessions. Fixed: `--mcp-config <sprangRoot>/.mcp.json` added when the file exists.
- **`install.sh` — heredoc injection in wrapper script creation.** `cli_bin` path was interpolated directly into a `cat <<WRAPPER` heredoc, allowing a maliciously named path to inject arbitrary shell commands. Fixed: replaced with `printf '%s\n'` with proper quoting.
- **`install.sh` — `grep` pattern was a regex, not a literal string.** Path characters like `.` were treated as regex wildcards in the PATH check. Fixed: `grep -qF` (literal match).
- **`install.ps1` — unquoted path variables in git commands.** Paths with spaces caused `git -C $RepoDir` and `git clone $RepoUrl $RepoDir` to fail on Windows. Fixed: proper quoting added.
- **`install.ps1` — `cmd /c mklink /D` fallback.** `mklink` is a `cmd.exe` builtin, not available in PowerShell's execution model on all configurations. Fixed: replaced with `New-Item -ItemType SymbolicLink`.
- **`merge.ts` — path containment not enforced.** `--intermediate` flag allowed any absolute path. Fixed: guard added after `resolve()` that rejects paths outside `projectRoot`.
- **`.devin/config.json` — hardcoded developer machine path.** `args` contained `/home/ec2-user/favio/sprang/packages/mcp/dist/server.js`. Fixed: replaced with relative `packages/mcp/dist/server.js`.
- **`.copilot-plugin/plugin.json` — wrong `skills` path.** `"./.windsurf/skills/"` resolved from inside `.copilot-plugin/` to `.copilot-plugin/.windsurf/skills/` which does not exist. Fixed: `"../.windsurf/skills/"`.
- **All 11 `.windsurf/skills/*/SKILL.md` — description fields missing trigger phrases.** Windsurf uses the `description:` field to route slash commands to skills. Skills were missing phrases like "index this project", "onboard me", "show me the domain structure". Fixed: all 11 synced from `skills/*/SKILL.md`.
- **`DEFAULT_EXCLUDES` — scanner indexed its own worktrees.** `.claude/worktrees/**`, `test-results/**`, `playwright-report/**` were missing, causing Playwright artifacts and Claude Code worktrees to appear as nodes in the knowledge graph. Fixed: all three patterns added.
- **CI manifest validation — `.devin/config.json` not checked.** The `ci.yml` "Validate plugin manifests" step parsed 5 files but omitted `.devin/config.json`. Fixed: added to the list.

### Added

- **`sprang_why` — `phase_note` field.** When `decision_context` is absent (Phase 2 not yet run), the tool now returns `phase_note: "decision_context and summary require Phase 2 enrichment — run /sprang-analyze to populate"` so callers get a clear explanation rather than a silent `null`.
- **`sprang_respond` — 8 new unit tests** covering: response+question write, null question, whitespace trimming, empty response error, whitespace-only error, directory creation, overwrite behavior, and ISO-8601 timestamp validation.
- **3 new `sprang_query` tests** covering: multi-word token matching, node ID (path) search, and label-over-ID ranking.
- **9 new e2e tests** covering: path traversal rejection, absolute path rejection, allowlist enforcement, `DELETE /cascade-response`, risk overlay toggle, Learn empty state, bridge status shape, high-risk node in health view, and Sigma canvas presence.
- **`.sprang/annotations/.gitkeep`** — tracks the empty annotations directory so the path is always present in fresh clones.

### Changed

- `ci.yml` — `pnpm test` → `pnpm test -- --coverage` to enforce Vitest coverage thresholds on every CI run.
- Test counts: **572 unit tests** (383 core + 85 dashboard + 60 mcp + 27 cli → 63 mcp after new query tests + 11 new e2e = **45 e2e tests**).

---

## [0.2.0] — 2026-06-05

Full **v0.2.0** release — platform-aware Ask Agent bridge (Windsurf, Claude Code, Copilot CLI), architecture card view, structural fingerprinting, semantic search, Claude Code native hooks, cross-platform installer, security hardening, and persistent cross-session conversation history.

### Added

- **`packages/dashboard/src/bridge/detect.ts`** — runtime bridge detection (four-way priority): Windsurf (`WINDSURF_CASCADE_TERMINAL_KIND` env var OR `.sprang/.cascade-bridge-active` marker OR `.cascade-trigger-session` exists) → Claude Code (`claude` CLI) → Copilot CLI (`copilot` CLI) → none.
- **`packages/dashboard/src/bridge/claude.ts`** — non-interactive Claude Code bridge. Spawns `claude -p "<question>" --output-format json --allowedTools <mcp_tools>`. Persists `session_id` to `.sprang/claude-session.json` and resumes via `--resume <session_id>`. Falls back to plain-text when JSON parsing fails.
- **`packages/dashboard/src/bridge/copilot.ts`** — non-interactive Copilot CLI bridge. Spawns `copilot --prompt "<question>" --output-format json`. Parses JSONL output for `session_id`. Resumes via `--resume=<session_id>` for conversation continuity. Persists ID to `.sprang/copilot-session.json`.
- **`packages/dashboard/src/bridge/windsurf.ts`** — Windsurf bridge helpers: writes trigger file atomically with `[SPRANG DASHBOARD MESSAGE]` prefix and `sprang_respond` instruction.
- **`packages/dashboard/src/bridge/index.ts`** — unified `askAgent(question, sprangRoot)` entry point. Routes to correct bridge; writes `cascade-response.json` for CLI bridges.
- **`GET /bridge-status`** endpoint — returns current `BridgeStatus` JSON `{ kind, detail }`.
- **`AskAgentPanel`** — renamed from `AskCascadePanel`. Shows active bridge name, platform-aware empty states and errors.
- **`cascade-messaging` VS Code extension** — on `activate()` writes `.sprang/.cascade-bridge-active` presence marker (deleted on `deactivate()`). Enables reliable Windsurf detection even when Vite is started outside the IDE terminal.
- **`cascade-messaging` extension** — conversation history now written to `.sprang/agent-conversation.md` (platform-neutral, under `.sprang/`) instead of `.cascade-conversation.md` at workspace root. Creates `.sprang/` dir if missing.
- **`.claude/rules/cascade-messaging.md`** — always-on rule for Claude Code instructing it to `cat .sprang/agent-conversation.md` before each dashboard message (file is gitignored; `Read` tool blocked).
- **`.claude/settings.json`** — added `Bash(cat .sprang/agent-conversation.md*)` to allowed commands.
- **Unit tests** (`bridge/__tests__/bridge.test.ts`) — 30 tests covering all bridge modules + presence marker detection.
- **e2e tests** (`e2e/app.spec.ts`) — 36 tests including bridge-status, Ask Agent panel, and cascade-ask endpoint.
- **`.gitignore`** — added `.sprang/agent-conversation.md`, `.sprang/cascade-response.json`, `.sprang/claude-session.json`, `.sprang/copilot-session.json`, `.sprang/.cascade-bridge-active`.
- **Claude Code native `SessionStart` hook** (`.claude/hooks/session-start.sh`) — runs when Claude Code opens a session. Stdout is injected into Claude's context window. Warns Claude if the knowledge graph is missing or if `stats.gitCommitHash` differs from `git rev-parse HEAD`, showing both truncated hashes. Silent when graph is fresh, when `gitCommitHash` is absent (pre-v0.2 graph), or outside a git repo.
- **Claude Code native `PostToolUse` hook** (`.claude/hooks/post-tool-use.sh`) — fires after every Bash tool call. Detects `git commit`, `git merge`, `git cherry-pick`, and `git rebase` in `$TOOL_INPUT` and triggers an incremental Phase 1 graph refresh in the background (`nohup node packages/cli/dist/index.js scan --phase1-only --if-stale &`). Three guards: command is a git mutation, graph file exists, CLI is built. Never blocks Claude Code; logs to `${TMPDIR:-/tmp}/sprang-autoupdate.log`.
- **Plugin-level hooks file** (`hooks/hooks.json`) — equivalent inline hooks for marketplace plugin installations (uses `npx sprang` instead of `node packages/cli/...`).
- **Hook unit tests** (`packages/cli/tests/hooks-scripts.test.ts`) — 12 tests covering both scripts via `spawnSync('bash', [scriptPath], ...)` against temp git repos. Tests: no-graph warning, fresh-graph silence, stale hash message with truncated display, missing-gitCommitHash silence, non-git-repo silence, non-git-command silence, no-graph silence, no-CLI silence, empty-input silence, merge/cherry-pick detection, and non-triggering commands (`git status`, `git log`, `git diff`, `git push`).
- **Hooks documentation in `CLAUDE.md`** — new "Claude Code Native Hooks" section explaining both hooks, their behavior, how to disable them, and how to run the tests.
- **Cross-platform installer** (`install.sh` + `install.ps1`) — clones the repo, builds all packages, and symlinks skills into the platform's skills directory. Supports `windsurf` (`~/.windsurf/skills/`), `copilot` (`~/.copilot/skills/`), and `claude` (per-project setup guide). `--update` and `--uninstall` flags included. Curl-pipe install supported (`curl -fsSL .../install.sh | bash -s windsurf`).
- **Plugin manifests** — `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` for Claude Code plugin marketplace discovery; `.copilot-plugin/plugin.json` for GitHub Copilot plugin discovery with `skills`/`agents` path references.
- **Comprehensive `CLAUDE.md`** — standalone Claude Code integration reference with full MCP tool table, slash commands, always-on rules, allowed bash permissions, and troubleshooting guide. Imports `AGENTS.md` for platform-agnostic content.

### Changed

- **`POST /cascade-ask`** returns `503` when no bridge detected. Response includes `mode: 'async' | 'sync'`.
- **`.devin/rules/cascade-messaging.md`** — updated to reference `.sprang/agent-conversation.md`, instructs use of `cat` shell command (not `read_file`) since the file is gitignored.
- **`AGENTS.md`** — Dashboard Chat section rewritten: "Ask Agent", all 3 bridges documented, correct file path and `cat` instruction.
- **`CLAUDE.md`** — added `cascade-messaging.md` rule to Always-On Rules section; updated bridge description; added `Bash(cat ...)` allowed command.
- **`packages/mcp/src/server.ts`** — `sprang_respond` description: "Ask Cascade" → "Ask Agent".
- **`README.md`** — documents bridge detection signals and server launch note.
- **Assets** (`assets/`): `architecture`, `pipeline`, `risk-formula`, `graph-modes`, `mcp-tools` regenerated with dark cinematic aesthetic (matching banner/logo/dashboard). All "Cascade/Devin" references replaced with "AI Agent". `mcp-tools` now shows 9 tools including `sprang_respond`.
- **`/sprang-analyze` workflow + all platform copies** — tightened batch limits to prevent failures on normal-size repos: Phase 2 reduced from max 20 files/2000 lines per batch to **max 10 files/800 lines**, concurrency capped at 3. Phase 2 intermediate writes reduced from 100 to **50 nodes per chunk file**. Phase 6 final write now **always** uses chunk files + Python merge script (previously only triggered at >200 nodes). Inline JSON output for >20 nodes is now explicitly forbidden. Applied consistently across `.windsurf/workflows/sprang-analyze.md`, `.windsurf/skills/sprang-analyze/SKILL.md`, `skills/sprang-analyze/SKILL.md`, `.claude/commands/sprang-analyze.md`.
- **`/sprang-analyze` workflow** — added phase checkpoints and resume support: Phase 0 now runs a resume check; if graph is at `phase: enriched`, skips Phases 0–2 and jumps to Phase 3 directly. Phase marker files (`phase1-done.json` … `phase5-done.json`) written after each phase. Explicit "DO NOT STOP HERE" guards added after Phases 2–5 to prevent agents from stopping mid-run. CRITICAL/RESUME banners added to all platform copies (windsurf skill, copilot skill, claude command).
- **`README.md`** — Dashboard section rewritten: clarifies `preview` (port 7777, daily use) vs `dev` (port 7338, dashboard development only); adds explicit warning to open in system browser (Chrome/Firefox) at `http://127.0.0.1:7777` — Windsurf/Devin embedded browser proxy does not forward `/knowledge-graph.json` and other middleware routes; adds run-from-sprang-dir note.
- Test suite: **547 total tests** — 85 dashboard + 383 core + 52 mcp + 27 cli — all passing. 36 e2e all passing.
- **`sprang merge` CLI command** — new `packages/cli/src/commands/merge.ts`. Reads intermediate chunk files written by the agent and assembles a guaranteed-valid `knowledge-graph.json`. Handles all common agent mistakes automatically: dicts-as-arrays for nodes/edges/layers/tours, `tour` vs `tours` key, missing envelope fields (`version`, `kind`, `project_name`, `project_root`, `phase`, `stats`). Phase 6 of `/sprang-analyze` workflow updated to run `sprang merge` instead of a Python script. 9 new CLI tests cover all normalisation cases.
- `.claude/settings.json` — added `"hooks"` section wiring both scripts to their respective events.
- **`CI` workflow** — added "Validate plugin manifests" step that JSON-parses all five config files (`.claude-plugin/`, `.copilot-plugin/`, `.mcp.json`, `.vscode/mcp.json`) in CI. Added Playwright browser cache (`actions/cache@v4`) to speed up e2e job.
- All package versions bumped from `0.1.0` to `0.2.0` to match CHANGELOG and README badges.

### Fixed

- **Bridge detection** — replaced stale mtime heuristic with `WINDSURF_CASCADE_TERMINAL_KIND` env var + `.sprang/.cascade-bridge-active` presence marker. Fixes bridge falling through to Claude Code when both are installed and Vite was started outside the IDE terminal.
- **Claude Code bridge** — removed non-existent `--no-interactive` flag from CLI invocation.
- **Copilot CLI bridge** — fixed incorrect `--continue` flag (doesn't exist). Now uses `--output-format json` + `--resume=<session_id>` for correct session continuity.
- **Conversation history** — `cascade-messaging` extension was hardcoding `.cascade-conversation.md` at workspace root. Fixed to `.sprang/agent-conversation.md`, consistent with all other runtime files.
- **Agent rules** — both `.devin` and `.claude` rules now use `cat` shell command to read gitignored conversation history (blocked by `read_file`/`Read` tool).
- **`vite.config.ts` — double `res.end()` bug**: the `/cascade-ask` `data` handler could call `res.end()` multiple times when a request body spans more than two chunks past the 64 KB cap. Fixed with `if (aborted) return` guard at top of handler.
- **`vite.config.ts` — file allowlist I/O exhaustion**: `buildFileAllowList()` previously called `JSON.parse` + `readFileSync` on the full graph file on every `/file-content.json` request. Now cached in module scope with mtime invalidation.
- **`vite.config.ts` — CORS wildcard on internal endpoints**: `/cascade-ask` and `/cascade-response` set `Access-Control-Allow-Origin: *`, enabling any website to POST arbitrary prompts to Claude Code while the dashboard is running. Removed — these are same-origin endpoints.
- **`vite.config.ts` — preview server host**: reverted to `host: true` (all interfaces) to support remote EC2 / SSH-forwarded setups. Use firewall/security group rules to restrict access as needed.
- **`sprang_why.ts` — weak node ID sanitization**: `sanitizeNodeId` only replaced `:` and `/`; did not strip `..` or path-unsafe characters. Aligned with `sprang_annotate.ts`'s hardened version (strips all path-unsafe chars + applies `basename`).
- **`graph-loader.ts` — unvalidated graph cast**: MCP server cast `JSON.parse` output directly to `KnowledgeGraph` without Zod schema validation. Now uses `knowledgeGraphSchema.safeParse()` — a malformed graph returns `null` instead of crashing tools.
- **`GraphPhase` missing `'enriched'` value** — `core/schema/types.ts`, `core/schema/validators.ts`, and `dashboard/src/types.ts` only declared `'skeleton' | 'complete'`. Graphs written by the agent mid-run with `phase: 'enriched'` failed Zod validation and appeared blank in the dashboard. Added `'enriched'` to all three type definitions. Dashboard now shows an amber "enriched" badge + banner prompting the user to run `/sprang-analyze` to resume phases 3–6.
- **`index.html` — CSP blocking `/knowledge-graph.json` fetch**: `connect-src 'self' ws:` in the Content-Security-Policy meta tag blocked `fetch('/knowledge-graph.json')` when accessed through Windsurf's port-forwarding proxy (different origin than `'self'`). Removed the CSP meta tag entirely — access control is handled at the network/firewall level.
- **`vite.config.ts` — dev server bound to loopback only**: `server` block was missing `host: true`, causing Vite dev mode to bind to `127.0.0.1` only. Windsurf port forwarder cannot tunnel loopback-only ports. Added `host: true` to both `server` and `preview` blocks.
- **`store.ts` — crash on malformed layers**: `buildGraphIndexes` iterated `layer.node_ids` without checking if it was an array. Agents sometimes write layers as strings or objects without `node_ids`, causing `TypeError: layer.node_ids is not iterable` which triggered the error screen. Added `Array.isArray(layer.node_ids)` guard.
- **`merge` command — layers normalisation**: `sprang merge` now converts layers written as an array of strings (`["api_gateway", "worker"]`) to proper layer objects (`{id, name, node_ids: []}`), and ensures every layer object has a `node_ids` array.
- **Test fixtures in `mcp-tools.test.ts`**: `CommitRef` field `hash` corrected to `sha` (matching `types.ts`); added missing `changelog_entries: []`; fixed `risk_factors` from object array to string enum array — all mismatches surfaced by the new Zod validation.
- **`merge.py` — node colors (graph grey)**: `merge.py` was backfilling `layer_id` onto nodes but `GraphCanvas.tsx` reads `node.layer`. Fixed field name — all 90 nodes now get the correct `layer` field and render with layer colors.
- **`merge.py` — Learn tab empty (flat tour steps)**: agents write `tours` as a flat `TourStep[]`; dashboard expects `Tour[{ id, title, steps: [] }]`. `merge.py` now auto-wraps flat step arrays into a proper Tour envelope.
- **`merge.py` — cross-platform, no install required**: replaced CLI-based merge step in workflow with a self-contained Python 3 stdlib script (`skills/sprang-analyze/scripts/merge.py`). Works on macOS, Linux, Windows WSL — no `sprang` binary on PATH needed. Handles all common agent output mistakes automatically.
- **`constants.ts` — Sprang infra excluded from scan**: added `.windsurf/skills/**`, `skills/*/scripts/**`, `.claude/commands/**`, `.claude/hooks/**`, `.claude/rules/**` to `DEFAULT_EXCLUDES` so installed Sprang files never appear in the target project's knowledge graph.
- **Agentic install (Devin Desktop)** — README step 5 was missing three files required for persistent dashboard chat: `.devin/rules/cascade-messaging.md` (always-on conversation history rule), `.devin/hooks.json` + `.windsurf/hooks.json` (post-response hook registration), `.windsurf/hooks/save-conversation.py` (writes `agent-conversation.md`). All added to install prompt.

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
