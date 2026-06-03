# Sprang

**The qualitative leap** (*kvalitativ spring*, Kierkegaard) in codebase comprehension.

Sprang is a knowledge graph platform for [Devin Desktop](https://devin.ai) (Cascade + Devin Local) that creates total codebase comprehension — not just symbol search, but *why* code exists, *who* changed it, *what* it risks, and *how* it all fits together.

It is a superior port and extension of the open-source [Understand Anything](https://github.com/Lum1104/Understand-Anything) plugin, rebuilt natively for Devin Desktop with three differentiating agents UA lacks entirely.

---

## What's different from Understand Anything

| | Understand Anything | Sprang |
|---|---|---|
| **git history** | ✗ | ✅ `git-layer` — decision context, PR refs, rationale extracted by LLM |
| **code smells** | ✗ | ✅ `smell-detector` — 8 deterministic detectors, zero LLM |
| **risk scoring** | ✗ | ✅ `risk-scorer` — blast radius × coupling × test gap × churn |
| **Cascade Workflows** | ✗ | ✅ 7 slash commands |
| **Agent Skills** | ✗ | ✅ 7 skills |
| **MCP server** | ✗ | ✅ 8 tools |
| **Phase 1 < 60s** | ✗ | ✅ skeleton graph in < 60s, enrichment in background |

---

## Quick start

```bash
# Scan your project (Phase 1: < 60s, no API key needed)
npx sprang scan /path/to/your/project

# Full scan with LLM enrichment (requires ANTHROPIC_API_KEY)
ANTHROPIC_API_KEY=sk-... npx sprang scan /path/to/your/project

# Check health
npx sprang health

# Query the graph
npx sprang query "authentication"

# Watch for changes
npx sprang watch

# Check status
npx sprang status
```

---

## Devin Desktop setup

Add to `.devin/config.json` in your project:

```json
{
  "mcpServers": {
    "sprang": {
      "command": "npx",
      "args": ["sprang-mcp"],
      "env": { "SPRANG_ROOT": "${workspaceFolder}" }
    }
  }
}
```

Then in Cascade: `/sprang-onboard` to build the initial graph.

### Available slash commands

| Command | Description |
|---|---|
| `/sprang` | Build or refresh the knowledge graph |
| `/sprang-onboard` | Full onboarding — scan + tour + health summary |
| `/sprang-diff` | Analyze impact of changed files |
| `/sprang-domain` | Explore domain architecture |
| `/sprang-why <file>` | Why does this file exist? Git history + rationale |
| `/sprang-health` | Full health report: risk, smells, orphans |
| `/sprang-team` | Team contribution analysis |

---

## Two-phase execution

**Phase 1** (< 60s, zero LLM, zero API key):
- File enumeration, language detection, import graph
- Function/class extraction, complexity analysis
- Architecture layers, code smells (8 deterministic detectors)
- Risk scoring (blast radius, coupling, test gap, churn)

**Phase 2** (background, LLM-enriched, optional):
- 2-sentence summaries for every node
- Domain clustering with LLM-named domains
- Git rationale extraction ("why was this changed?")
- Pedagogical tour building

> **No API key?** Phase 1 alone is fully useful. Cascade is the LLM — the MCP tools feed it the graph, and Cascade writes its own understanding as annotations.

---

## MCP tools

| Tool | Input | Output |
|---|---|---|
| `sprang_query` | `{ query, limit? }` | TF-IDF ranked nodes with summaries |
| `sprang_node` | `{ node_id }` | Full node + 1-hop neighborhood |
| `sprang_diff_impact` | `{ files: string[] }` | BFS impact analysis, risk-ranked |
| `sprang_tour` | `{ tour_id? }` | Ordered pedagogical tour steps |
| `sprang_domain` | `{ domain_name? }` | Domain hierarchy |
| `sprang_health` | `{}` | Smell summary, top-10 risk, orphans, circular deps |
| `sprang_why` | `{ node_id }` | Decision context + annotation content |
| `sprang_annotate` | `{ node_id, content, tags? }` | Write `.sprang/annotations/<id>.md` |

---

## Architecture

```
packages/
├── core/       Pipeline, 9 agents, schema, watcher
├── cli/        npx sprang (scan, health, query, watch, status)
├── mcp/        stdio MCP server (8 tools)
└── dashboard/  React + Vite + Sigma.js visualization
```

The three new agents are the core product:

- **`git-layer`** — For every file node, mines `git log --follow` to build `decision_context`: who changed it, when, why (LLM-extracted rationale), PR references, change frequency. Uses p-queue concurrency=6. Caches per-sha.

- **`smell-detector`** — 8 heuristics: `god_node` (out_degree > 20), `circular_dependency` (Johnson's cycle detection), `orphan_node`, `over_connected` (degree > 30), `unstable_interface` (churn > 10/90d + in_degree > 5), `duplicate_logic`, `unclear_coupling`, `low_cohesion`. **Zero LLM calls.**

- **`risk-scorer`** — Formula: `blast_radius × 0.35 + coupling × 0.25 + test_gap × 0.25 + churn × 0.15`. BFS for blast radius. +0.2 coupling boost for circular deps. 8 `risk_factors[]` tags.

---

## Development

```bash
pnpm install
pnpm build          # build all packages
pnpm test           # 52 tests
pnpm --filter @sprang/dashboard dev   # dashboard at localhost:7338
```

---

## Configuration

Create `.sprang/config.json` in your project root to override defaults:

```json
{
  "smellThresholds": {
    "godNodeOutDegree": 20,
    "circularMaxCycleLength": 6
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
