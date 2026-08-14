# sprang-analyze — full procedure

Produce `.sprang/knowledge-graph.json` for the project with full semantic
enrichment. You are the analysis engine — you read every file and write rich
understanding into the graph.

> **CRITICAL — DO NOT STOP EARLY:** There are 8 phases (Phase 0 through Phase 7).
> Complete ALL of them in a single run. If you stop after Phase 3, the dashboard
> Architecture, Domains, and Learn tabs will be empty. Keep going until you see
> "Knowledge graph saved" at the end of Phase 7.

> **NEVER write `.sprang/knowledge-graph.json` directly.** The only way to
> produce the final graph is the assemble step in Phase 7 (`sprang merge`, or the
> bundled `merge.py`). Writing the graph file yourself produces a broken file the
> dashboard cannot load. All intermediate data goes into
> `$SPRANG_ROOT/intermediate/` as chunk files.

> **RESUME SUPPORT:** If the graph already exists at `phase: complete`, skip
> Phases 1–3 entirely and jump straight to Phase 4 — file analysis is already done.

## Options (from $ARGUMENTS)

- `--full` — force complete rebuild
- `--language <lang>` — output language (default: en). ISO codes (zh, ja, ko, es,
  fr, de, pt, ru) or friendly names
- A directory path — analyze that directory instead of cwd
- `--chunk <N>` — split output into chunks of N nodes for very large projects

---

## Phase 0 — Pre-flight

1. **Resolve PROJECT_ROOT:**
   - Parse `$ARGUMENTS` for a non-flag token. If found and it is a directory, set
     PROJECT_ROOT to it (resolve relative paths). Otherwise use cwd.
   - Verify it exists: `test -d "$PROJECT_ROOT"`

2. **Resolve SPRANG_ROOT** (where graph output goes):
   ```bash
   SPRANG_ROOT="$PROJECT_ROOT/.sprang"
   mkdir -p "$SPRANG_ROOT/intermediate" "$SPRANG_ROOT/tmp" "$SPRANG_ROOT/cache"
   ```

3. **Check for `.sprangignore`** in `$PROJECT_ROOT`:
   - If it exists, honor its glob patterns when building file lists
     (same syntax as `.gitignore`)
   - Always implicitly ignore: `node_modules/`, `.git/`, `dist/`, `build/`,
     `__pycache__/`, `*.min.js`, `*.map`, `*.lock`, `pnpm-lock.yaml`,
     `yarn.lock`, `package-lock.json`, `.sprang/`, `test-results/`,
     `playwright-report/`
   - Patterns worth suggesting if absent: `coverage/`, `*.test.snap`, `generated/`

4. **Language config:**
   - If `--language <lang>` is in `$ARGUMENTS`, normalize to an ISO code and store
     as OUTPUT_LANGUAGE
   - Otherwise check `$SPRANG_ROOT/config.json` for `outputLanguage`; default `en`
   - LANGUAGE_DIRECTIVE: "Generate all textual content (summaries, descriptions,
     tags, titles) in **{language}**. Keep technical terms in English when no
     standard translation exists."

5. **Incremental vs full:**
   - Check if `$SPRANG_ROOT/knowledge-graph.json` exists with `phase: complete`
   - Current git hash: `git -C "$PROJECT_ROOT" rev-parse HEAD 2>/dev/null`
   - If a graph exists, read its `generated_at` and `stats.gitCommitHash`
   - `--full` flag or no existing graph → full analysis
   - Graph exists and commit unchanged → ask the user: rebuild, or nothing?
   - Graph exists and files changed → incremental (only changed files):
     `git -C "$PROJECT_ROOT" diff <lastHash>..HEAD --name-only`

6. **Collect project context:**
   - README.md (first 3000 chars) → README_CONTENT
   - package.json / pyproject.toml / Cargo.toml / go.mod → MANIFEST_CONTENT
   - `find "$PROJECT_ROOT" -maxdepth 2 -type f -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/dist/*' | head -100` → DIR_TREE
   - Entry point (check in order): src/index.ts, src/main.ts, src/App.tsx,
     index.js, main.py, manage.py, app.py, main.go, src/main.rs → ENTRY_POINT

**RESUME CHECK** (run after resolving PROJECT_ROOT):
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
- `PHASE: complete` and no `--full` → ask the user whether to rebuild, or jump to
  Phase 4 for an enrichment-only re-run
- `PHASE: skeleton` → resume from Phase 3 (file analysis done; layers, tour,
  domains, and risk still needed)
- Otherwise → run from Phase 1

Report: `[Phase 0/7] Pre-flight complete. Project: $PROJECT_ROOT | Ignoring: <N .sprangignore patterns>`

---

## Phase 1 — SCAN

Report: `[Phase 1/7] Scanning project files...`

Enumerate all project files, detect languages and frameworks, resolve the import
graph.

1. **File enumeration:**
   ```bash
   # Prefer git-tracked files; fall back to find for non-git dirs
   git -C "$PROJECT_ROOT" ls-files 2>/dev/null | grep -v '^\.git/' > "$SPRANG_ROOT/tmp/file-list-raw.txt" \
     || find "$PROJECT_ROOT" -type f -not -path '*/.git/*' -not -path '*/node_modules/*' -not -path '*/dist/*' -not -path '*/build/*' -not -path '*/__pycache__/*' | sed "s|$PROJECT_ROOT/||" > "$SPRANG_ROOT/tmp/file-list-raw.txt"
   # Apply .sprangignore patterns (and the always-ignore list from Phase 0 step 3)
   # Write the filtered list to file-list.txt
   ```

2. **For each file, determine:**
   - `language`: typescript, javascript, python, go, rust, java, kotlin, csharp,
     ruby, php, cpp, c, markdown, json, yaml, toml, html, css, scss, sql,
     graphql, protobuf, shell, dockerfile, unknown
   - `fileCategory`: code | config | docs | infra | data | script | markup
     - `infra`: Dockerfile*, docker-compose.*, Makefile, Jenkinsfile,
       .github/workflows/*, *.tf, *.k8s.yml
     - `docs`: *.md, *.rst, *.txt (not LICENSE)
     - `config`: *.json, *.yaml, *.yml, *.toml, *.xml, *.env, *.ini, *.cfg,
       *.properties, *.csproj
     - `data`: *.sql, *.graphql, *.gql, *.proto, *.prisma, *.csv
     - `script`: *.sh, *.bash, *.zsh, *.ps1, *.bat
     - `markup`: *.html, *.htm, *.css, *.scss, *.sass, *.less
     - `code`: everything else
   - `sizeLines`: line count (`wc -l`)

3. **Build the import map** — for code files, resolve project-internal imports:
   - TypeScript/JavaScript: `import ... from 'path'` and `require('path')` —
     resolve relative paths, strip extensions, check the target exists
   - Python: `from . import`, `from .module import`, `import module` — resolve
     against project root
   - Go: `import "module/path"` — strip the go.mod module prefix
   - Other: extract what you can with grep patterns for the language
   - ONLY project-internal imports (skip node_modules, stdlib, external packages)

4. **Detect frameworks** from MANIFEST_CONTENT: react, vue, svelte, angular,
   express, fastify, next, nuxt, vite, django, fastapi, flask, rails, spring,
   gin, actix, axum, tailwindcss, prisma, etc.

5. **Write the scan result:**
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
   echo '{"phase_completed": "scan", "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"}' > "$SPRANG_ROOT/intermediate/phase1-done.json"
   ```

Report: `[Phase 1/7] Scan complete. Found <N> files across <langs>. Entry point: <ENTRY_POINT>`

---

## Phase 2 — ANALYZE FILES

Report: `[Phase 2/7] Analyzing files — <N> files in batches of up to 10...`

Read each file and produce semantic graph nodes with rich summaries.

### Batching strategy

- Sort files by estimated importance first (entry points, service files,
  heavily-imported files), then by size descending
- **Semantic batching**: group related files (same directory, same import
  cluster) — shared context improves analysis quality
- Batch: **max 10 files per batch, max ~800 total lines per batch**
- Config/docs/infra files can be batched more aggressively (up to 15 per batch)
- Very large files (>300 lines): analyze alone in their own batch

### For each file, produce a GraphNode

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
  "languageNotes": "<optional: interesting patterns, idioms, or concepts in this file>",
  "location": {"file": "<relative path>"},
  "metadata": {
    "language": "<language>",
    "sizeLines": 0,
    "fileCategory": "code"
  }
}
```

> Do NOT emit a `layer` field on nodes. Layer membership is expressed by
> `final-layers.json` in Phase 3; a `layer` set to `null` fails schema validation.

**Also produce sub-file nodes** for functions and classes (code files >30 lines):
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

### Produce edges

- `imports`: use the pre-resolved importMap from Phase 1
- `contains`: file → function/class nodes within it
- `calls`: function → function across files (when clearly determinable)
- `inherits` / `implements`: class relationships
- `configures`: config → code files it configures
- `documents`: docs → code they describe
- `deploys` / `triggers`: infrastructure relationships
- `tested_by`: source file → the test file that covers it (note the direction:
  source → test)

Canonical edge types (use only these): `imports`, `exports`, `contains`,
`inherits`, `implements`, `calls`, `subscribes`, `publishes`, `middleware`,
`reads_from`, `writes_to`, `transforms`, `validates`, `depends_on`, `tested_by`,
`configures`, `related`, `similar_to`, `deploys`, `serves`, `provisions`,
`triggers`, `migrates`, `documents`, `routes`, `defines_schema`, `contains_flow`,
`flow_step`, `cross_domain`, `cites`, `contradicts`, `builds_on`, `exemplifies`,
`categorized_under`, `authored_by`.

### Complexity criteria

- `simple`: <50 lines, 1-3 functions, no nested conditionals, pure utility
- `moderate`: 50-200 lines, clear structure, some business logic
- `complex`: >200 lines, multiple responsibilities, nested logic, many dependencies

### Write each batch to a file — max 50 nodes per file

Use these exact filenames; the assemble step reads them by name:
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

**NEVER write raw JSON inline for more than 5 nodes.** Always write to a file.
**NEVER write `.sprang/knowledge-graph.json` yourself at any point.**

Report after each batch: `Batch <X>/<total>: analyzed <files> (files: foo.ts, bar.ts, ...)`

### After all batches — write the metadata file

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

> **DO NOT STOP HERE.** Proceed immediately to Phase 3.

---

## Phase 3 — ARCHITECTURE LAYERS

Report: `[Phase 3/7] Identifying architectural layers...`

Assign every file node to exactly one architectural layer.

1. Read `assembled-graph.json` plus the node chunks and import edges
2. Analyze directory structure and import patterns to identify 3-10 logical layers
3. Common layer patterns (adapt to the actual project):
   - **Presentation/UI**: components, views, pages, templates, CSS
   - **API/Routes**: HTTP handlers, controllers, routers, endpoints
   - **Business Logic/Services**: domain logic, use cases, service classes
   - **Data/Repository**: DB models, ORMs, data access, migrations, schemas
   - **Infrastructure**: Docker, CI/CD, deployment, Terraform, Kubernetes
   - **Configuration**: config files, env, settings, build tooling
   - **Documentation**: READMEs, guides, specs
   - **Tests**: test files, fixtures, mocks
   - **Utilities**: shared helpers, types, constants
4. Every file-level node must appear in exactly one layer
5. **Write directly to `final-layers.json`** (not `layers.json`):
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

> **DO NOT STOP HERE.** Proceed immediately to Phase 4.

---

## Phase 4 — GUIDED TOUR

Report: `[Phase 4/7] Building guided learning tour...`

Create a BFS-ordered walkthrough of the codebase for someone new.

1. Read `assembled-graph.json`, `final-layers.json`, README_CONTENT, ENTRY_POINT
2. Build a 5-8 step tour:
   - Start from ENTRY_POINT or README
   - Follow the dependency graph (imports/calls) outward
   - Cover all architectural layers
   - Each step explains WHY this file matters, not just what it does
   - Align the narrative with what the README says the project is
3. **Write directly to `final-tours.json`**, wrapped in Tour objects:
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

   > The tour array **must** contain Tour objects with `id`, `title`,
   > `description`, and a `steps` array. A flat array of steps is not recognized
   > by the dashboard.

Report: `[Phase 4/7] Tour complete. <N> steps.`

> **DO NOT STOP HERE.** Proceed immediately to Phase 5.

---

## Phase 5 — DOMAIN MAPPING

Report: `[Phase 5/7] Mapping code to business domains...`

Cluster nodes into business-meaningful domains, flows, and steps that explain
what the codebase *does* in product terms.

A domain is a business capability ("Authentication", "Payments"). A flow is a
user-facing process within it ("Login Flow"). A step is a group of files
implementing one part of that flow.

1. Read `assembled-graph.json`, `final-layers.json`, README_CONTENT
2. Identify 2-6 business domains: "What does this product *do* for users?"
3. For each domain, identify 1-4 flows (key user journeys or operational processes)
4. For each flow, identify 2-5 steps, each referencing node IDs
5. **Write `final-domains.json`:**
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
   - `weight` between 0.0 and 1.0 (importance of the step within the flow)
   - `id` values unique across all domains, flows, and steps
   - Prefer file-level node IDs (`file:path/to/file.ts`), not function-level

Report: `[Phase 5/7] Domains complete. <N> domains, <M> flows.`

> **DO NOT STOP HERE.** Proceed immediately to Phase 6.

---

## Phase 6 — RISK + SMELLS + GIT LAYER

Report: `[Phase 6/7] Scoring risk and detecting structural issues...`

### Step 1 — Git layer (top 10–20 most-imported files)

```bash
git -C "$PROJECT_ROOT" log --follow --since="90 days ago" --format="%H|%ae|%as|%s" -- "<relative-path>" 2>/dev/null | head -20
```

For each file extract:
- `last_changed`: date of the most recent commit (`%as`)
- `change_frequency`: count of commits returned
- `primary_authors`: unique emails sorted by commit count descending
- `rationale_snippets`: 1-3 sentences explaining WHY the file changes (the
  reasoning, not just what changed)
- `pr_references`: any `#\d+` patterns in commit messages
- `changelog_entries`: CHANGELOG.md entries mentioning this file (only if it exists)

### Step 2 — Smell detection (semantic, no CLI needed)

- `god_node`: >25 outgoing `imports` edges, OR >300 lines and >10 distinct
  responsibilities in its summary
- `circular_dependency`: any import cycle (A→B→C→A); scan the Phase 1 importMap
- `orphan_node`: 0 incoming AND 0 outgoing edges (and not an entry point)
- `unclear_coupling`: imports from >5 different architectural layers
- `over_connected`: in-degree + out-degree > 30

### Step 3 — Risk scoring

Score only the top 10–20 most important nodes (highly-connected, entry points,
or frequently-changed):

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
- `test_gap_weight` = 0.0 if the node has an outgoing `tested_by` edge, else
  min(0.5 + blast_radius_weight × 0.5, 1.0)
- `churn_weight` = min(change_frequency / 20, 1.0), or 0 if git data is unavailable

### Step 4 — Write risk-scores.json

Include `decision_context` and `structural_warnings` alongside risk scores — the
assemble step applies all of these to the nodes:

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

Valid `category` values (10): `god_node`, `circular_dependency`, `orphan_node`,
`unclear_coupling`, `duplicate_logic`, `low_cohesion`, `unstable_interface`,
`over_connected`, `name_duplicate`, `layer_violation`
Valid `severity` values: `low`, `medium`, `high`
Valid `risk_factors` values (8): `high_coupling`, `no_test_coverage`,
`frequent_changes`, `large_blast_radius`, `critical_path`, `single_author`,
`recent_churn`, `has_structural_warnings`

> **Stick to these exact values.** The assemble step normalises the graph against
> the canonical schema: `structural_warnings` with an off-list `category` (or
> written as bare strings) and `risk_factors` outside the list above are
> **dropped** so the graph still validates. Domain `label`/`flows`/`steps` and
> tour `step_title`/`explanation` are likewise normalised — matching the
> templates above keeps your richer wording.

```bash
echo '{"phase_completed": "risk", "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"}' > "$SPRANG_ROOT/intermediate/phase6-done.json"
```

Report: `[Phase 6/7] Risk scored. High: <N>, Medium: <M>, Low: <L>. Smells: <list>.`

> **DO NOT STOP HERE.** Proceed immediately to Phase 7.

---

## Phase 7 — ASSEMBLE + SAVE

Report: `[Phase 7/7] Assembling final knowledge graph...`

By now `$SPRANG_ROOT/intermediate/` contains:
- `final-nodes-chunk-*.json` — node arrays (Phase 2)
- `final-edges.json` — all edges (Phase 2)
- `assembled-graph.json` — project metadata (Phase 2)
- `final-layers.json` — architecture layers (Phase 3)
- `final-tours.json` — guided tour as Tour objects (Phase 4)
- `final-domains.json` — business domains (Phase 5)
- `risk-scores.json` — risk scores + decision_context (Phase 6)

**Assemble the graph.** Both paths normalise the assembled data against the
canonical schema and validate it before writing, so the result always loads in
the MCP server and dashboard. Prefer the CLI — it ships with the package, needs
no Python, and behaves identically on every platform:

```bash
# Preferred: the Sprang CLI (normalises + validates)
if command -v sprang >/dev/null 2>&1; then
  sprang merge "$PROJECT_ROOT"
else
  # Fallback: the bundled Python script (stdlib only)
  MERGE_SCRIPT="$PROJECT_ROOT/skills/sprang-analyze/scripts/merge.py"
  if [[ ! -f "$MERGE_SCRIPT" ]]; then
    echo "ERROR: neither the 'sprang' CLI nor merge.py was found." >&2
    echo "Install the CLI (npm i -g @faviovazquez/sprang) or copy skills/ into the project." >&2
    exit 1
  fi
  PROJECT_ROOT="$PROJECT_ROOT" python3 "$MERGE_SCRIPT"
fi
```

Both report something like
`Graph written: <N> nodes, <E> edges, <L> layers, <T> tours, <D> domains`.
`sprang merge` and `merge.py` apply identical normalisation
(`@sprang/core`'s `normalizeAssembledGraph` and its Python twin).

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

## Business Domains
<domain name> — <summary>
  Flows: <list>

## Top Risks
| File | Risk Score | Factors |
|------|-----------|---------|
| <path> | <score> | <factors> |

## Code Smells
<smell type>: <count> — <description>

## Guided Tour
1. <step title> — <file>

## Next Steps
- Ask questions: the sprang-chat skill
- Guided tour: the sprang-onboard skill
- Blast radius before commits: the sprang-diff skill
- Open dashboard: pnpm --filter @sprang/dashboard dev
```

**Report to the user:**
- Total files analyzed, nodes and edges created
- Architecture layers and business domains found
- Top 3 risky nodes with risk scores
- Any critical smells (circular deps, god nodes)
- `Knowledge graph saved to .sprang/knowledge-graph.json`
- Suggest: `sprang-chat` to ask questions, `sprang-onboard` for the guided tour,
  `pnpm --filter @sprang/dashboard dev` to open the dashboard
