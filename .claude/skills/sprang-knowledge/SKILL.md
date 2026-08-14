---
name: sprang-knowledge
description: Build an interactive knowledge graph from a folder of markdown notes — Obsidian, Logseq, Dendron, Foam, Zettelkasten, or plain markdown. Use when the user says "/sprang-knowledge", "index my notes", "build graph from notes", or "analyze my Obsidian vault".
argument-hint: "[path] [--format obsidian|logseq|dendron|foam|zettelkasten] [--full]"
---

Analyze a folder of markdown notes and produce `.sprang/knowledge-graph.json`
with typed nodes (article/entity/topic/claim/source), wikilink edges, topic
clusters, and a guided reading tour. You are the analysis engine — read every
note and write rich semantic understanding into the graph.

Arguments: `[path] [--format obsidian|logseq|dendron|foam|zettelkasten|plain] [--language <lang>] [--full]`

For the full phase-by-phase procedure — including per-format parsing rules,
node/edge JSON templates, and the assemble script — read `REFERENCE.md` in this
skill's directory. Read it before starting; the summary below is not sufficient
to execute the skill correctly.

## Phases

1. **Pre-flight** — resolve NOTES_ROOT and `SPRANG_ROOT="$NOTES_ROOT/.sprang"`,
   detect the format (Obsidian / Logseq / Dendron / Foam / Zettelkasten / plain),
   read `.sprangignore`, decide incremental vs full.
2. **Scan notes** — find every `.md`/`.mdx`/`.markdown` file; extract title,
   `[[wikilinks]]`, tags, frontmatter, and line count; build the wikilink
   resolution map → write `knowledge-scan.json`.
3. **Analyze notes** — read notes in batches of up to 15 (max ~3000 lines,
   most-linked notes first), classify each as article/entity/topic/claim/source,
   write a 2-3 sentence summary, fill `knowledgeMeta`, and infer edge types from
   context. Max 100 nodes per written file. Resolve backlinks afterwards.
4. **Cluster + layer** — group notes into 3-10 topic clusters by tag density,
   wikilink patterns, and MOC/index notes → write `final-layers.json`.
5. **Guided tour** — build a 5-12 step recommended reading order starting from
   the most-linked note → write `final-tours.json` as an array of Tour objects
   (each with `id`, `title`, `description`, `steps`).
6. **Assemble + save** — write node chunks, edges, layers, tours, and the
   envelope into `.sprang/intermediate/`, then merge them with the Python script
   in `REFERENCE.md`. The final graph must carry `"kind": "knowledge"`. Then
   write `.sprang/SPRANG_REPORT.md`.

## Schema reminders

- Do NOT emit a `layer` field on nodes — cluster membership comes from
  `final-layers.json`. A `layer` of `null` fails validation.
- Note edge types come from the canonical list: `cites`, `builds_on`,
  `contradicts`, `exemplifies`, `categorized_under`, `authored_by`, `related`,
  `similar_to`, `contains`, `documents`. Default to `cites` when a wikilink's
  intent is unclear.
- Never hand-write `.sprang/knowledge-graph.json` inline — always write chunk
  files and merge with the script.

## After completion

Report notes analyzed, nodes and edges created, the top 3 most-connected notes,
and the clusters identified. The dashboard auto-switches to knowledge view mode
with the `KnowledgeInfo` sidebar and `ReadingPanel`. Suggest the `sprang-chat`
skill to ask questions about the notes, and
`pnpm --filter @sprang/dashboard dev` to open the dashboard.

$ARGUMENTS
