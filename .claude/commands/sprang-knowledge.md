Build an interactive knowledge graph from a folder of markdown notes — Obsidian, Logseq, Dendron, Foam, Zettelkasten, or plain markdown.

Arguments: `[path] [--format obsidian|logseq|dendron|foam|zettelkasten|plain] [--language <lang>] [--full]`

Analyze markdown notes and produce `.sprang/knowledge-graph.json` with typed nodes (article/entity/topic/claim/source), wikilink edges, topic clusters, and a guided reading tour.

Quick phases:
1. **Pre-flight** — resolve notes root, detect format (Obsidian/Logseq/Dendron/Foam/Zettelkasten/plain), check `.sprangignore`
2. **Scan notes** — find all `.md` files, extract titles/wikilinks/tags/frontmatter, build wikilink resolution map
3. **Analyze notes** — read each note in batches of 15, classify type (article/entity/topic/claim/source), write 2-3 sentence summaries, infer edge types from context
4. **Cluster + layer** — group notes into 3-10 topic clusters by tag density and wikilink patterns
5. **Assemble + save** — write `knowledge-graph.json` with `"kind": "knowledge"` + `SPRANG_REPORT.md`

After completion: dashboard auto-switches to knowledge view mode with `KnowledgeInfo` sidebar and `ReadingPanel`.

$ARGUMENTS
