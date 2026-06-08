---
description: Analyze a codebase to produce a rich semantic knowledge graph — file summaries, architecture layers, guided tour, domain map, risk scores. Better than /understand.
---

# /sprang-analyze

Produce a `.sprang/knowledge-graph.json` for the project with full semantic enrichment.
Cascade IS the analysis engine — you read every file and write rich understanding into the graph.

> **CRITICAL — DO NOT STOP EARLY:** This workflow has 8 phases (Phase 0 through Phase 7). You MUST complete ALL phases in a single run. If you stop after Phase 3, the dashboard Architecture, Domains, and Learn tabs will be empty. Keep going until you see "Knowledge graph saved" at the end of Phase 7.

> **⛔ NEVER write `.sprang/knowledge-graph.json` directly.** The ONLY way to produce the final graph is to run `merge.py` at the end of Phase 7. Writing the graph file yourself will produce a broken file that the dashboard cannot load. All intermediate data goes into `$SPRANG_ROOT/intermediate/` as chunk files.

> **RESUME SUPPORT:** If the graph already exists at `phase: complete`, skip Phases 1–3 entirely and jump straight to Phase 4 — all file analysis is already done.

## Options (from $ARGUMENTS)
- `--full` — Force complete rebuild
- `--language <lang>` — Output language (default: en). Accepts ISO codes (zh, ja, ko, es, fr, de, pt, ru) or friendly names
- A directory path — analyze that directory instead of cwd
- `--chunk <N>` — Split output into chunks of N nodes for very large projects (default: no chunking)

---

## Phase 0 — Pre-flight

1. **Resolve PROJECT_ROOT:**
   - Parse `$ARGUMENTS` for a non-flag token. If found and it's a directory, set PROJECT_ROOT to it (resolve relative paths). Otherwise use cwd.
   - Verify it exists: `test -d "$PROJECT_ROOT"`

2. **Resolve SPRANG_ROOT** (where graph output goes):
   ```bash
   SPRANG_ROOT="$PROJECT_ROOT/.sprang"
   mkdir -p "$SPRANG_ROOT/intermediate" "$SPRANG_ROOT/tmp" "$SPRANG_ROOT/cache"
   ```

3. **Check for `.sprangignore`** in `$PROJECT_ROOT`:
   - If it exists, read it — honor glob patterns when building file lists (same syntax as `.gitignore`)
   - Always implicitly ignore: `node_modules/`, `.git/`, `dist/`, `build/`, `__pycache__/`, `*.min.js`, `*.map`, `*.lock`, `pnpm-lock.yaml`, `yarn.lock`, `package-lock.json`, `.sprang/`, `test-results/`, `playwright-report/`
   - Common patterns to suggest adding to `.sprangignore` if not present: `coverage/`, `*.test.snap`, `generated/`

4. **Language config:**
   - If `--language <lang>` in $ARGUMENTS, normalize to ISO code and store as OUTPUT_LANGUAGE
   - Otherwise check `$SPRANG_ROOT/config.json` for `outputLanguage`, default to `en`
   - Store LANGUAGE_DIRECTIVE: "Generate all textual content (summaries, descriptions, tags, titles) in **{language}**. Keep technical terms in English when no standard translation exists."

5. **Incremental vs full:**
   - Check if `$SPRANG_ROOT/knowledge-graph.json` exists and has `phase: complete`
   - Get current git hash: `git -C "$PROJECT_ROOT" rev-parse HEAD 2>/dev/null`
   - If graph exists, read its `generated_at` and `stats.gitCommitHash`
   - If `--full` flag or no existing graph: run full analysis
   - If graph exists and commit unchanged: ask user — rebuild, or nothing?
   - If graph exists and files changed: run incremental (only changed files)
   - For incremental, get changed files: `git -C "$PROJECT_ROOT" diff <lastHash>..HEAD --name-only`

6. **Collect project context:**
   - Read README.md (first 3000 chars) → README_CONTENT
   - Read package.json / pyproject.toml / Cargo.toml / go.mod → MANIFEST_CONTENT
   - Run: `find "$PROJECT_ROOT" -maxdepth 2 -type f -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/dist/*' | head -100` → DIR_TREE
   - Detect entry point (check in order): src/index.ts, src/main.ts, src/App.tsx, index.js, main.py, manage.py, app.py, main.go, src/main.rs → ENTRY_POINT

**RESUME CHECK (run after resolving PROJECT_ROOT above):**
```bash
python3 -c "
import json, os
p = os.path.join(os.environ.get('PROJECT_ROOT', '.'), '.sprang', 'knowledge-graph.json')
if os.path.exists(p):
    g = json.load(open(p))
    print('PHASE:', g.get('phase'), '| NODES:', len(g.get('nodes', [])), '| LAYERS:', len(g.get('layers', [])))
else:
    print('NO_GRAPH')
"
```
- If output contains `PHASE: complete` and no `--full` → ask user if they want to rebuild, or jump to Phase 4 for enrichment-only re-run
- If output contains `PHASE: skeleton` → resume from Phase 3 (file analysis done, need layers/tour/domains/risk)
- Otherwise → run from Phase 1

Report: `[Phase 0/7] Pre-flight complete. Project: $PROJECT_ROOT | Ignoring: <N .sprangignore patterns>`

---

## Phase 1 — SCAN

Report: `[Phase 1/7] Scanning project files...`

**Your job:** Enumerate all project files, detect languages/frameworks, resolve import graph.

1. **Run file enumeration:**
   ```bash
   # Prefer git-tracked files; fall back to find for non-git dirs
   git -C "$PROJECT_ROOT" ls-files 2>/dev/null | grep -v '^\.git/' > "$SPRANG_ROOT/tmp/file-list-raw.txt" \
     || find "$PROJECT_ROOT" -type f -not -path '*/.git/*' -not -path '*/node_modules/*' -not -path '*/dist/*' -not -path '*/build/*' -not -path '*/__pycache__/*' | sed "s|$PROJECT_ROOT/||" > "$SPRANG_ROOT/tmp/file-list-raw.txt"
   # Apply .sprangignore patterns (and always-ignore list from Phase 0 step 3)
   # Write filtered list to file-list.txt
   ```

2. **For each file, determine:**
   - `language`: typescript, javascript, python, go, rust, java, kotlin, csharp, ruby, php, cpp, c, markdown, json, yaml, toml, html, css, scss, sql, graphql, protobuf, shell, dockerfile, unknown
   - `fileCategory`: code | config | docs | infra | data | script | markup
     - `infra`: Dockerfile*, docker-compose.*, Makefile, Jenkinsfile, .github/workflows/*, *.tf, *.k8s.yml
     - `docs`: *.md, *.rst, *.txt (not LICENSE)
     - `config`: *.json, *.yaml, *.yml, *.toml, *.xml, *.env, *.ini, *.cfg, *.properties, *.csproj
     - `data`: *.sql, *.graphql, *.gql, *.proto, *.prisma, *.csv
     - `script`: *.sh, *.bash, *.zsh, *.ps1, *.bat
     - `markup`: *.html, *.htm, *.css, *.scss, *.sass, *.less
     - `code`: everything else
   - `sizeLines`: count lines (use `wc -l`)

3. **Build import map** — for code files, resolve project-internal imports:
   - TypeScript/JavaScript: parse `import ... from 'path'` and `require('path')` — resolve relative paths, strip extensions, check if target exists
   - Python: parse `from . import`, `from .module import`, `import module` — resolve against project root
   - Go: parse `import "module/path"` — strip go.mod module prefix
   - Other: extract what you can via grep patterns for the language
   - ONLY include project-internal imports (skip node_modules, stdlib, external packages)

4. **Detect frameworks** from MANIFEST_CONTENT — check for: react, vue, svelte, angular, express, fastify, next, nuxt, vite, django, fastapi, flask, rails, spring, gin, actix, axum, tailwindcss, prisma, etc.

5. **Write scan result:**
   ```bash
   cat > "$SPRANG_ROOT/intermediate/scan-result.json" << 'EOF'
   {
     "name": "<project name from manifest/dirname>",
     "description": "<1-2 sentence description from README/manifest>",
     "languages": ["<sorted unique languages>"],
     "frameworks": ["<detected frameworks>"],
     "files": [
       {"path": "src/index.ts", "language": "typescript", "sizeLines": 150, "fileCategory": "code"}
     ],
     "totalFiles": 0,
     "importMap": {
       "src/index.ts": ["src/utils.ts"]
     }
   }
   EOF
   ```

Write phase marker:
```bash
echo '{"phase_completed": "scan", "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"}' > "$SPRANG_ROOT/intermediate/phase1-done.json"
```

Report: `[Phase 1/7] Scan complete. Found <N> files across <langs>. Entry point: <ENTRY_POINT>`

---

## Phase 2 — ANALYZE FILES

Report: `[Phase 2/7] Analyzing files — <N> files in batches of up to 10...`

**Your job:** Read each file and produce semantic graph nodes with rich summaries.

### Batching strategy
- Sort files: first by estimated importance (entry points, service files, heavily-imported files first), then by size descending
- **Semantic batching**: group related files together (same directory, same import cluster) — they share context which improves analysis quality
- Batch: **max 10 files per batch, max ~800 total lines per batch** — keep batches small to avoid context overflow
- Config/docs/infra files can be batched more aggressively (up to 15 per batch)
- Very large files (>300 lines): analyze alone in their own batch

### For each file in each batch, produce a GraphNode:

```json
{
  "id": "<type>:<relative-path>",
  "type": "file|config|document|service|pipeline|table|schema|resource|endpoint",
  "name": "<filename>",
  "label": "<filename>",
  "filePath": "<relative path>",
  "summary": "<2-3 sentences: what this file does, its role, why it exists>",
  "tags": ["<relevant tags — api-handler, utility, entry-point, test, middleware, etc.>"],
  "complexity": "simple|moderate|complex",
  "layer": null,
  "languageNotes": "<optional: interesting patterns, idioms, or concepts in this file>",
  "location": {"file": "<relative path>"},
  "metadata": {
    "language": "<language>",
    "sizeLines": 0,
    "fileCategory": "code"
  }
}
```

**Also produce sub-file nodes** for functions and classes (for code files with >30 lines):
```json
{
  "id": "function:<path>:<functionName>",
  "type": "function",
  "name": "<functionName>",
  "label": "<functionName>",
  "filePath": "<path>",
  "summary": "<what this function does>",
  "tags": [],
  "complexity": "simple|moderate|complex",
  "location": {"file": "<path>", "start_line": 0, "end_line": 0}
}
```

**Produce edges** for each file:
- `imports` edges: use the pre-resolved importMap from Phase 1
- `contains` edges: file → function/class nodes within it
- `calls` edges: function → function across files (when clearly determinable)
- `inherits` / `implements`: class relationships
- `configures`: config → code files it configures
- `documents`: docs → code they describe
- `deploys` / `triggers`: infrastructure relationships
- `tests`: test files → source files they test

**Complexity criteria:**
- `simple`: <50 lines, 1-3 functions, no nested conditionals, pure utility
- `moderate`: 50-200 lines, clear structure, some business logic
- `complex`: >200 lines, multiple responsibilities, nested logic, many dependencies

**Write each batch — ALWAYS use write_to_file per batch, max 50 nodes per file.**

Use this exact naming — `merge.py` reads these files by name:
```bash
# Nodes (plain array, max 50 per file):
cat > "$SPRANG_ROOT/intermediate/final-nodes-chunk-1.json" << 'EOF'
[...up to 50 node objects...]
EOF

cat > "$SPRANG_ROOT/intermediate/final-nodes-chunk-2.json" << 'EOF'
[...next 50 node objects...]
EOF

# Edges (all edges in one file, plain array):
cat > "$SPRANG_ROOT/intermediate/final-edges.json" << 'EOF'
[...all edge objects...]
EOF
```

**NEVER write raw JSON inline for more than 5 nodes.** Always use write_to_file or a shell heredoc.
**NEVER write `.sprang/knowledge-graph.json` yourself at any point.** `merge.py` does this in Phase 7.

Report after each batch: `Batch <X>/<total>: analyzed <files> (files: foo.ts, bar.ts, ...)`

### After all batches complete — write a metadata file only
```bash
cat > "$SPRANG_ROOT/intermediate/assembled-graph.json" << 'EOF'
{
  "project_name": "<name from scan-result.json>",
  "description": "<description from scan-result.json>",
  "languages": ["<languages>"],
  "frameworks": ["<frameworks>"]
}
EOF
echo '{"phase_completed": "files", "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"}' > "$SPRANG_ROOT/intermediate/phase2-done.json"
```

Report: `[Phase 2/7] File analysis complete. <N> nodes, <E> edges.`

> **DO NOT STOP HERE.** Proceed immediately to Phase 3 — Architecture Layers.

---

## Phase 3 — ARCHITECTURE LAYERS

Report: `[Phase 3/7] Identifying architectural layers...`

**Your job:** Assign every file node to exactly one architectural layer.

1. Read `assembled-graph.json` — load all file-level nodes and import edges
2. Analyze the directory structure and import patterns to identify 3-10 logical layers
3. Common layer patterns (adapt to the actual project):
   - **Presentation/UI**: React components, views, pages, templates, CSS
   - **API/Routes**: HTTP handlers, controllers, routers, endpoints
   - **Business Logic/Services**: Domain logic, use cases, service classes
   - **Data/Repository**: DB models, ORMs, data access, migrations, schemas
   - **Infrastructure**: Docker, CI/CD, deployment, Terraform, Kubernetes
   - **Configuration**: Config files, env, settings, build tooling
   - **Documentation**: READMEs, guides, specs
   - **Tests**: Test files, fixtures, mocks
   - **Utilities**: Shared helpers, types, constants

4. For each layer, assign all file-level nodes that belong to it — every node must appear in exactly one layer

5. **Write directly to `final-layers.json`** (merge.py reads this filename):
   ```bash
   cat > "$SPRANG_ROOT/intermediate/final-layers.json" << 'EOF'
   [
     {
       "id": "layer:api",
       "name": "API Layer",
       "description": "HTTP route handlers and request/response logic",
       "node_ids": ["file:src/routes/index.ts", "file:src/controllers/auth.ts"]
     }
   ]
   EOF
   echo '{"phase_completed": "layers", "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"}' > "$SPRANG_ROOT/intermediate/phase3-done.json"
   ```

Report: `[Phase 3/7] Architecture complete. <N> layers, <M> nodes assigned.`

> **DO NOT STOP HERE.** Proceed immediately to Phase 4 — Guided Tour.

---

## Phase 4 — GUIDED TOUR

Report: `[Phase 4/7] Building guided learning tour...`

**Your job:** Create a BFS-ordered walkthrough of the codebase for someone new.

1. Read `assembled-graph.json` + `final-layers.json` + README_CONTENT + ENTRY_POINT
2. Build a 5-8 step tour that teaches the codebase in the right order:
   - Start from ENTRY_POINT or README
   - Follow the dependency graph (imports/calls) outward
   - Cover all architectural layers
   - Each step explains WHY this file matters, not just what it does
   - Align the narrative with what the README says the project is

3. **Write directly to `final-tours.json`** (merge.py reads this filename):

   The tour must be wrapped in a single Tour object (not a raw step array):
   ```bash
   cat > "$SPRANG_ROOT/intermediate/final-tours.json" << 'EOF'
   [
     {
       "id": "tour-main",
       "title": "Architecture Tour",
       "description": "<1-sentence description of what this tour covers>",
       "entry_point": "file:src/main.ts",
       "steps": [
         {
           "step_title": "Project Entry Point",
           "explanation": "This is where everything starts. <explain what main.ts does and why it matters>",
           "highlight": true,
           "node_ids": ["file:src/main.ts"]
         }
       ]
     }
   ]
   EOF
   echo '{"phase_completed": "tour", "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"}' > "$SPRANG_ROOT/intermediate/phase4-done.json"
   ```

   > ⚠️ The tour array **must** contain Tour objects with a `steps` array. Do NOT write a flat array of steps — that format is not recognized by the dashboard.

Report: `[Phase 4/7] Tour complete. <N> steps.`

> **DO NOT STOP HERE.** Proceed immediately to Phase 5 — Domain Mapping.

---

## Phase 5 — DOMAIN MAPPING

Report: `[Phase 5/7] Mapping code to business domains...`

**Your job:** Cluster nodes into business-meaningful domains, flows, and steps that explain what the codebase *does* in product terms (not technical terms).

A domain is a business capability (e.g. "Authentication", "Payments", "Knowledge Graph Engine").
A flow is a user-facing process within that domain (e.g. "Login Flow", "Graph Construction").
A step is a group of files that implement one part of that flow.

1. Read `assembled-graph.json`, `final-layers.json`, and README_CONTENT
2. Identify 2-6 business domains by asking: "What does this product *do* for users?"
3. For each domain, identify 1-4 flows (key user journeys or operational processes)
4. For each flow, identify 2-5 steps (discrete implementation stages), each referencing node IDs

5. **Write `final-domains.json`** (merge.py reads this filename):
   ```bash
   cat > "$SPRANG_ROOT/intermediate/final-domains.json" << 'EOF'
   [
     {
       "id": "domain:core",
       "label": "Core Domain Name",
       "summary": "What this domain does in 1-2 sentences from a product/business perspective.",
       "flows": [
         {
           "id": "flow:main-flow",
           "label": "Flow Name",
           "summary": "What this flow accomplishes for users.",
           "steps": [
             {
               "id": "step:step-1",
               "label": "Step Name",
               "summary": "What this step does technically, in plain language.",
               "node_ids": ["file:src/feature.ts"],
               "weight": 0.8
             }
           ],
           "entry_points": ["file:src/feature.ts"],
           "business_rules": ["Key constraint or invariant the code enforces"]
         }
       ],
       "entities": ["file:src/schema.ts"]
     }
   ]
   EOF
   echo '{"phase_completed": "domains", "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"}' > "$SPRANG_ROOT/intermediate/phase5-done.json"
   ```

   **Constraints:**
   - `weight` must be between 0.0 and 1.0 (importance of this step within the flow)
   - `id` values must be unique across all domains, flows, and steps
   - Prefer node IDs that are file-level nodes (`file:path/to/file.ts`), not function-level

Report: `[Phase 5/7] Domains complete. <N> domains, <M> flows.`

> **DO NOT STOP HERE.** Proceed immediately to Phase 6 — Risk + Smells.

---

## Phase 6 — RISK + SMELLS + GIT LAYER

Report: `[Phase 6/7] Scoring risk and detecting structural issues...`

**Your job:** Score risk for the most important nodes and attach git history context.

### Step 1 — Git layer (for top 10–20 most-imported files)

For each high-importance file node, run:
```bash
# Get commit history for the last 90 days
git -C "$PROJECT_ROOT" log --follow --since="90 days ago" --format="%H|%ae|%as|%s" -- "<relative-path>" 2>/dev/null | head -20
```

For each file, extract:
- `last_changed`: date of most recent commit (`%as` field)
- `change_frequency`: count of commits returned
- `primary_authors`: unique emails sorted by commit count descending
- `rationale_snippets`: using your understanding of the commit messages, extract 1-3 sentences explaining WHY the file changes (the reasoning, not just what changed — "Added X because..." not "Changed line 42")
- `pr_references`: any `#\d+` patterns found in commit messages
- `changelog_entries`: any `CHANGELOG.md` entries mentioning this file (scan only if CHANGELOG.md exists)

### Step 2 — Smell detection (semantic, no CLI needed)

Analyze the nodes and edges from Phase 2 to detect:
- `god_node`: file with >25 outgoing `imports` edges, OR >300 lines and >10 distinct responsibilities in its summary
- `circular_dependency`: any import cycle (A→B→C→A); scan the importMap from Phase 1
- `orphan_node`: node with 0 incoming AND 0 outgoing edges (not an entry point)
- `unclear_coupling`: file that `imports` from >5 different architectural layers
- `over_connected`: total in-degree + out-degree > 30

### Step 3 — Risk scoring

Score only the top 10–20 most important nodes (highly-connected, entry points, or frequently-changed). For each:

```
risk_score = clamp(
  blast_radius_weight × 0.35 +
  coupling_weight × 0.25 +
  test_gap_weight × 0.25 +
  churn_weight × 0.15,
  0.0, 1.0
)
```

- `blast_radius_weight` = min(in_degree / total_node_count × 5, 1.0)
- `coupling_weight` = min((in_degree + out_degree) / 40, 1.0), +0.2 if in a circular dep
- `test_gap_weight` = 0.0 if node has a `tests` incoming edge, else min(0.5 + blast_radius_weight × 0.5, 1.0)
- `churn_weight` = min(change_frequency / 20, 1.0), or 0 if git data unavailable

### Step 4 — Write risk-scores.json

**Include `decision_context` and `structural_warnings` alongside risk scores** — merge.py applies all of these to the nodes:

```bash
cat > "$SPRANG_ROOT/intermediate/risk-scores.json" << 'EOF'
{
  "file:src/types.ts": {
    "risk_score": 0.72,
    "risk_factors": ["large_blast_radius", "frequent_changes", "critical_path"],
    "structural_warnings": [
      {
        "category": "over_connected",
        "severity": "medium",
        "description": "This file is imported by 19 other files — changes ripple widely.",
        "related_node_ids": [],
        "heuristic": "in_degree > 15"
      }
    ],
    "decision_context": {
      "commits": [
        {"sha": "<full sha>", "date": "2026-06-01", "message": "<commit message>", "author": "<email>"}
      ],
      "primary_authors": ["<email>"],
      "last_changed": "2026-06-08",
      "change_frequency": 8,
      "rationale_snippets": ["<why the file changed, extracted from commit messages>"],
      "pr_references": ["#123"],
      "changelog_entries": []
    }
  }
}
EOF
```

Valid `category` values: `god_node`, `circular_dependency`, `orphan_node`, `unclear_coupling`, `duplicate_logic`, `low_cohesion`, `unstable_interface`, `over_connected`
Valid `severity` values: `low`, `medium`, `high`
Valid `risk_factors` values: `high_coupling`, `no_test_coverage`, `frequent_changes`, `large_blast_radius`, `critical_path`, `single_author`, `recent_churn`, `has_structural_warnings`

> ⛔ Do NOT write knowledge-graph.json. Risk data is merged by merge.py in Phase 7.

```bash
echo '{"phase_completed": "risk", "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"}' > "$SPRANG_ROOT/intermediate/phase6-done.json"
```

Report: `[Phase 6/7] Risk scored. High: <N>, Medium: <M>, Low: <L>. Smells: <list>.`

> **DO NOT STOP HERE.** Proceed immediately to Phase 7 — Assemble + Save.

---

## Phase 7 — ASSEMBLE + SAVE

Report: `[Phase 7/7] Assembling final knowledge graph...`

> ⛔ Do NOT write `.sprang/knowledge-graph.json` yourself. Run `merge.py` below.

By now you have written in `$SPRANG_ROOT/intermediate/`:
- `final-nodes-chunk-*.json` — node arrays (from Phase 2)
- `final-edges.json` — all edges (from Phase 2)
- `assembled-graph.json` — project metadata (from Phase 2)
- `final-layers.json` — architecture layers (from Phase 3)
- `final-tours.json` — guided tour as Tour objects (from Phase 4)
- `final-domains.json` — business domains (from Phase 5)
- `risk-scores.json` — risk scores + decision_context (from Phase 6)

**Run the merge script** (Python 3 stdlib only — works on any machine, no install needed):

```bash
# Find merge.py — try two install locations
MERGE_SCRIPT=""
for p in \
  "$PROJECT_ROOT/.windsurf/skills/sprang-analyze/scripts/merge.py" \
  "$PROJECT_ROOT/skills/sprang-analyze/scripts/merge.py"; do
  [[ -f "$p" ]] && MERGE_SCRIPT="$p" && break
done

if [[ -z "$MERGE_SCRIPT" ]]; then
  echo "ERROR: merge.py not found at .windsurf/skills/sprang-analyze/scripts/merge.py" >&2
  echo "Make sure Sprang is installed in this project." >&2
  exit 1
fi

PROJECT_ROOT="$PROJECT_ROOT" python3 "$MERGE_SCRIPT"
```

The script outputs: `OK: <N> nodes, <E> edges, <L> layers, <T> tours` then `Written: <path>`.

**Write `$SPRANG_ROOT/SPRANG_REPORT.md`:**
```markdown
# Sprang Report: <project name>
Generated: <timestamp>

## Summary
- Files analyzed: <N> | Nodes: <M> | Edges: <E>
- Languages: <list>
- Frameworks: <list>
- Health grade: <A-F> (score: <0-100>)

## Architecture Layers
<layer name> — <description> (<N> nodes)
...

## Business Domains
<domain name> — <summary>
  Flows: <list>
...

## Top Risks
| File | Risk Score | Factors |
|------|-----------|---------|
| <path> | <score> | <factors> |

## Code Smells
<smell type>: <count> — <description>

## Guided Tour
1. <step title> — <file>
...

## Next Steps
- Ask questions: /sprang-chat
- Guided tour: /sprang-onboard
- Blast radius before commits: /sprang-diff
- Open dashboard: pnpm --filter @sprang/dashboard dev
```

**Report to user:**
- Total files analyzed, nodes and edges created
- Architecture layers and business domains found
- Top 3 risky nodes with risk scores
- Any critical smells (circular deps, god nodes)
- `Knowledge graph saved to .sprang/knowledge-graph.json`
- Suggest: `/sprang-chat` to ask questions, `/sprang-onboard` for guided tour, `pnpm --filter @sprang/dashboard dev` to open dashboard
