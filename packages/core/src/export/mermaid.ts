/**
 * Mermaid diagram export.
 *
 * Turns a `KnowledgeGraph` into diagrams that render anywhere Mermaid is
 * supported (GitHub, VS Code, Obsidian, the Sprang wiki export, an LLM prompt).
 *
 * ## Why this exists / how it differs from DeepWiki
 *
 * DeepWiki renders architecture diagrams for *public* repositories on someone
 * else's servers. This module does the same job from a graph Sprang already
 * built locally, which means:
 *
 * - **Local and private.** Nothing leaves the machine; it works on closed
 *   source, on air-gapped checkouts and offline.
 * - **Risk-aware.** The graph carries `risk_score`, structural warnings and
 *   git-derived behavioural facts, so groups can be *coloured by risk* instead
 *   of being a flat box-and-arrow picture (`includeRisk`).
 * - **Aggregated on purpose.** A per-file diagram of a 400-file repository is
 *   unreadable and Mermaid will not lay it out. Everything here collapses to
 *   groups (layer / community / directory) with edge counts on the arrows.
 *
 * ## Determinism
 *
 * Every ordering in this file is total (value first, then id) so the same graph
 * always produces byte-identical output. Nothing reads the clock or the
 * filesystem.
 *
 * ## Escaping
 *
 * Mermaid has two separate hazards and they need two separate fixes:
 * - **Ids** may only contain `[A-Za-z0-9_]` and must not start with a digit —
 *   real node ids (`file:packages/core/src/a-b.ts`) violate this constantly.
 *   Use {@link mermaidSafeId}, and {@link createMermaidIdFactory} when several
 *   raw ids share a diagram (it guarantees no two raw ids collapse onto one).
 * - **Labels** break the parser on `(`, `)`, `[`, `]`, `{`, `}`, `"`, `<`, `>`,
 *   `#`, `;`, `|`, backslash, backtick and newlines. Use
 *   {@link escapeMermaidLabel}.
 */

import type { KnowledgeGraph, SprangEdge, SprangNode } from '../schema/types.js';

// ─── Options ─────────────────────────────────────────────────────────

export interface MermaidOptions {
  /** Maximum number of groups rendered. Default 60. */
  maxNodes?: number;
  /** How nodes are collapsed into subgraphs. Default `'layer'`. */
  groupBy?: 'layer' | 'community' | 'directory';
  /** Colour groups by aggregate risk (red = high, amber = medium). */
  includeRisk?: boolean;
  /** Flow direction. Default `'TB'`. */
  direction?: 'TB' | 'LR';
}

/** Risk thresholds shared by the diagrams and the wiki export. */
export const RISK_HIGH = 0.7;
export const RISK_MEDIUM = 0.4;

const DEFAULT_MAX_NODES = 60;
const DEFAULT_SEQUENCE_DEPTH = 4;

/** Path fragments that mark a node as living outside the system boundary. */
const EXTERNAL_HINTS = ['client', 'sdk', 'vendor', 'external', 'integration'] as const;

// ─── Escaping / id safety ────────────────────────────────────────────

/**
 * Characters Mermaid cannot survive inside a label, mapped to the numeric or
 * named entity Mermaid understands.
 *
 * The replacement is done in a *single* pass so that the `#` and `;` produced
 * by an entity are never re-escaped.
 */
const LABEL_ESCAPES: ReadonlyMap<string, string> = new Map([
  ['#', '#35;'],
  ['"', '#quot;'],
  ["'", '#39;'],
  ['(', '#40;'],
  [')', '#41;'],
  ['[', '#91;'],
  [']', '#93;'],
  ['{', '#123;'],
  ['}', '#125;'],
  ['<', '#lt;'],
  ['>', '#gt;'],
  [';', '#59;'],
  ['|', '#124;'],
  ['\\', '#92;'],
  ['`', '#96;'],
]);

/**
 * Make an arbitrary string safe to place inside a Mermaid node/edge label.
 *
 * All structural characters become entities, every run of whitespace (including
 * newlines and tabs, which terminate a Mermaid statement) collapses to a single
 * space, and the result is trimmed. An empty or whitespace-only input yields
 * `'unnamed'` so a label is never blank (a blank label is a parse error).
 */
export function escapeMermaidLabel(raw: string): string {
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  if (collapsed.length === 0) return 'unnamed';
  const escaped = collapsed.replace(/[#"'()[\]{}<>;|\\`]/g, ch => LABEL_ESCAPES.get(ch) ?? ch);
  return escaped.length === 0 ? 'unnamed' : escaped;
}

/**
 * Deterministic 32-bit FNV-1a, hex. Used only to disambiguate colliding ids —
 * never for security.
 */
function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** Short, stable suffix for id disambiguation. */
function shortHash(input: string): string {
  return fnv1a(input).slice(0, 6);
}

/**
 * Turn any string into a syntactically valid Mermaid identifier.
 *
 * - every character outside `[A-Za-z0-9_]` becomes `_` (runs collapse to one)
 * - a leading digit (or an empty result) is prefixed with `n_`, because Mermaid
 *   ids may not start with a digit
 *
 * The mapping is stable but **not injective** — `a/b` and `a-b` both become
 * `a_b`. When several raw ids appear in one diagram use
 * {@link createMermaidIdFactory}, which appends a hash suffix on collision
 * instead of silently merging two nodes into one.
 */
export function mermaidSafeId(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  if (cleaned.length === 0) return `n_${shortHash(raw)}`;
  return /^[0-9]/.test(cleaned) ? `n_${cleaned}` : cleaned;
}

/**
 * Allocate collision-free Mermaid ids for a single diagram.
 *
 * Calling the returned function twice with the same raw string returns the same
 * id; calling it with a different raw string that sanitises to an already-taken
 * id appends `_<hash>` (and then `_<hash>_<n>` in the pathological case), so two
 * distinct nodes can never be drawn as one.
 */
export function createMermaidIdFactory(): (raw: string) => string {
  const byRaw = new Map<string, string>();
  const taken = new Set<string>();
  return (raw: string): string => {
    const cached = byRaw.get(raw);
    if (cached !== undefined) return cached;
    const base = mermaidSafeId(raw);
    let candidate = base;
    if (taken.has(candidate)) {
      candidate = `${base}_${shortHash(raw)}`;
      let counter = 2;
      while (taken.has(candidate)) {
        candidate = `${base}_${shortHash(raw)}_${counter}`;
        counter += 1;
      }
    }
    taken.add(candidate);
    byRaw.set(raw, candidate);
    return candidate;
  };
}

// ─── Graph helpers ───────────────────────────────────────────────────

/**
 * Best-effort file path for a node: explicit `filePath`, then `location.file`,
 * then the id with its `type:` prefix removed.
 */
export function nodeFilePath(node: SprangNode): string {
  if (node.filePath !== undefined && node.filePath.length > 0) return node.filePath;
  const located = node.location?.file;
  if (located !== undefined && located.length > 0) return located;
  const colon = node.id.indexOf(':');
  return colon >= 0 ? node.id.slice(colon + 1) : node.id;
}

/**
 * Map every node to the file-level node that `contains` it (symbols → their
 * file). Nodes with no owner are "direct members" — the things actually drawn.
 */
function buildOwnerMap(graph: KnowledgeGraph): Map<string, string> {
  const byId = new Map(graph.nodes.map(n => [n.id, n] as const));
  const owner = new Map<string, string>();
  for (const edge of graph.edges) {
    if (edge.type !== 'contains') continue;
    if (edge.source === edge.target) continue;
    if (!byId.has(edge.source) || !byId.has(edge.target)) continue;
    if (!owner.has(edge.target)) owner.set(edge.target, edge.source);
  }
  // Break any cycle introduced by a malformed graph by resolving to a root once.
  const resolved = new Map<string, string>();
  for (const node of graph.nodes) {
    let current = node.id;
    const seen = new Set<string>([current]);
    for (;;) {
      const next = owner.get(current);
      if (next === undefined || seen.has(next)) break;
      seen.add(next);
      current = next;
    }
    if (current !== node.id) resolved.set(node.id, current);
  }
  return resolved;
}

interface GroupInfo {
  key: string;
  label: string;
  /** Nodes drawn as belonging to this group (file-level nodes only). */
  members: SprangNode[];
}

function directoryOf(path: string): string {
  const normalised = path.replace(/\\/g, '/');
  const slash = normalised.lastIndexOf('/');
  return slash <= 0 ? '(root)' : normalised.slice(0, slash);
}

function communityOf(node: SprangNode): string {
  const community = node.metadata?.['community'];
  return typeof community === 'string' && community.length > 0 ? community : 'unassigned';
}

/** layer id → display name, from `graph.layers`. */
function layerNames(graph: KnowledgeGraph): Map<string, string> {
  const names = new Map<string, string>();
  for (const layer of graph.layers) names.set(layer.id, layer.name.length > 0 ? layer.name : layer.id);
  return names;
}

/** node id → layer id, using `node.layer` and falling back to `layer.node_ids`. */
function layerAssignment(graph: KnowledgeGraph): Map<string, string> {
  const assignment = new Map<string, string>();
  for (const layer of graph.layers) {
    for (const nodeId of layer.node_ids) assignment.set(nodeId, layer.id);
  }
  for (const node of graph.nodes) {
    if (node.layer !== undefined && node.layer.length > 0) assignment.set(node.id, node.layer);
  }
  return assignment;
}

interface Grouping {
  /** Every node id (symbols included) → group key. */
  groupOfNode: Map<string, string>;
  /** Group key → group, drawn members only. */
  groups: Map<string, GroupInfo>;
}

function buildGrouping(graph: KnowledgeGraph, groupBy: NonNullable<MermaidOptions['groupBy']>): Grouping {
  const owners = buildOwnerMap(graph);
  const byId = new Map(graph.nodes.map(n => [n.id, n] as const));
  const layers = layerAssignment(graph);
  const names = layerNames(graph);

  const groupKeyOfDirect = (node: SprangNode): { key: string; label: string } => {
    if (groupBy === 'community') {
      const key = communityOf(node);
      return { key, label: key };
    }
    if (groupBy === 'directory') {
      const key = directoryOf(nodeFilePath(node));
      return { key, label: key };
    }
    const layerId = layers.get(node.id) ?? 'unassigned';
    return { key: layerId, label: names.get(layerId) ?? layerId };
  };

  const groups = new Map<string, GroupInfo>();
  const groupOfNode = new Map<string, string>();

  for (const node of graph.nodes) {
    if (owners.has(node.id)) continue; // symbols are attributed to their file below
    const { key, label } = groupKeyOfDirect(node);
    const existing = groups.get(key);
    if (existing === undefined) groups.set(key, { key, label, members: [node] });
    else existing.members.push(node);
    groupOfNode.set(node.id, key);
  }

  // Attribute contained symbols to their owning file's group so `calls` edges
  // aggregate into group-to-group arrows.
  for (const node of graph.nodes) {
    const ownerId = owners.get(node.id);
    if (ownerId === undefined) continue;
    const ownerGroup = groupOfNode.get(ownerId);
    if (ownerGroup !== undefined) {
      groupOfNode.set(node.id, ownerGroup);
      continue;
    }
    // Orphaned owner (edge pointing at a missing node): fall back to own path.
    const ownerNode = byId.get(ownerId) ?? node;
    const { key, label } = groupKeyOfDirect(ownerNode);
    if (!groups.has(key)) groups.set(key, { key, label, members: [] });
    groupOfNode.set(node.id, key);
  }

  for (const group of groups.values()) {
    group.members.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
  return { groupOfNode, groups };
}

interface AggregatedEdge {
  from: string;
  to: string;
  count: number;
}

/** Collapse every edge into a cross-group arrow with a count. Self-loops dropped. */
function aggregateEdges(edges: readonly SprangEdge[], groupOfNode: ReadonlyMap<string, string>): AggregatedEdge[] {
  const counts = new Map<string, AggregatedEdge>();
  for (const edge of edges) {
    if (edge.type === 'contains') continue;
    const from = groupOfNode.get(edge.source);
    const to = groupOfNode.get(edge.target);
    if (from === undefined || to === undefined || from === to) continue;
    const key = `${from}\u0000${to}`;
    const existing = counts.get(key);
    if (existing === undefined) counts.set(key, { from, to, count: 1 });
    else existing.count += 1;
  }
  return [...counts.values()].sort((a, b) =>
    a.from === b.from ? (a.to < b.to ? -1 : a.to > b.to ? 1 : 0) : a.from < b.from ? -1 : 1
  );
}

function averageRisk(members: readonly SprangNode[]): number {
  let total = 0;
  let count = 0;
  for (const member of members) {
    if (typeof member.risk_score === 'number' && Number.isFinite(member.risk_score)) {
      total += member.risk_score;
      count += 1;
    }
  }
  return count === 0 ? 0 : total / count;
}

function riskBand(score: number): 'high' | 'medium' | 'low' {
  if (score >= RISK_HIGH) return 'high';
  if (score >= RISK_MEDIUM) return 'medium';
  return 'low';
}

// ─── Architecture diagram ────────────────────────────────────────────

/**
 * Aggregated architecture diagram: one `subgraph` per layer (or community, or
 * directory), each holding a single summary node, with arrows between groups
 * labelled by how many underlying edges cross that boundary.
 *
 * Groups are ranked by cross-group degree and capped at `maxNodes` (default
 * 60). When the cap bites, a `%%` comment records how many groups were dropped
 * and on what basis, so the reader is never silently shown a partial picture.
 *
 * With `includeRisk`, groups whose mean member `risk_score` is >= 0.7 render
 * red and >= 0.4 amber; the `classDef` lines are emitted only when actually
 * applied.
 */
export function toMermaidArchitecture(graph: KnowledgeGraph, opts?: MermaidOptions): string {
  const direction = opts?.direction ?? 'TB';
  const groupBy = opts?.groupBy ?? 'layer';
  const includeRisk = opts?.includeRisk ?? false;
  const rawMax = opts?.maxNodes ?? DEFAULT_MAX_NODES;
  const maxNodes = Number.isFinite(rawMax) && rawMax > 0 ? Math.floor(rawMax) : DEFAULT_MAX_NODES;

  const lines: string[] = [`graph ${direction}`];

  if (graph.nodes.length === 0) {
    lines.push('  %% empty graph — no nodes to diagram');
    return lines.join('\n');
  }

  const { groups, groupOfNode } = buildGrouping(graph, groupBy);
  if (groups.size === 0) {
    lines.push('  %% no groups could be derived from this graph');
    return lines.join('\n');
  }

  const allEdges = aggregateEdges(graph.edges, groupOfNode);

  const degree = new Map<string, number>();
  for (const key of groups.keys()) degree.set(key, 0);
  for (const edge of allEdges) {
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + edge.count);
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + edge.count);
  }

  const ranked = [...groups.values()].sort((a, b) => {
    const da = degree.get(a.key) ?? 0;
    const db = degree.get(b.key) ?? 0;
    if (da !== db) return db - da;
    if (a.members.length !== b.members.length) return b.members.length - a.members.length;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });

  const kept = ranked.slice(0, maxNodes);
  const omitted = ranked.length - kept.length;
  if (omitted > 0) {
    lines.push(
      `  %% ${omitted} of ${ranked.length} ${groupBy} groups omitted to stay within maxNodes=${maxNodes} ` +
        `(kept the ${kept.length} with the highest cross-group edge degree)`
    );
  }

  const keptKeys = new Set(kept.map(g => g.key));
  const nextId = createMermaidIdFactory();
  const nodeIdOf = new Map<string, string>();
  const subgraphIdOf = new Map<string, string>();
  const riskOf = new Map<string, 'high' | 'medium' | 'low'>();

  const ordered = [...kept].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  for (const group of ordered) {
    subgraphIdOf.set(group.key, nextId(`sg:${group.key}`));
    nodeIdOf.set(group.key, nextId(`grp:${group.key}`));
    riskOf.set(group.key, riskBand(averageRisk(group.members)));
  }

  for (const group of ordered) {
    const sgId = subgraphIdOf.get(group.key) ?? mermaidSafeId(group.key);
    const nodeId = nodeIdOf.get(group.key) ?? mermaidSafeId(group.key);
    const memberCount = group.members.length;
    const risk = averageRisk(group.members);
    const detail = includeRisk
      ? `${memberCount} file${memberCount === 1 ? '' : 's'} · risk ${risk.toFixed(2)}`
      : `${memberCount} file${memberCount === 1 ? '' : 's'}`;
    lines.push(`  subgraph ${sgId}["${escapeMermaidLabel(group.label)}"]`);
    lines.push(`    ${nodeId}["${escapeMermaidLabel(detail)}"]`);
    lines.push('  end');
  }

  for (const edge of allEdges) {
    if (!keptKeys.has(edge.from) || !keptKeys.has(edge.to)) continue;
    const from = nodeIdOf.get(edge.from);
    const to = nodeIdOf.get(edge.to);
    if (from === undefined || to === undefined) continue;
    lines.push(`  ${from} -->|${escapeMermaidLabel(String(edge.count))}| ${to}`);
  }

  if (includeRisk) {
    const highs = ordered.filter(g => riskOf.get(g.key) === 'high');
    const mediums = ordered.filter(g => riskOf.get(g.key) === 'medium');
    if (highs.length > 0) {
      lines.push('  classDef sprangRiskHigh fill:#fecaca,stroke:#b91c1c,color:#7f1d1d');
      for (const group of highs) lines.push(`  class ${nodeIdOf.get(group.key) ?? ''} sprangRiskHigh`);
    }
    if (mediums.length > 0) {
      lines.push('  classDef sprangRiskMedium fill:#fde68a,stroke:#b45309,color:#78350f');
      for (const group of mediums) lines.push(`  class ${nodeIdOf.get(group.key) ?? ''} sprangRiskMedium`);
    }
  }

  return lines.join('\n');
}

// ─── C4 context diagram ──────────────────────────────────────────────

/** Which external-boundary hint (if any) a path suggests. */
function externalHint(path: string): string | undefined {
  const lowered = path.toLowerCase();
  for (const hint of EXTERNAL_HINTS) {
    if (lowered.includes(hint)) return hint;
  }
  return undefined;
}

/** C4 strings are plain quoted text: keep it readable, just neutralise quotes. */
function escapeC4(raw: string): string {
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  if (collapsed.length === 0) return 'unnamed';
  return collapsed.replace(/"/g, "'").replace(/\$/g, '');
}

/**
 * C4 *system context* view: each layer is a `System` inside an
 * `Enterprise_Boundary` for the project, and anything whose path suggests it
 * sits on a boundary (`client`, `sdk`, `vendor`, `external`, `integration`)
 * becomes a `System_Ext`, grouped by the hint that matched so the diagram stays
 * legible.
 */
export function toMermaidC4Context(graph: KnowledgeGraph): string {
  const projectName = graph.project_name.length > 0 ? graph.project_name : 'project';
  const lines: string[] = ['C4Context', `  title System Context — ${escapeC4(projectName)}`];

  if (graph.nodes.length === 0) {
    lines.push('  %% empty graph — no systems to diagram');
    return lines.join('\n');
  }

  const owners = buildOwnerMap(graph);
  const layers = layerAssignment(graph);
  const names = layerNames(graph);
  const nextId = createMermaidIdFactory();

  const internal = new Map<string, SprangNode[]>();
  const external = new Map<string, SprangNode[]>();
  const systemOfNode = new Map<string, string>();

  for (const node of graph.nodes) {
    if (owners.has(node.id)) continue;
    const hint = externalHint(nodeFilePath(node));
    if (hint !== undefined) {
      const key = `ext:${hint}`;
      const bucket = external.get(key);
      if (bucket === undefined) external.set(key, [node]);
      else bucket.push(node);
      systemOfNode.set(node.id, key);
      continue;
    }
    const layerId = layers.get(node.id) ?? 'unassigned';
    const key = `sys:${layerId}`;
    const bucket = internal.get(key);
    if (bucket === undefined) internal.set(key, [node]);
    else bucket.push(node);
    systemOfNode.set(node.id, key);
  }
  for (const node of graph.nodes) {
    const ownerId = owners.get(node.id);
    if (ownerId === undefined) continue;
    const ownerSystem = systemOfNode.get(ownerId);
    if (ownerSystem !== undefined) systemOfNode.set(node.id, ownerSystem);
  }

  const idOf = new Map<string, string>();
  const internalKeys = [...internal.keys()].sort();
  const externalKeys = [...external.keys()].sort();
  for (const key of [...internalKeys, ...externalKeys]) idOf.set(key, nextId(key));

  lines.push(`  Enterprise_Boundary(${nextId('boundary')}, "${escapeC4(projectName)}") {`);
  if (internalKeys.length === 0) {
    lines.push('    %% no internal systems');
  }
  for (const key of internalKeys) {
    const layerId = key.slice('sys:'.length);
    const members = internal.get(key) ?? [];
    const label = names.get(layerId) ?? layerId;
    lines.push(
      `    System(${idOf.get(key) ?? mermaidSafeId(key)}, "${escapeC4(label)}", ` +
        `"${escapeC4(`${members.length} file${members.length === 1 ? '' : 's'}`)}")`
    );
  }
  lines.push('  }');

  for (const key of externalKeys) {
    const hint = key.slice('ext:'.length);
    const members = external.get(key) ?? [];
    lines.push(
      `  System_Ext(${idOf.get(key) ?? mermaidSafeId(key)}, "${escapeC4(hint)}", ` +
        `"${escapeC4(`external boundary — ${members.length} file${members.length === 1 ? '' : 's'}`)}")`
    );
  }

  for (const edge of aggregateEdges(graph.edges, systemOfNode)) {
    const from = idOf.get(edge.from);
    const to = idOf.get(edge.to);
    if (from === undefined || to === undefined) continue;
    lines.push(`  Rel(${from}, ${to}, "${escapeC4(`${edge.count} edge${edge.count === 1 ? '' : 's'}`)}")`);
  }

  return lines.join('\n');
}

// ─── Sequence diagram ────────────────────────────────────────────────

/**
 * Follow `calls` edges out of `entryNodeId` breadth-first up to `maxDepth`
 * (default 4) and render a `sequenceDiagram`. Participants are the *containing
 * files* of the called symbols, which keeps the lane count sane; the message
 * text is the callee's label.
 */
export function toMermaidSequence(
  graph: KnowledgeGraph,
  entryNodeId: string,
  opts?: { maxDepth?: number }
): string {
  const rawDepth = opts?.maxDepth ?? DEFAULT_SEQUENCE_DEPTH;
  const maxDepth = Number.isFinite(rawDepth) && rawDepth > 0 ? Math.floor(rawDepth) : DEFAULT_SEQUENCE_DEPTH;

  const lines: string[] = ['sequenceDiagram'];
  const byId = new Map(graph.nodes.map(n => [n.id, n] as const));
  const entry = byId.get(entryNodeId);
  if (entry === undefined) {
    lines.push(`  %% entry node not found: ${escapeMermaidLabel(entryNodeId)}`);
    return lines.join('\n');
  }

  const owners = buildOwnerMap(graph);
  const participantOf = (nodeId: string): string => {
    const ownerId = owners.get(nodeId) ?? nodeId;
    const ownerNode = byId.get(ownerId);
    return ownerNode === undefined ? ownerId : nodeFilePath(ownerNode);
  };

  const callsFrom = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (edge.type !== 'calls') continue;
    if (!byId.has(edge.source) || !byId.has(edge.target)) continue;
    const list = callsFrom.get(edge.source);
    if (list === undefined) callsFrom.set(edge.source, [edge.target]);
    else list.push(edge.target);
  }
  for (const list of callsFrom.values()) list.sort();

  interface Call {
    from: string;
    to: string;
    label: string;
  }
  const calls: Call[] = [];
  const seenCall = new Set<string>();
  const visited = new Set<string>([entryNodeId]);
  let frontier: string[] = [entryNodeId];

  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
    const next: string[] = [];
    for (const sourceId of frontier) {
      for (const targetId of callsFrom.get(sourceId) ?? []) {
        const target = byId.get(targetId);
        if (target === undefined) continue;
        const key = `${sourceId}\u0000${targetId}`;
        if (!seenCall.has(key)) {
          seenCall.add(key);
          calls.push({
            from: participantOf(sourceId),
            to: participantOf(targetId),
            label: target.label.length > 0 ? target.label : targetId,
          });
        }
        if (!visited.has(targetId)) {
          visited.add(targetId);
          next.push(targetId);
        }
      }
    }
    frontier = next;
  }

  const nextId = createMermaidIdFactory();
  const participantIds = new Map<string, string>();
  const declare = (path: string): string => {
    const existing = participantIds.get(path);
    if (existing !== undefined) return existing;
    const id = nextId(`p:${path}`);
    participantIds.set(path, id);
    lines.push(`  participant ${id} as ${escapeMermaidLabel(path)}`);
    return id;
  };

  declare(participantOf(entryNodeId));
  for (const call of calls) {
    declare(call.from);
    declare(call.to);
  }

  if (calls.length === 0) {
    lines.push(`  %% no outgoing calls edges from ${escapeMermaidLabel(entryNodeId)} within depth ${maxDepth}`);
    return lines.join('\n');
  }

  for (const call of calls) {
    const from = participantIds.get(call.from);
    const to = participantIds.get(call.to);
    if (from === undefined || to === undefined) continue;
    lines.push(`  ${from}->>${to}: ${escapeMermaidLabel(call.label)}`);
  }

  return lines.join('\n');
}
