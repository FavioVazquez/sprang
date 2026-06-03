---
name: sprang-knowledge
description: Build an interactive knowledge graph from a folder of markdown notes — Obsidian, Logseq, Dendron, Foam, Zettelkasten, or plain markdown
argument-hint: ["[path] [--format obsidian|logseq|dendron|foam|zettelkasten|plain] [--language <lang>] [--full]"]
---

Analyze a folder of markdown notes and produce a `.sprang/knowledge-graph.json` with typed nodes (article/entity/topic/claim/source), wikilink edges, topic clusters, and a guided reading tour.

Follow the detailed instructions in `.windsurf/workflows/sprang-knowledge.md`.

Quick summary of phases:
1. **Pre-flight** — resolve notes root, detect format (Obsidian/Logseq/Dendron/Foam/Zettelkasten/plain), check `.sprangignore`
2. **Scan notes** — find all `.md` files, extract titles/wikilinks/tags/frontmatter, build wikilink resolution map
3. **Analyze notes** — read each note in batches of 15, classify type (article/entity/topic/claim/source), write 2-3 sentence summaries, infer edge types from context
4. **Cluster + layer** — group notes into 3-10 topic clusters by tag density and wikilink patterns
5. **Assemble + save** — write `knowledge-graph.json` with `"kind": "knowledge"` + SPRANG_REPORT.md

After completion: graph auto-switches dashboard to knowledge view mode, `KnowledgeInfo` sidebar shows backlinks/confidence/frontmatter, `ReadingPanel` slides up for article nodes.

Supported formats and their special handling:
- **Obsidian**: `[[wikilinks]]`, `#tags`, `.obsidian/` detection
- **Logseq**: `:tags:` properties, `journals/` and `pages/` dirs, block refs skipped
- **Dendron**: `.` hierarchy in filenames, `id:` frontmatter, vault links
- **Foam**: `.foam/` detection, standard wikilinks
- **Zettelkasten**: numeric ID prefixes (`202403141200`), ID-based linking
- **Plain**: frontmatter YAML, standard markdown links, wikilinks if present
