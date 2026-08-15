/**
 * Static wiki export.
 *
 * Renders a `KnowledgeGraph` as a small, fully cross-linked markdown site that
 * can be committed to the repo, served by any static host, opened in Obsidian
 * or dropped into a docs folder. Nothing here touches the filesystem — the
 * caller decides where the returned {@link WikiPage}s land.
 *
 * ## Why this exists / how it differs from DeepWiki
 *
 * DeepWiki gives a browsable wiki for any *public* repository, hosted by
 * someone else. This is the offline equivalent, and it can do things a hosted
 * indexer cannot:
 *
 * - **Local and private.** The graph is built on the machine; no source, path
 *   or commit message is uploaded. It works on closed source and offline.
 * - **Risk-aware.** Pages carry `risk_score`, risk factors, structural and
 *   security warnings, and there is a whole `RISKS.md` register ordered worst
 *   first — a code-reading site, not just a code-summarising one.
 * - **History-aware.** With `includeHistory`, file pages show git-derived
 *   behavioural facts (revisions, bug fixes, main developer, bus factor,
 *   hotspot score) and recent decision context.
 *
 * ## Determinism
 *
 * Same graph in, byte-identical pages out. Every collection is sorted with a
 * total order and nothing reads the clock (`generated_at` is copied from the
 * graph, not from `Date.now()`).
 *
 * ## Links
 *
 * Every link is computed from the *source page's* directory depth, so a page at
 * `files/packages/core/src/x.ts.md` correctly links to `../../../../index.md`.
 * Setting `baseUrl` switches all links to absolute URLs instead.
 */

import type {
  Domain,
  KnowledgeGraph,
  Layer,
  SprangEdge,
  SprangNode,
} from '../schema/types.js';
import { RISK_HIGH, RISK_MEDIUM, nodeFilePath, toMermaidArchitecture } from './mermaid.js';

export interface WikiPage {
  /** Site-relative page path, e.g. `files/src/a.ts.md`. Always POSIX style. */
  path: string;
  title: string;
  markdown: string;
}

export interface WikiOptions {
  /** Include risk scores, risk factors and warnings. Default true. */
  includeRisk?: boolean;
  /** Include git-derived behavioural facts and decision context. Default true. */
  includeHistory?: boolean;
  /** When set, links are absolute (`<baseUrl>/files/a.ts.md`) instead of relative. */
  baseUrl?: string;
}

const INDEX_PAGE = 'index.md';
const RISKS_PAGE = 'RISKS.md';

// ─── Path / link helpers ─────────────────────────────────────────────

/**
 * Make one path segment safe as a file name and as a URL fragment: spaces and
 * anything that would break a markdown link become `-`. Unicode letters are
 * preserved (they are legal in both file names and URLs).
 */
export function slugifySegment(raw: string): string {
  const cleaned = raw
    .replace(/[\\/:*?"'<>|#%()[\]{}`^\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned.length === 0 ? 'unnamed' : cleaned;
}

/** `files/<slugified path>.md`, keeping the directory structure. */
function filePagePath(path: string): string {
  const segments = path
    .replace(/\\/g, '/')
    .split('/')
    .filter(s => s.length > 0 && s !== '.' && s !== '..')
    .map(slugifySegment);
  if (segments.length === 0) return 'files/unnamed.md';
  return `files/${segments.join('/')}.md`;
}

/** Deterministic short hash used to break page-name collisions. */
function shortHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return (hash >>> 0).toString(16).padStart(8, '0').slice(0, 6);
}

/**
 * Relative (or absolute, with `baseUrl`) link from one page to another.
 *
 * `from` and `to` are both site-relative page paths. The number of `../` hops
 * is the source page's directory depth, which is the part generated sites
 * usually get wrong.
 */
export function relativeLink(from: string, to: string, baseUrl?: string): string {
  if (baseUrl !== undefined && baseUrl.length > 0) {
    return `${baseUrl.replace(/\/+$/, '')}/${to}`;
  }
  const depth = from.split('/').length - 1;
  if (depth === 0) return to;
  return `${'../'.repeat(depth)}${to}`;
}

/** Escape markdown text so it cannot break a table cell or a heading. */
function md(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().replace(/\|/g, '\\|');
}

/** Escape markdown link text (same rules, plus brackets). */
function mdLinkText(raw: string): string {
  return md(raw).replace(/\[/g, '\\[').replace(/\]/g, '\\]');
}

function link(text: string, from: string, to: string, baseUrl?: string): string {
  return `[${mdLinkText(text)}](${relativeLink(from, to, baseUrl)})`;
}

// ─── Graph indexing ──────────────────────────────────────────────────

interface WikiIndex {
  byId: Map<string, SprangNode>;
  /** File-level nodes (nothing `contains` them), sorted by id. */
  fileNodes: SprangNode[];
  /** node id → owning file node id. */
  owner: Map<string, string>;
  /** file node id → contained symbol nodes, sorted by id. */
  symbols: Map<string, SprangNode[]>;
  /** file node id → wiki page path. */
  pageOf: Map<string, string>;
  /** node id → layer id. */
  layerOf: Map<string, string>;
  outgoing: Map<string, SprangEdge[]>;
  incoming: Map<string, SprangEdge[]>;
}

function byIdAsc(a: SprangNode, b: SprangNode): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function buildIndex(graph: KnowledgeGraph): WikiIndex {
  const byId = new Map(graph.nodes.map(n => [n.id, n] as const));

  const directOwner = new Map<string, string>();
  for (const edge of graph.edges) {
    if (edge.type !== 'contains' || edge.source === edge.target) continue;
    if (!byId.has(edge.source) || !byId.has(edge.target)) continue;
    if (!directOwner.has(edge.target)) directOwner.set(edge.target, edge.source);
  }
  const owner = new Map<string, string>();
  for (const node of graph.nodes) {
    let current = node.id;
    const seen = new Set<string>([current]);
    for (;;) {
      const next = directOwner.get(current);
      if (next === undefined || seen.has(next)) break;
      seen.add(next);
      current = next;
    }
    if (current !== node.id) owner.set(node.id, current);
  }

  const fileNodes = graph.nodes.filter(n => !owner.has(n.id)).sort(byIdAsc);

  const symbols = new Map<string, SprangNode[]>();
  for (const node of graph.nodes) {
    const ownerId = owner.get(node.id);
    if (ownerId === undefined) continue;
    const list = symbols.get(ownerId);
    if (list === undefined) symbols.set(ownerId, [node]);
    else list.push(node);
  }
  for (const list of symbols.values()) list.sort(byIdAsc);

  // Page paths, with deterministic collision breaking. Two distinct file nodes
  // whose paths slugify identically ("a b.ts" and "a-b.ts") must not overwrite
  // each other.
  const pageOf = new Map<string, string>();
  const usedPages = new Map<string, string>();
  for (const node of fileNodes) {
    const base = filePagePath(nodeFilePath(node));
    let candidate = base;
    if (usedPages.has(candidate)) {
      candidate = `${base.slice(0, -3)}-${shortHash(node.id)}.md`;
      let counter = 2;
      while (usedPages.has(candidate)) {
        candidate = `${base.slice(0, -3)}-${shortHash(node.id)}-${counter}.md`;
        counter += 1;
      }
    }
    usedPages.set(candidate, node.id);
    pageOf.set(node.id, candidate);
  }

  const layerOf = new Map<string, string>();
  for (const layer of graph.layers) {
    for (const nodeId of layer.node_ids) layerOf.set(nodeId, layer.id);
  }
  for (const node of graph.nodes) {
    if (node.layer !== undefined && node.layer.length > 0) layerOf.set(node.id, node.layer);
  }

  const outgoing = new Map<string, SprangEdge[]>();
  const incoming = new Map<string, SprangEdge[]>();
  for (const edge of graph.edges) {
    const out = outgoing.get(edge.source);
    if (out === undefined) outgoing.set(edge.source, [edge]);
    else out.push(edge);
    const inc = incoming.get(edge.target);
    if (inc === undefined) incoming.set(edge.target, [edge]);
    else inc.push(edge);
  }

  return { byId, fileNodes, owner, symbols, pageOf, layerOf, outgoing, incoming };
}

function layerPagePath(layer: Layer): string {
  return `layers/${slugifySegment(layer.id.length > 0 ? layer.id : layer.name)}.md`;
}

function domainPagePath(domain: Domain): string {
  return `domains/${slugifySegment(domain.id.length > 0 ? domain.id : domain.label)}.md`;
}

function riskLabel(score: number): string {
  if (score >= RISK_HIGH) return 'high';
  if (score >= RISK_MEDIUM) return 'medium';
  return 'low';
}

function summaryOf(node: SprangNode): string {
  const summary = node.summary;
  return summary !== undefined && summary.trim().length > 0 ? md(summary) : '_No summary available._';
}

function behavioural(node: SprangNode): Record<string, unknown> | undefined {
  const meta = node.metadata?.['behavioral'];
  if (meta !== null && typeof meta === 'object') return meta as Record<string, unknown>;
  return undefined;
}

function numberField(source: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = source?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stringField(source: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = source?.[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

// ─── Page builders ───────────────────────────────────────────────────

function buildIndexPage(graph: KnowledgeGraph, index: WikiIndex, opts: Required<Omit<WikiOptions, 'baseUrl'>> & { baseUrl?: string }): WikiPage {
  const { baseUrl, includeRisk } = opts;
  const title = `${graph.project_name.length > 0 ? graph.project_name : 'Project'} — Sprang Wiki`;
  const out: string[] = [`# ${md(title)}`, ''];

  if (graph.description !== undefined && graph.description.trim().length > 0) {
    out.push(md(graph.description), '');
  }
  out.push(
    'Generated locally by [Sprang](https://github.com/FavioVazquez/sprang) from `.sprang/knowledge-graph.json`.',
    'Unlike a hosted wiki, this is produced offline from a private graph and carries risk and history, not just structure.',
    ''
  );

  out.push('## At a glance', '');
  out.push('| Metric | Value |', '| --- | --- |');
  out.push(`| Nodes | ${graph.stats.node_count || graph.nodes.length} |`);
  out.push(`| Edges | ${graph.stats.edge_count || graph.edges.length} |`);
  out.push(`| Files | ${index.fileNodes.length} |`);
  out.push(`| Layers | ${graph.layers.length} |`);
  out.push(`| Domains | ${graph.domains.length} |`);
  out.push(`| Phase | ${md(graph.phase)} |`);
  out.push(`| Generated at | ${md(graph.generated_at)} |`);
  if (graph.languages !== undefined && graph.languages.length > 0) {
    out.push(`| Languages | ${md([...graph.languages].sort().join(', '))} |`);
  }
  if (graph.frameworks !== undefined && graph.frameworks.length > 0) {
    out.push(`| Frameworks | ${md([...graph.frameworks].sort().join(', '))} |`);
  }
  out.push('');

  if (includeRisk) {
    const risk = graph.stats.risk_summary;
    out.push('## Health', '');
    out.push(`- High-risk nodes: **${risk.high}**`);
    out.push(`- Medium-risk nodes: **${risk.medium}**`);
    out.push(`- Low-risk nodes: **${risk.low}**`);
    const smells = Object.entries(graph.stats.smell_summary).sort(([a], [b]) => (a < b ? -1 : 1));
    if (smells.length > 0) {
      out.push('', '| Smell | Count |', '| --- | --- |');
      for (const [name, count] of smells) out.push(`| ${md(name)} | ${count ?? 0} |`);
    }
    out.push('', link('Full risk register', INDEX_PAGE, RISKS_PAGE, baseUrl), '');
  }

  out.push('## Architecture', '');
  out.push('```mermaid');
  out.push(toMermaidArchitecture(graph, { includeRisk, groupBy: 'layer', direction: 'TB' }));
  out.push('```', '');

  out.push('## Layers', '');
  if (graph.layers.length === 0) {
    out.push('_No layers were derived for this graph._', '');
  } else {
    for (const layer of [...graph.layers].sort((a, b) => (a.id < b.id ? -1 : 1))) {
      const count = layer.node_ids.length;
      out.push(`- ${link(layer.name.length > 0 ? layer.name : layer.id, INDEX_PAGE, layerPagePath(layer), baseUrl)} — ${count} file${count === 1 ? '' : 's'}`);
    }
    out.push('');
  }

  if (graph.domains.length > 0) {
    out.push('## Domains', '');
    for (const domain of [...graph.domains].sort((a, b) => (a.id < b.id ? -1 : 1))) {
      out.push(`- ${link(domain.label.length > 0 ? domain.label : domain.id, INDEX_PAGE, domainPagePath(domain), baseUrl)}`);
    }
    out.push('');
  }

  if (graph.tours.length > 0) {
    out.push('## Tours', '');
    for (const tour of [...graph.tours].sort((a, b) => (a.id < b.id ? -1 : 1))) {
      out.push(`- **${md(tour.title.length > 0 ? tour.title : tour.id)}** — ${md(tour.description)} (${tour.steps.length} steps)`);
    }
    out.push('');
  }

  out.push('## Files', '');
  if (index.fileNodes.length === 0) {
    out.push('_No files in this graph._', '');
  } else {
    for (const node of index.fileNodes) {
      const page = index.pageOf.get(node.id);
      if (page === undefined) continue;
      out.push(`- ${link(nodeFilePath(node), INDEX_PAGE, page, baseUrl)}`);
    }
    out.push('');
  }

  return { path: INDEX_PAGE, title, markdown: `${out.join('\n').replace(/\n+$/, '')}\n` };
}

function buildLayerPage(
  graph: KnowledgeGraph,
  index: WikiIndex,
  layer: Layer,
  opts: { baseUrl?: string }
): WikiPage {
  const page = layerPagePath(layer);
  const title = layer.name.length > 0 ? layer.name : layer.id;
  const out: string[] = [`# Layer — ${md(title)}`, ''];
  out.push(link('← Wiki index', page, INDEX_PAGE, opts.baseUrl), '');

  if (layer.description !== undefined && layer.description.trim().length > 0) {
    out.push(md(layer.description), '');
  }

  const members = layer.node_ids
    .map(id => index.byId.get(id))
    .filter((n): n is SprangNode => n !== undefined)
    .sort(byIdAsc);

  out.push('## Files', '');
  if (members.length === 0) {
    out.push('_This layer has no members._', '');
  } else {
    out.push('| File | Summary |', '| --- | --- |');
    for (const node of members) {
      const target = index.pageOf.get(node.id);
      const label = nodeFilePath(node);
      const cell = target === undefined ? md(label) : link(label, page, target, opts.baseUrl);
      out.push(`| ${cell} | ${summaryOf(node)} |`);
    }
    out.push('');
  }

  // Layer-to-layer dependency aggregation.
  const memberIds = new Set(members.map(n => n.id));
  const resolveLayer = (nodeId: string): string | undefined => {
    const own = index.layerOf.get(nodeId);
    if (own !== undefined) return own;
    const ownerId = index.owner.get(nodeId);
    return ownerId === undefined ? undefined : index.layerOf.get(ownerId);
  };
  const containsMember = (nodeId: string): boolean => {
    if (memberIds.has(nodeId)) return true;
    const ownerId = index.owner.get(nodeId);
    return ownerId !== undefined && memberIds.has(ownerId);
  };

  const outbound = new Map<string, number>();
  const inbound = new Map<string, number>();
  for (const edge of graph.edges) {
    if (edge.type === 'contains') continue;
    const fromMember = containsMember(edge.source);
    const toMember = containsMember(edge.target);
    if (fromMember === toMember) continue;
    if (fromMember) {
      const other = resolveLayer(edge.target);
      if (other !== undefined && other !== layer.id) outbound.set(other, (outbound.get(other) ?? 0) + 1);
    } else {
      const other = resolveLayer(edge.source);
      if (other !== undefined && other !== layer.id) inbound.set(other, (inbound.get(other) ?? 0) + 1);
    }
  }

  const layerById = new Map(graph.layers.map(l => [l.id, l] as const));
  const renderDeps = (heading: string, counts: Map<string, number>): void => {
    out.push(`## ${heading}`, '');
    const entries = [...counts.entries()].sort((a, b) => (b[1] !== a[1] ? b[1] - a[1] : a[0] < b[0] ? -1 : 1));
    if (entries.length === 0) {
      out.push('_None._', '');
      return;
    }
    for (const [layerId, count] of entries) {
      const other = layerById.get(layerId);
      const label = other?.name ?? layerId;
      const cell = other === undefined ? md(label) : link(label, page, layerPagePath(other), opts.baseUrl);
      out.push(`- ${cell} — ${count} edge${count === 1 ? '' : 's'}`);
    }
    out.push('');
  };
  renderDeps('Outbound dependencies', outbound);
  renderDeps('Inbound dependencies', inbound);

  return { path: page, title, markdown: `${out.join('\n').replace(/\n+$/, '')}\n` };
}

function buildFilePage(
  graph: KnowledgeGraph,
  index: WikiIndex,
  node: SprangNode,
  opts: { baseUrl?: string; includeRisk: boolean; includeHistory: boolean }
): WikiPage {
  const page = index.pageOf.get(node.id) ?? filePagePath(nodeFilePath(node));
  const path = nodeFilePath(node);
  const title = path;
  const out: string[] = [`# ${md(path)}`, ''];
  out.push(link('← Wiki index', page, INDEX_PAGE, opts.baseUrl), '');

  const layerId = index.layerOf.get(node.id);
  const layer = layerId === undefined ? undefined : graph.layers.find(l => l.id === layerId);
  if (layer !== undefined) {
    out.push(`**Layer:** ${link(layer.name.length > 0 ? layer.name : layer.id, page, layerPagePath(layer), opts.baseUrl)}`, '');
  } else if (layerId !== undefined) {
    out.push(`**Layer:** ${md(layerId)}`, '');
  }

  out.push('## Summary', '', summaryOf(node), '');

  const facts: string[] = [`- Type: \`${md(node.type)}\``];
  const language = node.metadata?.['language'];
  if (typeof language === 'string' && language.length > 0) facts.push(`- Language: \`${md(language)}\``);
  const sizeLines = numberField(node.metadata, 'sizeLines');
  if (sizeLines !== undefined) facts.push(`- Lines: ${sizeLines}`);
  const parser = node.metadata?.['parser'];
  if (typeof parser === 'string' && parser.length > 0) facts.push(`- Parser: \`${md(parser)}\``);
  const community = node.metadata?.['community'];
  if (typeof community === 'string' && community.length > 0) facts.push(`- Community: \`${md(community)}\``);
  if (node.complexity !== undefined) facts.push(`- Complexity: ${md(node.complexity)}`);
  if (node.tags !== undefined && node.tags.length > 0) {
    facts.push(`- Tags: ${[...node.tags].sort().map(t => `\`${md(t)}\``).join(', ')}`);
  }
  out.push('## Facts', '', ...facts, '');

  const symbols = index.symbols.get(node.id) ?? [];
  out.push('## Symbols', '');
  if (symbols.length === 0) {
    out.push('_No symbols extracted._', '');
  } else {
    out.push('| Symbol | Type | Lines |', '| --- | --- | --- |');
    for (const symbol of symbols) {
      const start = symbol.location?.start_line ?? symbol.lineRange?.[0];
      const end = symbol.location?.end_line ?? symbol.lineRange?.[1];
      const lines = start === undefined ? '—' : end === undefined ? `${start}` : `${start}–${end}`;
      out.push(`| ${md(symbol.label.length > 0 ? symbol.label : symbol.id)} | ${md(symbol.type)} | ${lines} |`);
    }
    out.push('');
  }

  const renderRelations = (heading: string, edges: readonly SprangEdge[], pick: (e: SprangEdge) => string): void => {
    out.push(`## ${heading}`, '');
    const targets = [...new Set(edges.filter(e => e.type === 'imports' || e.type === 'depends_on').map(pick))].sort();
    if (targets.length === 0) {
      out.push('_None._', '');
      return;
    }
    for (const targetId of targets) {
      const target = index.byId.get(targetId);
      if (target === undefined) {
        out.push(`- ${md(targetId)}`);
        continue;
      }
      const targetPage = index.pageOf.get(target.id);
      out.push(
        `- ${targetPage === undefined ? md(nodeFilePath(target)) : link(nodeFilePath(target), page, targetPage, opts.baseUrl)}`
      );
    }
    out.push('');
  };
  renderRelations('Imports', index.outgoing.get(node.id) ?? [], e => e.target);
  renderRelations('Imported by', index.incoming.get(node.id) ?? [], e => e.source);

  if (opts.includeRisk) {
    out.push('## Risk', '');
    const score = node.risk_score;
    if (typeof score === 'number' && Number.isFinite(score)) {
      out.push(`- Score: **${score.toFixed(2)}** (${riskLabel(score)})`);
    } else {
      out.push('- Score: _not scored_');
    }
    if (node.risk_factors !== undefined && node.risk_factors.length > 0) {
      out.push(`- Factors: ${[...node.risk_factors].sort().map(f => `\`${md(f)}\``).join(', ')}`);
    }
    out.push('');

    const warnings = node.structural_warnings ?? [];
    if (warnings.length > 0) {
      out.push('### Structural warnings', '', '| Category | Severity | Description |', '| --- | --- | --- |');
      for (const warning of [...warnings].sort((a, b) =>
        a.category === b.category ? (a.description < b.description ? -1 : 1) : a.category < b.category ? -1 : 1
      )) {
        out.push(`| ${md(warning.category)} | ${md(warning.severity)} | ${md(warning.description)} |`);
      }
      out.push('');
    }

    const security = node.security_warnings ?? [];
    if (security.length > 0) {
      out.push('### Security warnings', '', '| Category | Severity | Confidence | Description |', '| --- | --- | --- | --- |');
      for (const warning of [...security].sort((a, b) =>
        a.category === b.category ? (a.description < b.description ? -1 : 1) : a.category < b.category ? -1 : 1
      )) {
        out.push(`| ${md(warning.category)} | ${md(warning.severity)} | ${md(warning.confidence)} | ${md(warning.description)} |`);
      }
      out.push('');
    }
  }

  if (opts.includeHistory) {
    const meta = behavioural(node);
    const decision = node.decision_context;
    out.push('## History', '');
    const rows: string[] = [];
    const revisions = numberField(meta, 'revisions');
    if (revisions !== undefined) rows.push(`- Revisions: ${revisions}`);
    const bugFixes = numberField(meta, 'bug_fixes');
    if (bugFixes !== undefined) rows.push(`- Bug fixes: ${bugFixes}`);
    const mainDeveloper = stringField(meta, 'main_developer');
    if (mainDeveloper !== undefined) rows.push(`- Main developer: ${md(mainDeveloper)}`);
    const busFactor = numberField(meta, 'bus_factor');
    if (busFactor !== undefined) rows.push(`- Bus factor: ${busFactor}`);
    const hotspot = numberField(meta, 'hotspot_score');
    if (hotspot !== undefined) rows.push(`- Hotspot score: ${hotspot.toFixed(2)}`);
    const traps = numberField(meta, 'trap_count');
    if (traps !== undefined) rows.push(`- Traps (reverted / urgent fixes): ${traps}`);
    if (decision !== undefined) {
      rows.push(`- Last changed: ${md(decision.last_changed)}`);
      rows.push(`- Changes in last 90 days: ${decision.change_frequency}`);
      if (decision.primary_authors.length > 0) {
        rows.push(`- Primary authors: ${[...decision.primary_authors].sort().map(a => md(a)).join(', ')}`);
      }
    }
    if (rows.length === 0) out.push('_No history recorded for this file._', '');
    else out.push(...rows, '');

    if (decision !== undefined && decision.commits.length > 0) {
      out.push('### Recent commits', '', '| SHA | Date | Author | Message |', '| --- | --- | --- | --- |');
      for (const commit of decision.commits.slice(0, 10)) {
        out.push(`| \`${md(commit.sha)}\` | ${md(commit.date)} | ${md(commit.author)} | ${md(commit.message)} |`);
      }
      out.push('');
    }
    if (decision !== undefined && decision.rationale_snippets.length > 0) {
      out.push('### Why it looks like this', '');
      for (const snippet of decision.rationale_snippets) out.push(`- ${md(snippet)}`);
      out.push('');
    }
  }

  if (node.annotations !== undefined && node.annotations.length > 0) {
    out.push('## Team notes', '');
    for (const annotation of node.annotations) out.push(`> ${md(annotation)}`, '');
  }

  return { path: page, title, markdown: `${out.join('\n').replace(/\n+$/, '')}\n` };
}

function buildDomainPage(
  index: WikiIndex,
  domain: Domain,
  opts: { baseUrl?: string }
): WikiPage {
  const page = domainPagePath(domain);
  const title = domain.label.length > 0 ? domain.label : domain.id;
  const out: string[] = [`# Domain — ${md(title)}`, ''];
  out.push(link('← Wiki index', page, INDEX_PAGE, opts.baseUrl), '');
  if (domain.summary !== undefined && domain.summary.trim().length > 0) out.push(md(domain.summary), '');

  if (domain.entities !== undefined && domain.entities.length > 0) {
    out.push('## Entities', '');
    for (const entity of [...domain.entities].sort()) out.push(`- ${md(entity)}`);
    out.push('');
  }

  out.push('## Flows', '');
  if (domain.flows.length === 0) {
    out.push('_No flows recorded._', '');
  } else {
    for (const flow of [...domain.flows].sort((a, b) => (a.id < b.id ? -1 : 1))) {
      out.push(`### ${md(flow.label.length > 0 ? flow.label : flow.id)}`, '');
      if (flow.summary !== undefined && flow.summary.trim().length > 0) out.push(md(flow.summary), '');
      const steps = [...flow.steps].sort((a, b) => (a.weight !== b.weight ? a.weight - b.weight : a.id < b.id ? -1 : 1));
      for (const step of steps) {
        out.push(`1. **${md(step.label.length > 0 ? step.label : step.id)}**${step.summary !== undefined && step.summary.length > 0 ? ` — ${md(step.summary)}` : ''}`);
        const nodeLinks: string[] = [];
        for (const nodeId of [...step.node_ids].sort()) {
          const target = index.byId.get(nodeId) ?? index.byId.get(index.owner.get(nodeId) ?? '');
          if (target === undefined) continue;
          const ownerId = index.owner.get(target.id) ?? target.id;
          const targetPage = index.pageOf.get(ownerId);
          const ownerNode = index.byId.get(ownerId);
          if (targetPage === undefined || ownerNode === undefined) continue;
          nodeLinks.push(link(nodeFilePath(ownerNode), page, targetPage, opts.baseUrl));
        }
        if (nodeLinks.length > 0) out.push(`   - ${[...new Set(nodeLinks)].join(', ')}`);
      }
      out.push('');
      if (flow.business_rules !== undefined && flow.business_rules.length > 0) {
        out.push('**Business rules**', '');
        for (const rule of flow.business_rules) out.push(`- ${md(rule)}`);
        out.push('');
      }
    }
  }

  return { path: page, title, markdown: `${out.join('\n').replace(/\n+$/, '')}\n` };
}

function buildRisksPage(index: WikiIndex, opts: { baseUrl?: string }): WikiPage {
  const page = RISKS_PAGE;
  const title = 'Risk register';
  const out: string[] = ['# Risk register', ''];
  out.push(link('← Wiki index', page, INDEX_PAGE, opts.baseUrl), '');
  out.push(
    'Highest risk first. Risk comes from structure (coupling, blast radius) *and* from git history',
    '(churn, prior reverts, bus factor) — the part a hosted code wiki cannot see.',
    ''
  );

  const scored = index.fileNodes
    .filter(n => typeof n.risk_score === 'number' && Number.isFinite(n.risk_score))
    .sort((a, b) => {
      const ra = a.risk_score ?? 0;
      const rb = b.risk_score ?? 0;
      if (ra !== rb) return rb - ra;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

  if (scored.length === 0) {
    out.push('_No risk scores in this graph._', '');
  } else {
    out.push('| # | File | Risk | Band | Factors | Warnings |', '| --- | --- | --- | --- | --- | --- |');
    let rank = 1;
    for (const node of scored) {
      const score = node.risk_score ?? 0;
      const target = index.pageOf.get(node.id);
      const label = nodeFilePath(node);
      const cell = target === undefined ? md(label) : link(label, page, target, opts.baseUrl);
      const factors =
        node.risk_factors !== undefined && node.risk_factors.length > 0
          ? [...node.risk_factors].sort().map(f => `\`${md(f)}\``).join(', ')
          : '—';
      const warnings = (node.structural_warnings?.length ?? 0) + (node.security_warnings?.length ?? 0);
      out.push(`| ${rank} | ${cell} | ${score.toFixed(2)} | ${riskLabel(score)} | ${factors} | ${warnings} |`);
      rank += 1;
    }
    out.push('');
  }

  return { path: page, title, markdown: `${out.join('\n').replace(/\n+$/, '')}\n` };
}

// ─── Entry point ─────────────────────────────────────────────────────

/**
 * Render the whole wiki.
 *
 * Always emits `index.md` and `RISKS.md`; adds `layers/<layer>.md`,
 * `files/<path>.md` and `domains/<domain>.md` as the graph provides them. Pages
 * come back sorted by path so the result is stable, and every page is
 * reachable from `index.md`.
 */
export function generateWiki(graph: KnowledgeGraph, opts?: WikiOptions): WikiPage[] {
  const includeRisk = opts?.includeRisk ?? true;
  const includeHistory = opts?.includeHistory ?? true;
  const baseUrl = opts?.baseUrl;

  const index = buildIndex(graph);
  const pages: WikiPage[] = [];

  pages.push(buildIndexPage(graph, index, { includeRisk, includeHistory, baseUrl }));
  pages.push(buildRisksPage(index, { baseUrl }));

  for (const layer of [...graph.layers].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    pages.push(buildLayerPage(graph, index, layer, { baseUrl }));
  }
  for (const node of index.fileNodes) {
    pages.push(buildFilePage(graph, index, node, { baseUrl, includeRisk, includeHistory }));
  }
  for (const domain of [...graph.domains].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    pages.push(buildDomainPage(index, domain, { baseUrl }));
  }

  return pages.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
