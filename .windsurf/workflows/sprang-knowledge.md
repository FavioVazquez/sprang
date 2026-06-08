---
description: Build an interactive knowledge graph from a folder of markdown notes — Obsidian, Logseq, Dendron, Foam, Zettelkasten, or plain markdown
---

# /sprang-knowledge

Analyze a folder of markdown notes and produce a `.sprang/knowledge-graph.json` with typed article/entity/topic/claim/source nodes, wikilink edges, and an interactive dashboard.

Cascade IS the analysis engine — you read every note and write rich semantic understanding into the graph.

## Arguments (`$ARGUMENTS`)
- A directory path containing markdown notes (required, or defaults to cwd)
- `--format <obsidian|logseq|dendron|foam|zettelkasten|plain>` — override format detection
- `--language <lang>` — output language (default: `en`, accepts ISO codes)
- `--full` — force complete rebuild

---

## Phase 0 — Pre-flight

1. **Resolve NOTES_ROOT:**
   - Parse `$ARGUMENTS` for a non-flag token. If found and it's a directory, use it; otherwise use cwd.
   - Verify: `test -d "$NOTES_ROOT"`

2. **Resolve SPRANG_ROOT:**
   ```bash
   SPRANG_ROOT="$NOTES_ROOT/.sprang"
   mkdir -p "$SPRANG_ROOT/intermediate" "$SPRANG_ROOT/tmp"
   ```

3. **Language config** — same as `/sprang-analyze` Phase 0 step 3.

4. **Incremental check:**
   - If `$SPRANG_ROOT/knowledge-graph.json` exists and has `"kind": "knowledge"` and `phase: complete`:
     - If `--full` flag: do full rebuild
     - Otherwise: ask user — rebuild, or nothing?

5. **Detect note format** from `$ARGUMENTS` or auto-detect:
   - **Obsidian**: presence of `.obsidian/` directory, `[[wikilinks]]`, `#tags`
   - **Logseq**: presence of `logseq/` directory, `- [[page]]` bullet structure
   - **Dendron**: presence of `.dendron.yml` or `notes/` dir with `root.md`
   - **Foam**: presence of `.foam/` or `foam.json`
   - **Zettelkasten**: numeric IDs like `202403141200-title.md`
   - **Plain**: fallback — regular markdown with or without frontmatter

Report: `[Phase 0/5] Pre-flight complete. Notes dir: $NOTES_ROOT | Format: <detected>`

---

## Phase 1 — SCAN NOTES

Report: `[Phase 1/5] Scanning markdown files...`

1. **Find all markdown files:**
   ```bash
   find "$NOTES_ROOT" -type f \( -name "*.md" -o -name "*.mdx" -o -name "*.markdown" \) \
     -not -path '*/.git/*' -not -path '*/.sprang/*' -not -path '*/node_modules/*' \
     | sort > "$SPRANG_ROOT/tmp/note-list.txt"
   ```

2. **Check for `.sprangignore`** in `$NOTES_ROOT`:
   - If it exists, read it and filter out matching patterns from note-list.txt
   - Honor glob patterns (e.g., `private/**`, `templates/*`, `*.template.md`)

3. **For each note, extract:**
   - `title`: from frontmatter `title:` field, or first `# Heading`, or filename (strip date prefix for Zettelkasten)
   - `wikilinks`: extract `[[link text]]` and `[[path|alias]]` patterns
   - `tags`: from frontmatter `tags:` array, inline `#tag` markers, or Logseq `:tags` property
   - `frontmatter`: parse YAML between `---` delimiters
   - `sizeLines`: `wc -l`
   - `backlinks`: empty for now — will be resolved in Phase 2

4. **Build wikilink resolution map:**
   - For each wikilink target, find the matching note file (fuzzy match by title/filename)
   - Build: `{ "[[Note Title]]": "path/to/note.md" }`

5. **Write scan result:**
   ```bash
   cat > "$SPRANG_ROOT/intermediate/knowledge-scan.json" << 'EOF'
   {
     "format": "<detected format>",
     "totalNotes": 0,
     "notes": [
       {
         "path": "relative/path/to/note.md",
         "title": "Note Title",
         "wikilinks": ["[[Other Note]]"],
         "tags": ["tag1", "tag2"],
         "frontmatter": {},
         "sizeLines": 45
       }
     ],
     "wikilinkMap": { "[[Other Note]]": "relative/path/to/other.md" }
   }
   EOF
   ```

Report: `Phase 1 complete. Found <N> notes. Format: <fmt>. <M> wikilinks resolved.`

---

## Phase 2 — ANALYZE NOTES

Report: `[Phase 2/5] Analyzing notes — <N> notes in batches of up to 15...`

**Your job:** Read each note and produce semantic graph nodes with rich understanding.

### Batching
- Batch: max 15 notes per batch, max ~3000 lines per batch
- Sort by in-degree (most-linked notes first — they're most important)
- Process up to 4 batches concurrently

### For each note, produce a GraphNode:

Node type mapping:
- Default: `article` — for regular notes, essays, journal entries
- `entity` — for notes that are primarily about a person, tool, organization, or concept
- `topic` — for index notes, MOCs (Maps of Content), tag pages, category notes
- `claim` — for notes that make a specific assertion, insight, or takeaway
- `source` — for notes that are primarily citations, references, or raw source material

```json
{
  "id": "article:<relative-path-without-ext>",
  "type": "article|entity|topic|claim|source",
  "name": "<note title>",
  "label": "<note title>",
  "filePath": "<relative path>",
  "summary": "<2-3 sentences: what this note is about, its main idea, why it matters>",
  "tags": ["<tags from frontmatter + semantic tags you infer>"],
  "complexity": "simple|moderate|complex",
  "languageNotes": "<optional: writing style, format conventions, notable patterns>",
  "knowledgeMeta": {
    "format": "<detected format>",
    "wikilinks": ["<resolved outgoing wikilinks>"],
    "backlinks": [],
    "frontmatter": {},
    "sourceUrl": "<if note has a URL source>",
    "confidence": 1.0
  }
}
```

### Produce edges:

- `cites` — note references another note/source explicitly
- `builds_on` — note extends or deepens ideas from another note
- `contradicts` — note disagrees with or challenges another note
- `exemplifies` — note gives a specific example of an abstract topic/claim
- `categorized_under` — note belongs to a topic/MOC/category
- `authored_by` — note was written by a person (entity node)
- From wikilinks: resolve to the best-fit edge type based on context; default to `cites` if unclear

**Write each batch — use write_to_file per batch, max 100 nodes per file:**
Never output more than 100 nodes in a single tool call. If a batch exceeds 100 notes, split into sub-batches:
```
knowledge-batch-1a.json  { nodes: [...up to 100...], edges: [...] }
knowledge-batch-1b.json  { nodes: [...next 100...], edges: [...] }
```
This prevents Cascade's output token limit from being hit mid-write.

**Resolve backlinks** after all batches: for every `cites`/`builds_on`/etc. edge, add the target node ID to `knowledgeMeta.backlinks` of the target node.

Report after each batch: `Batch <X>/<total>: analyzed <N> notes`
Report when done: `Phase 2 complete. All batches analyzed.`

### Merge batches
Same as `/sprang-analyze` Phase 2 merge — dedup nodes by id, dedup edges by source+target+type, drop dangling edges.
Write to `$SPRANG_ROOT/intermediate/knowledge-assembled.json`.

---

## Phase 3 — CLUSTER + LAYER

Report: `[Phase 3/5] Building topic clusters and layers...`

**Your job:** Group notes into meaningful clusters (like architectural layers for code).

1. Read `knowledge-assembled.json`
2. Identify 3-10 topic clusters by:
   - Existing tags and frontmatter categories
   - Wikilink density (notes that heavily link each other belong in a cluster)
   - Semantic similarity of summaries
   - Explicit MOC/index notes (topic nodes that categorize others)

3. Common cluster patterns:
   - **Core concepts**: foundational ideas that many other notes reference
   - **Projects**: notes tied to a specific project or goal
   - **People**: entity nodes for people/organizations
   - **Sources**: raw references, papers, books, URLs
   - **Reflections**: journal entries, reviews, retrospectives
   - **How-to**: procedural notes, tutorials, recipes

4. Write layers — use the `final-layers.json` filename so merge.py can find it:
   ```bash
   cat > "$SPRANG_ROOT/intermediate/final-layers.json" << 'EOF'
   [
     {
       "id": "cluster:core-concepts",
       "name": "Core Concepts",
       "description": "Foundational ideas that are referenced by many other notes",
       "node_ids": ["article:zettelkasten", "topic:pkm", "entity:roam-research"]
     }
   ]
   EOF
   ```

Report: `Phase 3 complete. <N> clusters identified.`

---

## Phase 4 — GUIDED TOUR

Report: `[Phase 4/5] Building reading tour...`

**Your job:** Create a recommended reading order for someone new to this knowledge base.

1. Read `knowledge-assembled.json` + layers
2. Build a 5-12 step tour:
   - Start from the most central/connected note (highest in-degree)
   - Follow `builds_on` and `categorized_under` edges outward
   - Cover all major clusters
   - Each step explains WHY to read this note and what it connects to

3. Write tour — wrap steps in a Tour object and use `final-tours.json` so merge.py can find it:
   ```bash
   cat > "$SPRANG_ROOT/intermediate/final-tours.json" << 'EOF'
   [
     {
       "id": "knowledge-tour",
       "title": "Recommended Reading Order",
       "description": "A guided path through this knowledge base from foundations to specifics",
       "steps": [
         {
           "step_title": "<note title>",
           "explanation": "<why read this first — what it sets up, what depends on it>",
           "node_ids": ["article:<path>"]
         }
       ]
     }
   ]
   EOF
   ```

   > ⚠️ The tour must be a Tour object array (with `id`, `title`, `description`, `steps`), not a flat step array.

Report: `Phase 4 complete. <N>-step reading tour built.`

---

## Phase 5 — ASSEMBLE + SAVE

Report: `[Phase 5/5] Assembling knowledge graph...`

1. Load `knowledge-assembled.json`, `final-layers.json`, `final-tours.json`
2. Assemble final graph with **`"kind": "knowledge"`**:

```json
{
  "version": "1.0.0",
  "kind": "knowledge",
  "generated_at": "<ISO timestamp>",
  "project_root": "<NOTES_ROOT>",
  "project_name": "<folder name or frontmatter title>",
  "description": "<1-2 sentence description of this knowledge base>",
  "phase": "complete",
  "stats": {
    "node_count": 0,
    "edge_count": 0,
    "risk_summary": {"high": 0, "medium": 0, "low": 0},
    "smell_summary": {},
    "generated_at": "<ISO timestamp>"
  },
  "nodes": [...],
  "edges": [...],
  "layers": [...],
  "tours": [
    {
      "id": "knowledge-tour",
      "title": "Recommended Reading Order",
      "description": "A guided path through this knowledge base from foundations to specifics",
      "steps": [...]
    }
  ],
  "domains": []
}
```

3. Validate:
   - Every `layers[*].node_ids` entry exists in nodes
   - Every `tours[*].steps[*].node_ids` entry exists in nodes
   - No dangling edges
   - All nodes have `summary`, `type`, `id`, `knowledgeMeta`

4. **Safe write — ALWAYS use a script, never emit raw JSON directly.**
   Cascade's output token limit will cause failures for note sets with >200 nodes if you try to write the JSON inline.
   Instead, write node/edge data as intermediate chunk files, then merge with a script:

   **Step 4a — Write nodes in chunks of 100:**
   Write each chunk to `$SPRANG_ROOT/intermediate/final-nodes-chunk-<K>.json` (array of node objects).
   Write edges to `$SPRANG_ROOT/intermediate/final-edges.json`.
   Write layers to `$SPRANG_ROOT/intermediate/final-layers.json`.
   Write tours to `$SPRANG_ROOT/intermediate/final-tours.json`.
   Write the graph envelope (everything except nodes/edges/layers/tours) to `$SPRANG_ROOT/intermediate/final-envelope.json`.

   **Step 4b — Merge with Python (run via run_command):**
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
   out = json.dumps(graph, indent=2, ensure_ascii=False)
   open(os.path.join(root, "knowledge-graph.json"), "w").write(out)
   print(f"OK: {len(nodes)} nodes, {len(edges)} edges, {len(out)} bytes")
   ```
   This bypasses Cascade's output token limit entirely — Python writes the file directly.

5. Write `$SPRANG_ROOT/SPRANG_REPORT.md`:
   ```markdown
   # Knowledge Graph: <project name>
   Generated: <timestamp> | Format: <fmt>

   ## Summary
   - Notes: <N> | Nodes: <M> | Edges: <E>
   - Format: <fmt>

   ## Topic Clusters
   <cluster descriptions>

   ## Most Connected Notes
   <top 5 notes by in-degree>

   ## Reading Tour
   <tour steps>
   ```

6. **Report to user:**
   - Total notes analyzed, nodes and edges created
   - Top 3 most-connected notes
   - Clusters identified
   - `Knowledge graph saved to .sprang/knowledge-graph.json`
   - Suggest: run `/sprang-chat` to ask questions about your notes, open dashboard with `pnpm --filter @sprang/dashboard dev`

---

## Format-specific notes

### Obsidian
- Parse `[[Note Title]]` and `[[Note Title|Alias]]` wikilinks
- Respect `.obsidian/app.json` `attachmentFolderPath` — skip attachments folder
- `#tag` inline markers → tags array
- Daily notes (format `YYYY-MM-DD.md`) → `article` type with tag `daily-note`

### Logseq
- Parse `:tags: [[tag1]] [[tag2]]` property syntax
- Block references `((uuid))` → skip (block-level, not note-level)
- `journals/` folder → `article` nodes tagged `journal`
- `pages/` folder → standard notes

### Dendron
- Parse `.` hierarchy in filenames: `project.auth.login.md` → nested topic
- `id:` frontmatter field → use as node ID suffix
- Vault links `dendron://vault/note` → resolve to local path

### Zettelkasten
- Parse numeric IDs: `202403141200` prefix → use as node ID
- `[[202403141200]]` links → resolve by ID prefix match
- `#permanent-note`, `#literature-note`, `#fleeting-note` → note type hints

### Plain
- No special format assumptions
- Treat `[[link]]` as wikilinks if present, else extract markdown link targets
- Use frontmatter if present
