# sprang-knowledge — full procedure

Analyze a folder of markdown notes and produce `.sprang/knowledge-graph.json`
with typed article/entity/topic/claim/source nodes, wikilink edges, topic
clusters, and a reading tour. You are the analysis engine — read every note and
write rich semantic understanding into the graph.

## Arguments (`$ARGUMENTS`)

- A directory path containing markdown notes (defaults to cwd)
- `--format <obsidian|logseq|dendron|foam|zettelkasten|plain>` — override format detection
- `--language <lang>` — output language (default `en`, accepts ISO codes)
- `--full` — force complete rebuild

---

## Phase 0 — Pre-flight

1. **Resolve NOTES_ROOT:** parse `$ARGUMENTS` for a non-flag token; if it is a
   directory use it, otherwise use cwd. Verify: `test -d "$NOTES_ROOT"`.

2. **Resolve SPRANG_ROOT:**
   ```bash
   SPRANG_ROOT="$NOTES_ROOT/.sprang"
   mkdir -p "$SPRANG_ROOT/intermediate" "$SPRANG_ROOT/tmp"
   ```

3. **Language config** — same as the `sprang-analyze` skill: if
   `--language <lang>` is given, normalize to an ISO code; otherwise check
   `$SPRANG_ROOT/config.json` for `outputLanguage`; default `en`. Generate all
   textual content in that language, keeping technical terms in English when no
   standard translation exists.

4. **Incremental check:** if `$SPRANG_ROOT/knowledge-graph.json` exists with
   `"kind": "knowledge"` and `phase: complete`:
   - `--full` → full rebuild
   - otherwise → ask the user: rebuild, or nothing?

5. **Detect note format** from `$ARGUMENTS` or auto-detect:
   - **Obsidian**: `.obsidian/` directory, `[[wikilinks]]`, `#tags`
   - **Logseq**: `logseq/` directory, `- [[page]]` bullet structure
   - **Dendron**: `.dendron.yml`, or a `notes/` dir with `root.md`
   - **Foam**: `.foam/` or `foam.json`
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

2. **Check `.sprangignore`** in `$NOTES_ROOT` — filter matching patterns out of
   `note-list.txt`. Honor globs (`private/**`, `templates/*`, `*.template.md`).

3. **For each note, extract:**
   - `title`: frontmatter `title:`, or the first `# Heading`, or the filename
     (strip the date prefix for Zettelkasten)
   - `wikilinks`: `[[link text]]` and `[[path|alias]]` patterns
   - `tags`: frontmatter `tags:` array, inline `#tag` markers, Logseq `:tags:`
   - `frontmatter`: parsed YAML between `---` delimiters
   - `sizeLines`: `wc -l`
   - `backlinks`: empty for now — resolved in Phase 2

4. **Build the wikilink resolution map** — for each wikilink target, find the
   matching note file (fuzzy match by title/filename):
   `{ "[[Note Title]]": "path/to/note.md" }`

5. **Write the scan result:**
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

### Batching

- Max 15 notes per batch, max ~3000 lines per batch
- Sort by in-degree (most-linked notes first — they matter most)
- Process up to 4 batches concurrently

### Node type mapping

- `article` (default) — regular notes, essays, journal entries
- `entity` — notes primarily about a person, tool, organization, or concept
- `topic` — index notes, MOCs (Maps of Content), tag pages, category notes
- `claim` — notes making a specific assertion, insight, or takeaway
- `source` — notes that are citations, references, or raw source material

### For each note, produce a GraphNode

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
    "sourceUrl": "<if the note has a URL source>",
    "confidence": 1.0
  }
}
```

> Do NOT emit a `layer` field on nodes. Cluster membership is expressed by
> `final-layers.json` in Phase 3; a `layer` of `null` fails schema validation.

### Produce edges

- `cites` — the note references another note/source explicitly
- `builds_on` — the note extends or deepens ideas from another note
- `contradicts` — the note disagrees with or challenges another note
- `exemplifies` — the note gives a concrete example of an abstract topic/claim
- `categorized_under` — the note belongs to a topic/MOC/category
- `authored_by` — the note was written by a person (entity node)
- `related` / `similar_to` — loose association between notes
- From wikilinks: resolve to the best-fit edge type from the canonical list based
  on context; default to `cites` if unclear

Canonical edge types (use only these): `imports`, `exports`, `contains`,
`inherits`, `implements`, `calls`, `subscribes`, `publishes`, `middleware`,
`reads_from`, `writes_to`, `transforms`, `validates`, `depends_on`, `tested_by`,
`configures`, `related`, `similar_to`, `deploys`, `serves`, `provisions`,
`triggers`, `migrates`, `documents`, `routes`, `defines_schema`, `contains_flow`,
`flow_step`, `cross_domain`, `cites`, `contradicts`, `builds_on`, `exemplifies`,
`categorized_under`, `authored_by`.

### Write each batch to a file — max 100 nodes per file

Never output more than 100 nodes in a single tool call. If a batch exceeds 100
notes, split into sub-batches:
```
knowledge-batch-1a.json  { nodes: [...up to 100...], edges: [...] }
knowledge-batch-1b.json  { nodes: [...next 100...], edges: [...] }
```
This keeps each write inside the output token limit.

**Resolve backlinks** after all batches: for every `cites`/`builds_on`/etc. edge,
add the source node ID to `knowledgeMeta.backlinks` of the target node.

Report after each batch: `Batch <X>/<total>: analyzed <N> notes`

### Merge batches

Dedup nodes by `id`, dedup edges by `source`+`target`+`type`, drop dangling
edges. Write to `$SPRANG_ROOT/intermediate/knowledge-assembled.json`.

Report: `Phase 2 complete. All batches analyzed.`

---

## Phase 3 — CLUSTER + LAYER

Report: `[Phase 3/5] Building topic clusters and layers...`

Group notes into meaningful clusters (the knowledge-graph equivalent of
architectural layers).

1. Read `knowledge-assembled.json`
2. Identify 3-10 topic clusters using:
   - Existing tags and frontmatter categories
   - Wikilink density (notes that heavily link each other belong together)
   - Semantic similarity of summaries
   - Explicit MOC/index notes (topic nodes that categorize others)
3. Common cluster patterns:
   - **Core concepts** — foundational ideas many notes reference
   - **Projects** — notes tied to a specific project or goal
   - **People** — entity nodes for people and organizations
   - **Sources** — raw references, papers, books, URLs
   - **Reflections** — journal entries, reviews, retrospectives
   - **How-to** — procedural notes, tutorials, recipes
4. Write clusters to `final-layers.json` (the assemble step reads this filename):
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

Create a recommended reading order for someone new to this knowledge base.

1. Read `knowledge-assembled.json` and `final-layers.json`
2. Build a 5-12 step tour:
   - Start from the most central note (highest in-degree)
   - Follow `builds_on` and `categorized_under` edges outward
   - Cover all major clusters
   - Each step explains WHY to read this note and what it connects to
3. Write the tour to `final-tours.json`, wrapped in a Tour object:
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

   > The tour must be an array of Tour objects (with `id`, `title`,
   > `description`, `steps`), not a flat step array.

Report: `Phase 4 complete. <N>-step reading tour built.`

---

## Phase 5 — ASSEMBLE + SAVE

Report: `[Phase 5/5] Assembling knowledge graph...`

The final graph must carry **`"kind": "knowledge"`**:

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
  "tours": [...],
  "domains": []
}
```

Validate before assembling:
- Every `layers[*].node_ids` entry exists in nodes
- Every `tours[*].steps[*].node_ids` entry exists in nodes
- No dangling edges
- Every node has `summary`, `type`, `id`, `knowledgeMeta`

**Never emit the final JSON inline** — output token limits cause failures for
note sets with more than ~200 nodes. Write intermediate chunk files into
`$SPRANG_ROOT/intermediate/`, then merge them with a script:

**Step A — write the chunks:**
- `final-nodes-chunk-<K>.json` — node arrays, 100 nodes per chunk
- `final-edges.json` — all edges
- `final-layers.json` — clusters (Phase 3)
- `final-tours.json` — reading tour (Phase 4)
- `final-envelope.json` — everything except nodes/edges/layers/tours (the
  envelope above, including `"kind": "knowledge"`)

**Step B — merge with Python:**
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
Python writes the file directly, bypassing the output token limit entirely.

> Do not use `sprang merge` / `skills/sprang-analyze/scripts/merge.py` here —
> those emit `"kind": "codebase"` and are for the `sprang-analyze` skill only.

**Write `$SPRANG_ROOT/SPRANG_REPORT.md`:**
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

**Report to the user:**
- Total notes analyzed, nodes and edges created
- Top 3 most-connected notes
- Clusters identified
- `Knowledge graph saved to .sprang/knowledge-graph.json`
- Suggest the `sprang-chat` skill to ask questions about the notes, and
  `pnpm --filter @sprang/dashboard dev` to open the dashboard

---

## Format-specific notes

### Obsidian
- Parse `[[Note Title]]` and `[[Note Title|Alias]]` wikilinks
- Respect `.obsidian/app.json` `attachmentFolderPath` — skip the attachments folder
- `#tag` inline markers → tags array
- Daily notes (`YYYY-MM-DD.md`) → `article` type with tag `daily-note`

### Logseq
- Parse `:tags: [[tag1]] [[tag2]]` property syntax
- Block references `((uuid))` → skip (block-level, not note-level)
- `journals/` folder → `article` nodes tagged `journal`
- `pages/` folder → standard notes

### Dendron
- Parse the `.` hierarchy in filenames: `project.auth.login.md` → nested topic
- `id:` frontmatter field → use as the node ID suffix
- Vault links `dendron://vault/note` → resolve to a local path

### Zettelkasten
- Parse numeric IDs: `202403141200` prefix → use as the node ID
- `[[202403141200]]` links → resolve by ID prefix match
- `#permanent-note`, `#literature-note`, `#fleeting-note` → note type hints

### Plain
- No special format assumptions
- Treat `[[link]]` as wikilinks if present, else extract markdown link targets
- Use frontmatter if present
