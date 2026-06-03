<!-- Hero banner — generated with Gemini gemini-3.1-flash-image-preview -->
<p align="center">
  <img src="assets/banner.png" alt="Sprang — The qualitative leap in codebase comprehension" width="100%" />
</p>

<!-- Logo + tagline -->
<p align="center">
  <img src="assets/logo.png" alt="Sprang logo" height="80" />
</p>

<p align="center">
  <strong>The qualitative leap in codebase comprehension.</strong><br/>
  <em>Det qualitative Spring — Kierkegaard</em>
</p>

<p align="center">
  <a href="#manual-installation"><img src="https://img.shields.io/badge/pnpm-install-orange?style=flat-square&logo=pnpm" alt="pnpm install"/></a>
  <a href="#mcp-tools"><img src="https://img.shields.io/badge/MCP-8_tools-7C3AED?style=flat-square" alt="8 MCP tools"/></a>
  <a href="#slash-commands"><img src="https://img.shields.io/badge/slash_commands-11-3B82F6?style=flat-square" alt="11 slash commands"/></a>
  <img src="https://img.shields.io/badge/unit_tests-202_passing-10B981?style=flat-square" alt="202 unit tests passing"/>
  <img src="https://img.shields.io/badge/e2e_tests-15_passing-10B981?style=flat-square" alt="15 e2e tests passing"/>
  <img src="https://img.shields.io/badge/typecheck-zero_errors-10B981?style=flat-square" alt="zero typecheck errors"/>
  <img src="https://img.shields.io/badge/license-MIT-gray?style=flat-square" alt="MIT license"/>
</p>

---

Sprang is a knowledge graph platform for [Windsurf](https://windsurf.com) (Cascade) and [Devin Desktop](https://devin.ai) that creates **total codebase comprehension** — not just symbol search, but *why* code exists, *who* changed it, *what* it risks, and *how* it all fits together.

Cascade is the intelligence layer. Sprang is the data layer. Together they answer **"what will break if I change this file?"** in a single tool call.

> *"The System knows everything about being, but nothing about existence."*  
> Kierkegaard's critique of Hegel applies equally to symbol indexers and grep tools.  
> Sprang bridges the gap: from static facts to living, contextual understanding.

---

## Quick install — just ask Cascade

Paste this prompt into Cascade (or any AI agent with terminal access). It will do everything — clone, build, wire up the MCP server, copy the slash commands and rules, and run the first scan. When it finishes, you reload Windsurf once and you're live.

```
Please install the Sprang knowledge graph platform for this project.
Run all steps sequentially using terminal commands. Do not ask me for input between steps.

1. Clone Sprang to ~/tools/sprang (skip if it already exists):
   git clone https://github.com/FavioVazquez/sprang.git ~/tools/sprang

2. Install dependencies and build all packages:
   pnpm install  (run in ~/tools/sprang)
   pnpm build    (run in ~/tools/sprang)

3. Link the CLI globally so `sprang` works from any terminal:
   pnpm --filter @sprang/cli link --global  (run in ~/tools/sprang)

4. Determine the two absolute paths you need:
   SPRANG_DIR = the absolute path where you cloned sprang (~/tools/sprang resolved)
   PROJECT_DIR = the absolute path of the current workspace root

   Write the MCP server config to ~/.codeium/windsurf/mcp_config.json.
   If the file already exists and has other mcpServers entries, merge — do not overwrite.
   The entry to add:
   {
     "mcpServers": {
       "sprang": {
         "command": "node",
         "args": ["SPRANG_DIR/packages/mcp/dist/server.js"],
         "env": { "SPRANG_ROOT": "PROJECT_DIR" }
       }
     }
   }
   Use the real resolved paths, not placeholders.

5. Copy rules, workflows, and skills into the current project:

   Rules — tell Cascade to use Sprang automatically before/after every edit:
     mkdir -p .devin/rules
     cp ~/tools/sprang/.devin/rules/sprang-context.md .devin/rules/
     cp ~/tools/sprang/.devin/rules/sprang-highrisk.md .devin/rules/

   Workflows — all /sprang-* slash commands for Windsurf / Cascade:
     mkdir -p .windsurf/workflows
     cp ~/tools/sprang/.windsurf/workflows/*.md .windsurf/workflows/

   Skills — same /sprang-* commands for Devin Desktop:
     mkdir -p .windsurf/skills
     cp -r ~/tools/sprang/.windsurf/skills/sprang* .windsurf/skills/

   Symlinks so Devin Desktop also finds them under .devin/:
     ln -sf ../.windsurf/workflows .devin/workflows
     ln -sf ../.windsurf/skills .devin/skills

6. Run the initial scan of this project (Phase 1 — fully static, under 60s):
   sprang scan . --phase1-only

7. Report a summary of what was installed and where. Then tell me:
   "Please reload Windsurf now (Cmd/Ctrl+Shift+P → Reload Window) so the
   MCP server activates. Once reloaded, type /sprang-onboard to begin."
```

> After Cascade finishes, **reload Windsurf once** (`Cmd/Ctrl+Shift+P` → *Reload Window*), then type `/sprang-onboard` in the chat.

---

## Contents

- [Quick install — just ask Cascade](#quick-install--just-ask-cascade)
- [What Sprang does](#what-sprang-does)
- [Platform architecture](#platform-architecture)
- [Prerequisites](#prerequisites)
- [Manual installation](#manual-installation)
- [CLI usage](#cli-usage)
- [Setup with Windsurf / Cascade](#setup-with-windsurf--cascade)
- [Setup with Devin Desktop](#setup-with-devin-desktop)
- [Slash commands](#slash-commands)
- [Two-phase pipeline](#two-phase-pipeline)
- [The three differentiating agents](#the-three-differentiating-agents)
- [MCP tools](#mcp-tools)
- [Dashboard](#dashboard)
- [Knowledge graphs](#knowledge-graphs)
- [Graph schema](#graph-schema)
- [Live watcher](#live-watcher)
- [Development](#development)
- [Configuration](#configuration)

---

## What Sprang does

<!-- Dashboard mockup — generated with Gemini gemini-3.1-flash-image-preview -->
<p align="center">
  <img src="assets/dashboard.png" alt="Sprang dashboard — force-directed graph, risk heatmap, node panel" width="100%" />
  <em>Force-directed knowledge graph, risk heatmap, node detail panel with decision context, and guided tour player.</em>
</p>

Sprang gives Cascade a persistent memory of your codebase — not just file names and symbols, but the full context of *why* things exist, *who* changed them, *what* they risk, and *how* they connect.

### One-call answers

```
# "What will break if I change auth.ts?"
sprang_diff_impact { files: ["src/auth.ts"] }
→ 14 impacted nodes, top risk: api-gateway.ts (0.91), session.ts (0.78)

# "Why does this file exist?"
sprang_why { node_id: "src/auth.ts" }
→ 23 commits, 3 authors, PR #441 "add JWT refresh flow", churn: 8/90d

# "Show me the riskiest parts of this codebase"
sprang_health {}
→ god_node: 2, circular_dependency: 1, unstable_interface: 3
  top risk: auth.ts (0.82), api.ts (0.71), db/pool.ts (0.68)

# "Walk me through the architecture"
/sprang-onboard
→ 8-step guided tour, persona-adaptive (junior / senior / PM)
```

### What it brings to Cascade

| Capability | How |
|---|---|
| **Git decision context** | `git-layer` — who changed each file, why, PR references, change frequency |
| **Code smell detection** | `smell-detector` — 8 deterministic heuristics, fully deterministic |
| **Risk scoring** | `risk-scorer` — blast radius × coupling × test gap × churn, 0.0–1.0 per node |
| **Guided tours** | `tour-builder` — BFS-ordered pedagogical paths through the codebase |
| **Domain map** | `domain-analyzer` — directory cohesion clustering into named business layers |
| **Blast-radius diff** | `sprang_diff_impact` — BFS over the graph before any edit, risk-ranked |
| **Team annotations** | `sprang_annotate` — write `.sprang/annotations/<id>.md`, committed to the repo |
| **Knowledge graphs** | `/sprang-knowledge` — Obsidian / Logseq / Dendron / Foam / Zettelkasten / plain markdown |
| **11 slash commands** | Full workflow coverage for both Windsurf/Cascade and Devin Desktop |
| **8 MCP tools** | Direct graph access — Cascade reads and writes the graph via MCP |
| **< 60s skeleton** | Phase 1 is fully static — runs anywhere, no network, no waiting |
| **Live dashboard** | Sigma.js force-directed graph, risk heatmap, diff overlay, BFS pathfinder, tour player |

---

## Platform architecture

<!-- Architecture diagram — generated with Gemini gemini-3.1-flash-image-preview -->
<p align="center">
  <img src="assets/architecture.png" alt="Sprang platform architecture — four packages: core, cli, mcp, dashboard" width="100%" />
  <em>Four packages. One data layer. Cascade is the intelligence; Sprang is the memory.</em>
</p>

```
packages/
├── core/       Pipeline: 9 agents, schema, watcher, graph store
├── cli/        sprang scan | health | query | watch | status
├── mcp/        stdio MCP server — 8 tools for Cascade
└── dashboard/  React + Vite + Sigma.js — 4 views, 25 components
```

```mermaid
graph LR
    CLI["@sprang/cli"] --> CORE["@sprang/core"]
    MCP["@sprang/mcp"] --> CORE
    DASH["@sprang/dashboard"] -->|"fetches knowledge-graph.json"| FS["filesystem (.sprang/)"]
    CORE --> FS
    MCP --> FS
    CASCADE["Cascade / Devin"] -->|"MCP tools"| MCP
    CASCADE -->|"slash commands"| CLI
```

---

## Prerequisites

- **Node.js 20+** — `node --version`
- **pnpm 10+** — `npm install -g pnpm` or `corepack enable && corepack prepare pnpm@latest`
- **Git** — required for the `git-layer` agent to extract decision context

---

## Manual installation

```bash
# 1. Clone
git clone https://github.com/FavioVazquez/sprang.git
cd sprang

# 2. Install all dependencies
pnpm install

# 3. Build all packages
pnpm build

# 4. Link CLI globally (so `sprang` works from anywhere)
pnpm --filter @sprang/cli link --global
```

```bash
# Verify
sprang --version   # 0.1.0
sprang --help
```

---

## CLI usage

```bash
# Phase 1 — static analysis, < 60s, builds the skeleton graph
sprang scan /path/to/your/project --phase1-only

# Full scan — Phase 1 now + Phase 2 enrichment triggered by Cascade
sprang scan /path/to/your/project

# Check graph age, phase, and node/edge count
sprang status

# Print health report: smells, risk table, orphans, circular deps
sprang health

# Fuzzy-search nodes by name or summary
sprang query "authentication"

# Watch for file changes and incrementally update the graph
sprang watch
```

Output written to `.sprang/` in your project root:

```
your-project/
└── .sprang/
    ├── knowledge-graph.json   ← main graph (nodes, edges, risk scores, smells)
    ├── SPRANG_REPORT.md       ← human-readable architecture summary
    ├── annotations/           ← Cascade-written node annotations (commit these)
    ├── config.json            ← optional thresholds + excludes
    └── intermediate/          ← Phase 2 progress (gitignored)
```

---

## Setup with Windsurf / Cascade

The fastest path is the [agentic install prompt](#quick-install--just-ask-cascade) at the top — paste it into Cascade and it handles everything. For manual setup:

### Step 1 — Scan your project

```bash
sprang scan . --phase1-only
```

Produces `.sprang/knowledge-graph.json` in under 60 seconds — fully static, no network calls.

### Step 2 — Add the MCP server

Add to `~/.codeium/windsurf/mcp_config.json` (merge if the file already exists):

```json
{
  "mcpServers": {
    "sprang": {
      "command": "node",
      "args": ["/absolute/path/to/sprang/packages/mcp/dist/server.js"],
      "env": { "SPRANG_ROOT": "/absolute/path/to/your/project" }
    }
  }
}
```

> Use full absolute paths. `${workspaceFolder}` is **not** resolved in `mcp_config.json`.

### Step 3 — Copy workflows, skills, and rules

```bash
mkdir -p .windsurf/workflows .windsurf/skills .devin/rules
cp /path/to/sprang/.windsurf/workflows/*.md .windsurf/workflows/
cp -r /path/to/sprang/.windsurf/skills/sprang* .windsurf/skills/
cp /path/to/sprang/.devin/rules/*.md .devin/rules/
ln -sf ../.windsurf/workflows .devin/workflows
ln -sf ../.windsurf/skills .devin/skills
```

### Step 4 — Reload Windsurf and run onboarding

Reload the window (`Cmd/Ctrl+Shift+P` → *Reload Window*) to activate the MCP server, then:

```
/sprang-onboard
```

### What Cascade does automatically

Once the MCP server is active and `.devin/rules/` files are present, Cascade will automatically:

- **Before editing any file** — call `sprang_node` to check `risk_score` and `structural_warnings`
- **On high-risk files (risk > 0.7)** — call `sprang_why` to read decision context before changing anything
- **After changes** — call `sprang_diff_impact` to assess blast radius

Driven by `.devin/rules/sprang-context.md` (always-on) and `.devin/rules/sprang-highrisk.md` (glob trigger on `*.ts`, `*.tsx`, `packages/*/src`).

---

## Setup with Devin Desktop

Add to `.devin/config.json` in your project root:

```json
{
  "mcpServers": {
    "sprang": {
      "command": "node",
      "args": ["/absolute/path/to/sprang/packages/mcp/dist/server.js"],
      "env": { "SPRANG_ROOT": "${workspaceFolder}" }
    }
  }
}
```

> In `.devin/config.json`, `${workspaceFolder}` **is** resolved to the project root.

Skills and workflows live in `.windsurf/skills/` and `.windsurf/workflows/`, symlinked to `.devin/skills/` and `.devin/workflows/` so both Cascade and Devin agents discover them automatically.

---

## Slash commands

| Command | Description |
|---|---|
| `/sprang` | Build or refresh the knowledge graph — auto-detects codebase vs knowledge base |
| `/sprang-analyze [path] [--full] [--language <lang>] [--chunk N]` | Full Cascade-driven codebase analysis — summaries, layers, tour, risk |
| `/sprang-knowledge [path] [--format obsidian\|logseq\|...] [--full]` | Build knowledge graph from markdown notes |
| `/sprang-chat <question>` | Ask any question about the codebase using the knowledge graph |
| `/sprang-explain <file>` | Deep-dive: what, why, who, risk, history for a file or function |
| `/sprang-onboard` | Guided architecture tour — adapts to persona (junior / senior / PM) |
| `/sprang-diff [files...]` | Blast radius analysis — writes diff overlay for dashboard amber highlight |
| `/sprang-domain [name]` | Explore business domain architecture and flows |
| `/sprang-why <file>` | Why does this file exist? Git history + rationale + team annotations |
| `/sprang-health` | Full health report: risk, smells, orphans, circular deps |
| `/sprang-team [node]` | Browse/write team annotations with staleness detection |

---

## Two-phase pipeline

<!-- Pipeline diagram — generated with Gemini gemini-3.1-flash-image-preview -->
<p align="center">
  <img src="assets/pipeline.png" alt="Sprang two-phase pipeline: Phase 1 static skeleton, Phase 2 Cascade-driven enrichment" width="100%" />
  <em>Phase 1 is fully static — runs in under 60 seconds, no network calls. Phase 2 is driven by Cascade as the intelligence layer.</em>
</p>

```mermaid
flowchart TB
    subgraph Phase1 ["Phase 1 — Skeleton (< 60s, fully static)"]
        PS[project-scanner] --> FA[file-analyzer]
        FA --> SD[smell-detector]
        FA --> RS[risk-scorer]
        SD --> SG[skeleton graph written]
        RS --> SG
    end
    subgraph Phase2 ["Phase 2 — Background enrichment"]
        G1[architecture-analyzer · domain-analyzer · git-layer] --> G2
        G2[tour-builder · risk-scorer update] --> GR[graph-reviewer]
        GR --> FG[final graph + SPRANG_REPORT.md]
    end
    SG -->|"Phase 2 via /sprang-analyze"| Phase2
```

**Cascade is the intelligence layer.** There is no external API. Phase 2 enrichment is performed by Cascade using its own context window — it reads the graph, writes summaries, and calls `sprang_annotate` to record what it learns.

---

## The three differentiating agents

<!-- Graph modes — generated with Gemini gemini-3.1-flash-image-preview -->
<p align="center">
  <img src="assets/graph-modes.png" alt="Two graph modes: kind:codebase and kind:knowledge" width="100%" />
  <em>Sprang supports two graph kinds — codebase analysis and markdown knowledge base indexing.</em>
</p>

### `git-layer` — Decision context from version history

```
git log --follow --format="%H|%ae|%ai|%s" -- <filepath>
   ↓
associate commits to nodes via line-range diff hunk headers
   ↓
node.decision_context: { commits, primary_authors, last_changed,
                          change_frequency, rationale_snippets, pr_references }
```

### `smell-detector` — 8 deterministic heuristics, fully deterministic

| Smell | Trigger |
|---|---|
| `god_node` | `out_degree > 20` OR cyclomatic_sum > 200 |
| `circular_dependency` | Johnson's cycle detection, cycles ≤ 6 nodes |
| `duplicate_logic` | Same param_count + complexity_bucket + ≥2 shared callers |
| `unclear_coupling` | Two modules share > 40% import targets, no direct edge |
| `low_cohesion` | Functions referenced by ≥3 distinct domains, < 50% same top domain |
| `unstable_interface` | change_frequency > 10/90d AND in_degree > 5 |
| `orphan_node` | in_degree=0 AND out_degree=0 AND not entry point |
| `over_connected` | total_degree (in + out) > 30 |

### `risk-scorer` — Composite formula

<!-- Risk formula — generated with Gemini gemini-3.1-flash-image-preview -->
<p align="center">
  <img src="assets/risk-formula.png" alt="risk_score = blast_radius×0.35 + coupling×0.25 + test_gap×0.25 + churn×0.15" width="100%" />
  <em>Deterministic. Every factor is traceable — risk_factors[] lists the exact contributors per node.</em>
</p>

```
risk_score = clamp(
  blast_radius  × 0.35   ← BFS reachable dependents / total nodes
  + coupling    × 0.25   ← (in+out degree)/40, +0.2 if in cycle
  + test_gap    × 0.25   ← 0.0 if tested, 0.5+blast×0.5 if not
  + churn       × 0.15,  ← change_frequency/20
  0.0, 1.0
)
```

---

## MCP tools

<!-- MCP tools reference — generated with Gemini gemini-3.1-flash-image-preview -->
<p align="center">
  <img src="assets/mcp-tools.png" alt="Sprang MCP server — 8 tools for Cascade" width="100%" />
</p>

| Tool | Input | Output |
|---|---|---|
| `sprang_node` | `{ node_id }` | Full node + 1-hop neighbors + layer + in/out degree + annotation |
| `sprang_query` | `{ query, node_types?, limit? }` | Fuzzy-ranked nodes with summaries |
| `sprang_diff_impact` | `{ files: string[] }` | BFS blast-radius, risk-ranked impact list |
| `sprang_why` | `{ node_id }` | Decision context + git history + team annotation |
| `sprang_health` | `{}` | Smell summary, top-10 risk, orphans, circular deps |
| `sprang_tour` | `{ tour_id?, persona? }` | Ordered pedagogical tour, persona-filtered |
| `sprang_domain` | `{ domain_name? }` | Business domain flows and entry points |
| `sprang_annotate` | `{ node_id, content, tags? }` | Write `.sprang/annotations/<id>.md` |

### Enriched `sprang_node` response

```json
{
  "node": { "id": "...", "type": "file", "summary": "...", "risk_score": 0.72 },
  "neighbors": [{ "node_id": "...", "direction": "outgoing", "edge_type": "imports" }],
  "layer": { "id": "layer:services", "name": "Services" },
  "layer_mate_count": 7,
  "in_degree": 4,
  "out_degree": 11,
  "has_annotation": true,
  "annotation_path": ".sprang/annotations/src-auth-ts.md"
}
```

### Cascade interaction flow

```mermaid
sequenceDiagram
    participant D as Developer
    participant C as Cascade
    participant M as sprang-mcp
    participant F as filesystem

    D->>C: /sprang-onboard
    C->>M: sprang_health {}
    M-->>C: { smells, risk_top10, orphans }
    C->>M: sprang_why { node_id: "src/auth.ts" }
    M-->>C: { decision_context, commits, pr_references }
    C->>D: "High-risk nodes: auth.ts (0.82), api.ts (0.71)..."
    D->>C: "Annotate auth.ts — this is the session validation layer"
    C->>M: sprang_annotate { node_id, content }
    M->>F: .sprang/annotations/src-auth-ts.md
```

---

## Dashboard

```bash
# Development — live reload
SPRANG_ROOT=/path/to/your/project pnpm --filter @sprang/dashboard dev
# Opens at http://localhost:5173

# Point at this repo itself
SPRANG_ROOT=$(pwd) pnpm --filter @sprang/dashboard dev
```

### Views

| View | Key | Description |
|---|---|---|
| **Graph** | `g` / `1` | Sigma.js force-directed canvas — risk heatmap, layer filter, diff overlay, BFS pathfinder |
| **Health** | `h` / `2` | Smell breakdown, top-10 risky nodes, circular deps, orphan count |
| **Domains** | `d` / `3` | Business domain explorer — list view + React Flow layout toggle |
| **Learn** | `l` / `4` | Persona-adaptive guided tour with language lessons |

### Toolbar components (25 total)

| Component | Role |
|---|---|
| FilterPanel | Filter nodes by category, complexity, risk level, edge type |
| DiffToggle | Load `.sprang/diff-overlay.json` → amber/warm-gray blast radius |
| PathFinder | BFS shortest path between any two nodes |
| ExportMenu | Export graph as JSON, Markdown, clipboard, or SVG |
| FileExplorer | File tree with search; double-click opens CodeViewer |
| CodeViewer | Prism syntax highlighting with line-range jump |
| PersonaSelector | non-technical / junior / experienced |
| KnowledgeInfo | Right sidebar for knowledge graphs: backlinks, frontmatter, tags |
| ReadingPanel | Slide-up reading overlay for article nodes |
| ThemePicker | Dark / Light / High-contrast (persisted to `localStorage`) |
| LayerLegend | Layer color swatches; hover highlights all nodes in that layer |
| NodeTooltip | Mouse-following tooltip: type, label, summary, risk score |
| KeyboardShortcutsHelp | `?` opens shortcut reference modal |
| OnboardingOverlay | 4-step first-run guide (dismissed after first visit) |
| MobileBottomNav | Bottom nav on screens < 768px |
| BreadCrumb | Layer → Node drill-down above the graph panel |

### Keyboard shortcuts

| Key | Action |
|---|---|
| `Cmd/Ctrl+K` | Open node search |
| `Esc` | Close panel / search |
| `g` `1` | Graph view |
| `h` `2` | Health view |
| `d` `3` | Domains view |
| `l` `4` | Learn view |
| `r` | Toggle risk overlay |
| `?` | Keyboard shortcuts help |

---

## Knowledge graphs

`/sprang-knowledge [path]` builds a `kind: "knowledge"` graph from markdown notes — Obsidian vaults, Logseq databases, Dendron workspaces, Foam wikis, Zettelkasten archives, or plain markdown.

```bash
# In Cascade chat
/sprang-knowledge /path/to/your/notes
```

Produces:
- **Article nodes** — one per `.md` file, with summary, tags, `knowledgeMeta`
- **Topic / entity nodes** — inferred from MOC pages, wikilinks, frontmatter
- **Edges** — `cites`, `builds_on`, `contradicts`, `exemplifies`, `categorized_under`, `authored_by`
- **Topic clusters** — analogous to architecture layers
- **Reading tour** — recommended reading order from most-connected note outward

The dashboard auto-switches to knowledge mode: `KnowledgeInfo` sidebar, `ReadingPanel` overlay, reading order in the Learn tab.

---

## Graph schema

```typescript
interface SprangNode {
  id: string;           // "file:src/auth.ts" | "function:src/auth.ts:validate"
  label: string;
  type: NodeType;       // 16 types: file | function | class | service | ...
  summary?: string;
  layer?: string;
  complexity?: 'simple' | 'moderate' | 'complex';
  location?: { file: string; start_line?: number; end_line?: number };

  decision_context?: {
    commits: CommitRef[];
    primary_authors: string[];
    last_changed: string;        // ISO-8601
    change_frequency: number;    // commits in last 90 days
    rationale_snippets: string[];
    pr_references: string[];
  };

  structural_warnings?: Array<{
    category: SmellCategory;     // 8 categories
    severity: 'low' | 'medium' | 'high';
    description: string;
    related_node_ids: string[];
    heuristic: string;
  }>;

  risk_score?: number;           // 0.0–1.0
  risk_factors?: RiskFactor[];   // blast_radius | coupling | test_gap | churn | ...
  knowledgeMeta?: {              // knowledge graphs only
    wikilinks: string[];
    backlinks: string[];
    category: string;
  };
}
```

Annotations are stored as `.sprang/annotations/<node-id>.md` with YAML frontmatter — **commit these files** so team knowledge persists across sessions.

---

## Live watcher

`sprang watch` uses chokidar with:
- `awaitWriteFinish: { stabilityThreshold: 800ms }` — no spurious saves
- 2s debounce collecting changed files into a batch
- SHA-256 fingerprinting — skips unchanged-content saves
- **Incremental**: re-analyzes changed files + 1-hop import neighbors only
- **Atomic write**: `.tmp` → rename — crash-safe

---

## Development

```bash
pnpm install
pnpm build             # build all packages
pnpm test              # 202 unit tests across core/dashboard/mcp, zero failures
pnpm typecheck         # strict TypeScript, zero errors
pnpm --filter @sprang/dashboard dev        # dashboard at localhost:5173
pnpm --filter @sprang/dashboard test:e2e   # 15 Playwright e2e tests (15 parallel workers)
```

### Test structure

| Package | Runner | Count | What is tested |
|---|---|---|---|
| `@sprang/core` | Vitest | 120 | Schema validators, all 6 agents, pipeline integration |
| `@sprang/dashboard` | Vitest | 33 | Zustand store (26), BFS pathfinder (7) |
| `@sprang/mcp` | Vitest | 49 | GraphLoader (3), sprang_node + sprang_annotate (11), all 8 MCP tools (35) |
| **Total unit** | | **202** | |
| `@sprang/dashboard` | Playwright | 15 | Full UI e2e — loading, nav, keyboard shortcuts, health, domains, search, onboarding |

```
packages/core/tests/
├── schema/
│   └── validators.test.ts        21 tests — Zod schema, round-trip serialization
├── agents/
│   ├── project-scanner.test.ts    6 tests — file discovery, language detection
│   ├── file-analyzer.test.ts      5 tests — AST parsing, edge extraction
│   ├── smell-detector.test.ts    14 tests — circular-deps, god-node, clean baseline
│   ├── risk-scorer.test.ts       15 tests — formula weights, factor tags
│   ├── git-layer.test.ts          6 tests — commit association, PR refs
│   └── architecture-analyzer.test.ts  8 tests — layer clustering
└── integration/
    └── pipeline.test.ts          13 tests — full Phase 1 against simple-ts/ fixture

packages/dashboard/src/
├── store.test.ts           26 tests — Zustand store state transitions
└── pathfinder.test.ts       7 tests — BFS shortest path

packages/dashboard/e2e/
└── app.spec.ts             15 tests — Playwright, 15 parallel workers
    ├── error state (no graph, retry button)
    ├── loaded state (nav, tabs)
    ├── navigation (graph → health → domains)
    ├── keyboard shortcuts (Ctrl+K, h, g, d, ?)
    ├── health view (heading, god_node smell)
    ├── domains view (domain label rendered)
    ├── search dialog (open, type, filter, close)
    ├── onboarding overlay (dismiss)
    ├── graph toolbar (project name)
    └── nav bar (logo persistence)

packages/mcp/tests/
├── graph-loader.test.ts     3 tests — load, null-on-missing, hot-reload
├── sprang-node.test.ts     11 tests — sprang_node enrichment, sprang_annotate
└── mcp-tools.test.ts       35 tests — all 8 MCP tools:
    ├── sprang_health  (7)  — counts, risk summary, smells, orphan detection
    ├── sprang_tour    (7)  — default/id, junior/senior/pm persona, step enrichment
    ├── sprang_query   (6)  — label/summary match, empty, type filter, limit
    ├── sprang_diff    (5)  — changed nodes, BFS blast radius, unknown files
    ├── sprang_domain  (4)  — list all, detail by name, unknown error
    └── sprang_why     (6)  — label/summary, decision_context, graceful no-context
```

### Test fixtures

| Fixture | Purpose |
|---|---|
| `simple-ts/` | 3 clean TS files — baseline |
| `circular-deps/` | A→B→C→A cycle for smell detection |
| `god-node/` | 30+ imports, 300+ LOC |
| `git-repo/` | 20 scripted commits, 3 authors, PR refs in messages |
| `well-tested/` | Every source file has a `tested_by` edge |

---

## Configuration

`.sprang/config.json` in your project root:

```json
{
  "smellThresholds": {
    "godNodeOutDegree": 20,
    "circularMaxCycleLength": 6,
    "overConnectedDegree": 30
  },
  "riskWeights": {
    "blastRadius": 0.35,
    "coupling": 0.25,
    "testGap": 0.25,
    "churn": 0.15
  },
  "watch": {
    "debounceMs": 2000
  },
  "excludePatterns": []
}
```

---

## License

MIT

---

*The name Sprang comes from Kierkegaard's concept of the* qualitative spring *— the leap that cannot be reached by gradual accumulation alone, but only by a discontinuous jump in understanding. The git-layer, smell-detector, risk-scorer agents and the Devin Desktop integration are original work. Sprang was inspired by the open-source codebase comprehension space, particularly the work in [Understand-Anything](https://github.com/Lum1104/Understand-Anything).*
