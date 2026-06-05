---
description: Analyze a codebase to produce a rich semantic knowledge graph — file summaries, architecture layers, guided tour, domain map, risk scores. Better than /understand.
---

# /sprang-analyze

Produce a `.sprang/knowledge-graph.json` for the project with full semantic enrichment.
Cascade IS the analysis engine — you read every file and write rich understanding into the graph.

> **CRITICAL — DO NOT STOP EARLY:** This workflow has 6 phases. You MUST complete ALL phases in a single run. If you stop after Phase 2, the dashboard Architecture tab and Learn tab will be empty. Keep going until you see "Knowledge graph saved" at the end of Phase 6.

> **RESUME SUPPORT:** If the graph already exists at `phase: enriched`, skip Phases 0–2 entirely and jump straight to Phase 3 — all file analysis is already done.

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
   - Always implicitly ignore: `node_modules/`, `.git/`, `dist/`, `build/`, `__pycache__/`, `*.min.js`, `*.map`, `*.lock`, `pnpm-lock.yaml`, `yarn.lock`, `package-lock.json`, `.sprang/`
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
- If output contains `PHASE: enriched` → **skip to Phase 3 immediately** — load nodes from the existing `knowledge-graph.json`, do NOT redo Phase 1 or 2
- If output contains `PHASE: complete` and no `--full` → ask user if they want to rebuild
- Otherwise → run from Phase 1

Report: `[Phase 0/6] Pre-flight complete. Project: $PROJECT_ROOT | Ignoring: <N .sprangignore patterns>`

---

## Phase 1 — SCAN

Report: `[Phase 1/6] Scanning project files...`

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

Report: `Phase 1 complete. Found <N> files across <langs>. Entry point: <ENTRY_POINT>`

---

## Phase 2 — ANALYZE FILES

Report: `[Phase 2/6] Analyzing files — <N> files in batches of up to 10...`

**Your job:** Read each file and produce semantic graph nodes with rich summaries.

### Batching strategy
- Sort files: first by estimated importance (entry points, service files, heavily-imported files first), then by size descending
- **Semantic batching**: group related files together (same directory, same import cluster) — they share context which improves analysis quality
- Batch: **max 10 files per batch, max ~800 total lines per batch** — keep batches small to avoid context overflow
- Config/docs/infra files can be batched more aggressively (up to 15 per batch)
- Very large files (>300 lines): analyze alone in their own batch
- Run **at most 3 batches concurrently** — more parallelism increases peak context usage

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

**Write each batch — ALWAYS use write_to_file per batch, max 50 nodes per file:**
Never output more than 50 nodes in a single tool call. Split every batch result into sub-files:
```
batch-1a.json  { nodes: [...up to 50...], edges: [...] }
batch-1b.json  { nodes: [...next 50...], edges: [...] }
```
This is mandatory — not conditional on project size. Prevents output token limit failures.

**NEVER write raw JSON node arrays inline for more than 20 nodes.** Always write to a file via write_to_file or a shell heredoc command. If you feel tempted to output a large JSON blob, stop and write it to an intermediate file instead.

**Output chunking — always use chunk files for intermediate data:**
Regardless of project size, always write intermediate nodes as chunk files:
```bash
cat > "$SPRANG_ROOT/intermediate/nodes-chunk-<K>.json" << 'EOF'
[...up to 50 nodes...]
EOF
```
This prevents context overflow in all environments including Devin Desktop.

Report after each batch: `Batch <X>/<total>: analyzed <files> (files: foo.ts, bar.ts, ...)`
Report when done: `Phase 2 complete. All <N> batches analyzed.`

> **DO NOT STOP HERE.** Proceed immediately to Phase 3 — Architecture Layers.

### Merge batches
After all batches complete:
1. Read all `batch-*.json` files from `$SPRANG_ROOT/intermediate/`
2. Merge all nodes (dedup by id, last occurrence wins)
3. Merge all edges (dedup by source+target+type)
4. Drop edges whose source or target doesn't exist in the node set
5. Write to `$SPRANG_ROOT/intermediate/assembled-graph.json`

---

## Phase 3 — ARCHITECTURE LAYERS

Report: `[Phase 3/6] Identifying architectural layers...`

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
5. Write layers:
   ```bash
   cat > "$SPRANG_ROOT/intermediate/layers.json" << 'EOF'
   [
     {
       "id": "layer:api",
       "name": "API Layer",
       "description": "HTTP route handlers and request/response logic",
       "node_ids": ["file:src/routes/index.ts", "file:src/controllers/auth.ts"]
     }
   ]
   EOF
   ```

Update each node in assembled-graph.json with its `layer` id.

Write phase marker:
```bash
echo '{"phase_completed": "layers", "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"}' > "$SPRANG_ROOT/intermediate/phase3-done.json"
```

Report: `Phase 3 complete. <N> layers identified, <M> nodes assigned.`

> **DO NOT STOP HERE.** Proceed immediately to Phase 4 — Guided Tour.

---

## Phase 4 — GUIDED TOUR

Report: `[Phase 4/6] Building guided learning tour...`

**Your job:** Create a BFS-ordered walkthrough of the codebase for someone new.

1. Read assembled-graph.json + layers + README_CONTENT + ENTRY_POINT
2. Build a 5-15 step tour that teaches the codebase in the right order:
   - Start from ENTRY_POINT or README
   - Follow the dependency graph (imports/calls) outward
   - Cover all architectural layers
   - Each step explains WHY this file matters, not just what it does
   - Align the narrative with what the README says the project is

3. Write tour:
   ```bash
   cat > "$SPRANG_ROOT/intermediate/tour.json" << 'EOF'
   [
     {
       "id": "tour-step-1",
       "step_title": "Project Entry Point",
       "explanation": "This is where everything starts. <explain what main.ts does and why it matters>",
       "highlight": true,
       "node_ids": ["file:src/main.ts"]
     }
   ]
   EOF
   ```

Write phase marker:
```bash
echo '{"phase_completed": "tour", "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"}' > "$SPRANG_ROOT/intermediate/phase4-done.json"
```

Report: `Phase 4 complete. <N>-step tour built.`

> **DO NOT STOP HERE.** Proceed immediately to Phase 5 — Risk + Smells.

---

## Phase 5 — RISK + SMELLS + GIT LAYER

Report: `[Phase 5/6] Scoring risk and detecting structural issues...`

**Your job (semantic):** Use your understanding from Phase 2 to assess risk.

1. **Run git layer** (deterministic):
   ```bash
   # For each file node, get git history
   git -C "$PROJECT_ROOT" log --follow --format="%H|%ae|%as|%s" -- "<path>" 2>/dev/null | head -20
   ```
   For each file: record last_changed, change_frequency (commit count in last 90 days), primary_authors

2. **Run static smell detection** (via sprang CLI if available, else do it yourself):
   ```bash
   node "$PROJECT_ROOT/node_modules/.bin/sprang" health "$PROJECT_ROOT" 2>/dev/null \
     || echo '{"smells": []}'
   ```

3. **Score risk for each node** based on:
   - `high_coupling`: in-degree + out-degree > 15
   - `no_test_coverage`: no `tested_by` edge and not a test file
   - `frequent_changes`: >10 commits in last 90 days
   - `large_blast_radius`: many nodes depend on this (high in-degree)
   - `critical_path`: on the path from entry point to many other nodes
   - `single_author`: only one author in git history
   - `recent_churn`: >3 commits in last 14 days
   - `has_structural_warnings`: smell detector flagged it

   risk_score = weighted sum of factors, normalized 0-1

4. **Detect structural smells** (use your semantic understanding):
   - `god_node`: file with >25 outgoing edges or >300 lines and >10 responsibilities
   - `circular_dependency`: detect import cycles (A→B→C→A)
   - `orphan_node`: file with 0 edges (not imported by anything, imports nothing)
   - `unclear_coupling`: file that imports from >5 different layers
   - `duplicate_logic`: two files with very similar summaries/tags

5. Write risk data back into each node in assembled-graph.json

Write phase marker:
```bash
echo '{"phase_completed": "risk", "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"}' > "$SPRANG_ROOT/intermediate/phase5-done.json"
```

Report: `Phase 5 complete. Risk scored. High: <N>, Medium: <M>, Low: <L>.`

> **DO NOT STOP HERE.** Proceed immediately to Phase 6 — Assemble + Save.

---

## Phase 6 — ASSEMBLE + SAVE

Report: `[Phase 6/6] Assembling final knowledge graph...`

1. Load `assembled-graph.json` with all enrichments from Phases 3-5
2. Load `layers.json` and `tours.json` (note: key is `tours`, not `tour`)
3. Assemble final graph:

```json
{
  "version": "1.0.0",
  "kind": "codebase",
  "generated_at": "<ISO timestamp>",
  "project_root": "<PROJECT_ROOT>",
  "project_name": "<name>",
  "description": "<description>",
  "languages": ["<languages>"],
  "frameworks": ["<frameworks>"],
  "phase": "complete",
  "stats": {
    "gitCommitHash": "<current commit hash>",
    "node_count": 0,
    "edge_count": 0,
    "risk_summary": {"high": 0, "medium": 0, "low": 0},
    "smell_summary": {},
    "generated_at": "<ISO timestamp>",
    "phase2_completed_at": "<ISO timestamp>"
  },
  "nodes": [...],
  "edges": [...],
  "layers": [...],
  "tours": [
    {
      "id": "architecture-tour",
      "title": "Architecture Tour",
      "description": "Guided walkthrough from entry point through all layers",
      "steps": [...]
    }
  ],
  "domains": [],
  "annotations": []
}
```

4. Validate:
   - Every `layers[*].node_ids` entry exists in nodes
   - Every `tours[*].steps[*].node_ids` entry exists in nodes
   - No dangling edges
   - All nodes have summary, type, id

5. **Safe write — ALWAYS use a script, NEVER emit raw JSON directly. This is mandatory for ALL project sizes.**
   Even small projects (>50 nodes) will cause failures if you write JSON inline.
   Always write node/edge data as intermediate chunk files, then merge with a script:

   **Step 5a — Write nodes in chunks of 50 (hard limit):**
   Write each chunk to `$SPRANG_ROOT/intermediate/final-nodes-chunk-<K>.json` (array of node objects).
   Write edges to `$SPRANG_ROOT/intermediate/final-edges.json`.
   Write layers to `$SPRANG_ROOT/intermediate/final-layers.json`.
   Write tours to `$SPRANG_ROOT/intermediate/final-tours.json` (array of tour objects — key in final graph must be `tours`, not `tour`).
   Write the graph envelope (everything except nodes/edges) to `$SPRANG_ROOT/intermediate/final-envelope.json`.

   **If you have fewer than 50 nodes total:** still use this pattern. Never skip it.

   **Step 5b — Merge with Python (run via run_command):**
   ```python
   import json, glob, os
   root = "$SPRANG_ROOT"
   inter = os.path.join(root, "intermediate")
   env = json.load(open(os.path.join(inter, "final-envelope.json")))
   nodes = []
   for f in sorted(glob.glob(os.path.join(inter, "final-nodes-chunk-*.json"))):
       nodes.extend(json.load(open(f)))
   edges = json.load(open(os.path.join(inter, "final-edges.json")))
   layers = json.load(open(os.path.join(inter, "final-layers.json")))
   tours = json.load(open(os.path.join(inter, "final-tours.json")))
   graph = {**env, "nodes": nodes, "edges": edges, "layers": layers, "tours": tours}
   graph["stats"]["node_count"] = len(nodes)
   graph["stats"]["edge_count"] = len(edges)
   # Validate required top-level fields before writing
   required = ["version", "kind", "generated_at", "project_root", "project_name", "phase", "stats"]
   missing = [k for k in required if not graph.get(k)]
   if missing:
       raise ValueError(f"Envelope missing required fields: {missing}")
   # Validate stats sub-fields
   stats_required = ["node_count", "edge_count", "risk_summary", "smell_summary", "generated_at"]
   stats_missing = [k for k in stats_required if k not in graph["stats"]]
   if stats_missing:
       raise ValueError(f"stats missing required fields: {stats_missing}")
   out = json.dumps(graph, indent=2, ensure_ascii=False)
   open(os.path.join(root, "knowledge-graph.json"), "w").write(out)
   print(f"OK: {len(nodes)} nodes, {len(edges)} edges, {len(out)} bytes")
   ```
   This bypasses Cascade's output token limit entirely — Python writes the file directly.

   **IMPORTANT — the envelope file (`final-envelope.json`) MUST contain ALL of these fields or the dashboard will not load the graph:**
   ```json
   {
     "version": "0.2.0",
     "kind": "codebase",
     "generated_at": "<ISO timestamp>",
     "project_root": "<absolute path to PROJECT_ROOT>",
     "project_name": "<directory name of project>",
     "description": "<one-line description>",
     "languages": ["python", "typescript"],
     "frameworks": ["fastapi", "react"],
     "phase": "complete",
     "stats": {
       "node_count": 0,
       "edge_count": 0,
       "risk_summary": {"high": 0, "medium": 0, "low": 0},
       "smell_summary": {},
       "generated_at": "<ISO timestamp>",
       "gitCommitHash": "<git rev-parse HEAD output>"
     }
   }
   ```
   Note: `node_count` and `edge_count` in stats are updated automatically by the merge script above.

6. Write `$SPRANG_ROOT/SPRANG_REPORT.md`:
   ```markdown
   # Sprang Report: <project name>
   Generated: <timestamp>

   ## Summary
   - Files: <N> | Nodes: <M> | Edges: <E>
   - Languages: <list>
   - Frameworks: <list>

   ## Architecture
   <layer descriptions>

   ## Top Risks
   <top 5 risky nodes with reasons>

   ## Code Smells
   <smell summary>

   ## Guided Tour
   <tour steps>
   ```

7. **Report to user:**
   - Total files analyzed, nodes and edges created
   - Architecture layers found
   - Top 3 risky nodes
   - Any critical smells
   - `Knowledge graph saved to .sprang/knowledge-graph.json`
   - Suggest: run `/sprang-chat` to ask questions, `/sprang-onboard` for a guided tour, open the dashboard with `pnpm --filter @sprang/dashboard dev`
