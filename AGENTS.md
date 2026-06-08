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

All 9 tools available to your AI agent via the MCP server:

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
Input:  { tour_id?: string, persona?: "junior" | "senior" | "experienced" | "pm" | "non-technical" }
Output: { tour_id, title, steps: TourStep[] }
```
Use for: onboarding, guided walkthroughs. Persona filters: `junior`=all steps, `senior`/`experienced`=skip intro, `pm`=domain/service nodes, `non-technical`=entry-points and domains only.

### `sprang_domain`
```
Input:  { domain_name?: string }
Output: domain list (no arg) or { domain, flows, steps, entry_points, business_rules } (with arg)
```
Use for: understanding business processes and which code owns each domain.

### `sprang_health`
```
Input:  {}
Output: {
  phase, generated_at, total_nodes, total_edges,
  health_grade: "A"|"B"|"C"|"D"|"F",
  health_score: number,                  // 0–100
  grade_color: string,                   // hex (#22c55e for A → #ef4444 for F)
  grade_breakdown: { dead_code_penalty, circular_penalty, god_node_penalty,
                     coupling_penalty, security_penalty },
  risk_summary: { high, medium, low },
  smell_summary: Partial<Record<SmellCategory, number>>,
  security_summary: { total, by_severity: { high, medium, low },
                      by_category: Partial<Record<SecurityCategory, number>> },
  top_10_risky_nodes: TopRiskyNode[],
  orphan_count, circular_dependency_count, nodes_without_tests,
  history: HistorySnapshot[]             // last 30 run snapshots
}
```
Use for: structural health check, letter grade at a glance, security audit, prioritizing refactoring targets.

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

### `sprang_respond`
```
Input:  { response: string, question?: string }
Output: { success: true, path: string, written_at: string }
```
Writes `.sprang/cascade-response.json` so the dashboard Ask Agent panel displays your reply. Call this at the end of every dashboard chat response.

---

## For AI Agents — Best Practices

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

---

## Dashboard Chat (Ask Agent)

The Sprang dashboard has an **Ask Agent** panel that routes questions through whichever agent bridge is active:
- **Windsurf / Devin Desktop** — writes `.cascade-trigger-session`; the `cascade-messaging` VS Code extension forwards it to Cascade (the Windsurf AI), which calls `sprang_respond` to write the reply
- **Claude Code** — spawns `claude -p` non-interactively with session continuity via `--resume`
- **Copilot CLI** — spawns `copilot --prompt` non-interactively with session continuity via `--resume=<id>`

Conversation history is maintained in `.sprang/agent-conversation.md` (gitignored — use `cat` to read it, not `read_file`).

The rule `.devin/rules/cascade-messaging.md` (always_on) governs this for Windsurf — it tells Cascade to:
1. Run `cat .sprang/agent-conversation.md 2>/dev/null || echo "(no history yet)"` before each message
2. Answer the message fully
3. Call `sprang_respond` MCP tool so the reply appears in the dashboard UI

**If you receive a message prefixed with `[SPRANG DASHBOARD MESSAGE]`:**
- Run `cat .sprang/agent-conversation.md 2>/dev/null || echo "(no history yet)"` first (file is gitignored — `read_file` is blocked)
- Answer in context of the full conversation history
- Always end by calling `sprang_respond` with your answer
