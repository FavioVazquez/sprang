# Sprang — Knowledge Graph

This repository has Sprang installed. A knowledge graph is available at `.sprang/knowledge-graph.json` once built.

---

## Commands (11 total)

| Command | When to use |
|---|---|
| `/sprang` | Build or refresh the graph — auto-detects codebase vs markdown notes |
| `/sprang-analyze [path] [--full] [--language <lang>] [--chunk N]` | Full LLM-driven codebase analysis: summaries, layers, tour, risk |
| `/sprang-knowledge [path] [--format obsidian\|logseq\|...] [--full]` | Build graph from markdown notes (Obsidian, Logseq, Dendron, Foam, Zettelkasten) |
| `/sprang-chat <question>` | Ask any question about the codebase |
| `/sprang-explain <file or path:function>` | Deep-dive on a specific file or function |
| `/sprang-onboard` | Guided architecture tour — adapts to persona |
| `/sprang-diff [files...]` | Blast radius for current changes — also writes diff overlay for dashboard |
| `/sprang-domain [name]` | Map code to business processes |
| `/sprang-why <file>` | Git history + decision context + team annotations for a file |
| `/sprang-health` | Full health report: smells, risk, orphans, circular deps |
| `/sprang-team [node]` | Browse/write team annotations with staleness detection |

---

## Graph Files (commit these)

- `.sprang/knowledge-graph.json` — full knowledge graph (`kind: "codebase"` or `kind: "knowledge"`)
- `.sprang/SPRANG_REPORT.md` — human-readable architecture summary
- `.sprang/annotations/` — team knowledge tied to nodes (YAML frontmatter + markdown)
- `.sprang/diff-overlay.json` — blast radius for dashboard highlight (transient, gitignore optional)

---

## MCP Tools Reference

All 8 tools available to Cascade via the MCP server:

### `sprang_query`
```
Input:  { query: string, node_types?: string[], limit?: number }
Output: Array of nodes ranked by match quality, each with label, type, summary, risk_score
```
Use for: finding nodes by keyword, type filter, or semantic content.

### `sprang_node` (enriched in M6)
```
Input:  { node_id: string }
Output: {
  node: SprangNode,             // full node with summary, risk_score, structural_warnings, knowledgeMeta
  neighbors: NeighborInfo[],    // 1-hop neighborhood (direction + edge_type)
  layer: { id, name },          // architectural layer this node belongs to
  layer_mate_count: number,     // how many siblings in the same layer
  in_degree: number,            // how many nodes import/depend on this
  out_degree: number,           // how many nodes this depends on
  has_annotation: boolean,      // whether a team annotation file exists
  annotation_path?: string      // relative path to annotation file
}
```
Use for: checking risk before editing, understanding coupling, verifying annotation coverage.

### `sprang_diff_impact`
```
Input:  { files: string[] }
Output: { changed_nodes, impact_nodes (BFS), risk_counts, total_impact }
```
Use for: blast radius analysis before committing or after `/sprang-diff`.

### `sprang_tour`
```
Input:  { tour_id?: string, persona?: "junior" | "senior" | "pm" }
Output: { tour_id, title, steps: TourStep[] }
```
Use for: onboarding, guided walkthroughs. Persona filters: junior=all, senior=skip intro, pm=domain/service only.

### `sprang_domain`
```
Input:  { domain_name?: string }
Output: domain list (no arg) or { domain, flows, steps, entry_points, business_rules } (with arg)
```
Use for: understanding business processes and which code owns each domain.

### `sprang_health`
```
Input:  {}
Output: { phase, node_count, edge_count, risk_summary, smell_summary, top_risky_nodes,
          orphan_count, circular_dep_count, nodes_without_tests }
```
Use for: structural health check, prioritizing refactoring targets.

### `sprang_why`
```
Input:  { node_id: string }
Output: { node_id, label, summary, decision_context, annotation, annotation_path }
```
`decision_context` contains: commits, primary_authors, last_changed, change_frequency, rationale_snippets, pr_references.

### `sprang_annotate`
```
Input:  { node_id: string, content: string, tags?: string[] }
Output: { success: true, path: string, node_id, node_label }
```
Writes `.sprang/annotations/<sanitized-node-id>.md` with YAML frontmatter. Commit these files.

---

## For Cascade — Best Practices

**Before editing any file:**
1. Call `sprang_node` with the file path to check `risk_score`, `structural_warnings`, `layer`, `in_degree`, and `has_annotation`
2. If `risk_score > 0.7`: call `sprang_why` to read decision context and team annotation
3. After making changes: call `sprang_diff_impact` to assess blast radius

**Before a PR:**
- Run `/sprang-diff` — it writes `.sprang/diff-overlay.json` for dashboard amber highlight
- If `total_impact > 10`, document the scope in the PR description

**For new team members:**
- Run `/sprang-onboard` first (adapts to junior/senior/PM persona)
- Open dashboard: `pnpm --filter @sprang/dashboard dev` → switch to **Learn** tab

**For knowledge bases (Obsidian, Logseq, etc.):**
- Run `/sprang-knowledge [path]` — auto-detects format
- Dashboard auto-switches to knowledge view mode with `KnowledgeInfo` sidebar and `ReadingPanel`

---

## For Devin Local

All 11 slash commands work. Skill definitions are in `.windsurf/skills/*/SKILL.md`.

If no graph exists yet: run `/sprang` to build one.

*New to this codebase? Run `/sprang-onboard` first.*
