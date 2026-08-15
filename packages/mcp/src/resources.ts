/**
 * MCP resources, resource templates and argument completion for Sprang.
 *
 * WHY THIS EXISTS
 * ---------------
 * Tools are *model*-controlled: something only enters the context window if the
 * model decides to call it. Resources are *application*-controlled: the user
 * picks one from the client's `@` menu and it is attached verbatim, before the
 * model has said anything. That difference matters for Sprang specifically —
 * the health report, the architecture report and the graph statistics are
 * exactly the artefacts a person wants to hand to the model as framing for the
 * question they are about to ask, and no amount of tool-description tuning
 * makes a model reliably fetch framing it does not yet know it needs.
 *
 * Resource *templates* extend that to parameterised reads (`sprang://node/{id}`),
 * and `completion/complete` is what makes templates usable at all: without
 * completion a user must already know a node id like
 * `function:src/auth/login.ts:verifyToken` and type it by hand. Completion over
 * graph node ids is the highest-leverage completion this server can offer,
 * because the node id namespace is (a) the only argument in the whole surface
 * that is unguessable, (b) drawn from the user's own codebase rather than a
 * fixed vocabulary, and (c) shared by three of the templates and most of the
 * tools. Everything else Sprang accepts is free text or a small enum.
 *
 * DEGRADATION CONTRACT
 * --------------------
 * Every entry point here works with no graph on disk: `listResources` and
 * `listResourceTemplates` are static, `readResource` returns a readable JSON
 * error payload (never throws), and `completeNodeIds` returns an empty list.
 * A client that probes a fresh checkout must see a working, if empty, server.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { KnowledgeGraph, SprangNode } from '@sprang/core';
import { generateSuggestions } from '@sprang/core';
import type { GraphLoader } from './graph-loader.js';
import { sprangHealth } from './tools/sprang_health.js';
import { sprangNode } from './tools/sprang_node.js';
import { sprangWhy } from './tools/sprang_why.js';

// ─── Static resources ────────────────────────────────────────────────────────

export interface StaticResourceDef {
  uri: string;
  name: string;
  title: string;
  description: string;
  mimeType: string;
}

/**
 * The four whole-project artefacts worth attaching by hand.
 *
 * Listed unconditionally, even when no graph exists: a client caches
 * `resources/list` and a user who has just run `sprang scan` should not have to
 * restart the server to see them. Reading one before the graph is built
 * returns an explanatory error instead.
 */
export const STATIC_RESOURCES: readonly StaticResourceDef[] = [
  {
    uri: 'sprang://health',
    name: 'sprang-health',
    title: 'Codebase health report',
    description:
      'Health grade (A–F), score, node/edge counts, risk and smell summaries, top-10 risky nodes, orphans and circular dependencies.',
    mimeType: 'application/json',
  },
  {
    uri: 'sprang://report',
    name: 'sprang-report',
    title: 'Architecture report',
    description:
      'The generated .sprang/SPRANG_REPORT.md architecture summary, if one has been written.',
    mimeType: 'text/markdown',
  },
  {
    uri: 'sprang://graph/stats',
    name: 'sprang-graph-stats',
    title: 'Knowledge graph statistics',
    description: 'The graph stats block: node and edge counts, risk summary, smell summary.',
    mimeType: 'application/json',
  },
  {
    uri: 'sprang://suggestions',
    name: 'sprang-suggestions',
    title: 'Prioritised improvement suggestions',
    description:
      'Ranked, actionable suggestions derived from the graph: cycles, god nodes, dead code, missing tests.',
    mimeType: 'application/json',
  },
] as const;

// ─── Resource templates ──────────────────────────────────────────────────────

export interface ResourceTemplateDef {
  uriTemplate: string;
  name: string;
  title: string;
  description: string;
  mimeType: string;
}

export const RESOURCE_TEMPLATES: readonly ResourceTemplateDef[] = [
  {
    uriTemplate: 'sprang://node/{nodeId}',
    name: 'sprang-node',
    title: 'Node detail',
    description:
      'Full node payload with its 1-hop neighbourhood, layer, degrees and annotation status. nodeId is a graph id such as function:src/auth.ts:verifyToken.',
    mimeType: 'application/json',
  },
  {
    uriTemplate: 'sprang://file/{path}',
    name: 'sprang-file',
    title: 'File node and its symbols',
    description:
      'The file node for a project-relative path plus every function/class/method node contained in it.',
    mimeType: 'application/json',
  },
  {
    uriTemplate: 'sprang://why/{nodeId}',
    name: 'sprang-why',
    title: 'Why does this exist?',
    description:
      'Decision context for a node: commit history, primary authors, extracted rationale and any team annotation.',
    mimeType: 'application/json',
  },
] as const;

// ─── RFC 6570 level 1 expansion ──────────────────────────────────────────────

/**
 * Match a concrete URI against a URI template, returning the captured variables.
 *
 * LIMITATION, deliberately: this implements **RFC 6570 level 1 only** — simple
 * string expansion of `{var}`. No operators (`{+var}`, `{#var}`, `{?a,b}`,
 * `{/var}`), no explode modifier (`{var*}`), no prefix modifier (`{var:3}`),
 * no multi-variable expressions. Every template this server publishes is level
 * 1, so a full RFC 6570 implementation would be ~600 lines of dependency for
 * zero additional expressive power here. If a future template needs an
 * operator, replace this with `uri-templates` rather than growing it.
 *
 * Two Sprang-specific rules:
 *  - The **last** variable in a template is greedy to the end of the URI.
 *    Node ids contain both colons and slashes (`function:src/a.ts:doThing`) and
 *    file paths contain slashes, so a non-greedy segment match would truncate
 *    every non-trivial id.
 *  - The captured value is percent-decoded, since a well-behaved client encodes
 *    the segment it substitutes. A malformed escape decodes to itself rather
 *    than throwing.
 *
 * @returns the variable map, or `null` if the URI does not match the template.
 */
export function matchUriTemplate(
  uriTemplate: string,
  uri: string
): Record<string, string> | null {
  const varNames: string[] = [];
  let pattern = '';
  let cursor = 0;

  for (;;) {
    const open = uriTemplate.indexOf('{', cursor);
    if (open === -1) {
      pattern += escapeRegExp(uriTemplate.slice(cursor));
      break;
    }
    const close = uriTemplate.indexOf('}', open);
    if (close === -1) {
      pattern += escapeRegExp(uriTemplate.slice(cursor));
      break;
    }
    const name = uriTemplate.slice(open + 1, close);
    // Level 1 means a bare varname. Anything else is not a template we emit.
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return null;
    varNames.push(name);
    pattern += escapeRegExp(uriTemplate.slice(cursor, open));
    // Greedy `.+` — see the note above about colons and slashes in node ids.
    pattern += '(.+)';
    cursor = close + 1;
  }

  const matched = new RegExp(`^${pattern}$`, 's').exec(uri);
  if (matched === null) return null;

  const out: Record<string, string> = {};
  for (let i = 0; i < varNames.length; i += 1) {
    const key = varNames[i];
    const raw = matched[i + 1];
    if (key === undefined || raw === undefined) return null;
    out[key] = safeDecode(raw);
  }
  return out;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** `decodeURIComponent` throws on a lone `%`; a URI we cannot decode is used as-is. */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

// ─── Listing ─────────────────────────────────────────────────────────────────

export function listResources(): { resources: StaticResourceDef[] } {
  return { resources: [...STATIC_RESOURCES] };
}

export function listResourceTemplates(): { resourceTemplates: ResourceTemplateDef[] } {
  return { resourceTemplates: [...RESOURCE_TEMPLATES] };
}

// ─── Reading ─────────────────────────────────────────────────────────────────

export interface ResourceContents {
  uri: string;
  mimeType: string;
  text: string;
}

export interface ReadResourceResult {
  contents: ResourceContents[];
  /** The SDK's result type is open (`_meta`, task fields); mirror that. */
  [key: string]: unknown;
}

function jsonContents(uri: string, value: unknown): ReadResourceResult {
  return {
    contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(value, null, 2) }],
  };
}

/**
 * A read failure is returned as content, not thrown.
 *
 * A protocol-level error makes the client show "resource unavailable" and drop
 * the attachment; a JSON body carrying `code` and `remedy` reaches the user (and
 * the model) and says what to run. Missing graph is the normal state of a fresh
 * checkout, not an exceptional one.
 */
function errorContents(uri: string, error: Record<string, unknown>): ReadResourceResult {
  return jsonContents(uri, error);
}

/** Resolve a file node by bare path or `file:`-prefixed id. */
function resolveFileNode(nodes: readonly SprangNode[], path: string): SprangNode | undefined {
  const bare = path.startsWith('file:') ? path.slice(5) : path;
  return (
    nodes.find((n) => n.id === `file:${bare}`) ??
    nodes.find((n) => n.id === bare) ??
    nodes.find((n) => n.type === 'file' && n.filePath === bare)
  );
}

/**
 * Symbols belonging to a file: anything the file `contains` per the edge list,
 * plus id-prefix matches (`function:<path>:name`) for graphs whose Phase 1 did
 * not emit containment edges. Union, because different scanners populate
 * different halves and a partial symbol list is the failure a user notices.
 */
function symbolsForFile(graph: KnowledgeGraph, fileNode: SprangNode): SprangNode[] {
  const nodes = graph.nodes ?? [];
  const path = fileNode.filePath ?? fileNode.id.replace(/^file:/, '');
  const ids = new Set<string>();

  for (const edge of graph.edges ?? []) {
    if (edge.source === fileNode.id && edge.type === 'contains') ids.add(edge.target);
  }
  for (const node of nodes) {
    if (node.id === fileNode.id) continue;
    if (node.id.includes(`:${path}:`) || node.id.endsWith(`:${path}`)) ids.add(node.id);
  }

  return nodes
    .filter((n) => ids.has(n.id) && n.id !== fileNode.id)
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Serve one resource URI, static or templated.
 *
 * `sprangRoot` is needed for the two reads that touch the filesystem directly
 * (`sprang://report` and the annotation lookup inside `sprang_why`).
 */
export async function readResource(
  loader: GraphLoader,
  sprangRoot: string,
  uri: string
): Promise<ReadResourceResult> {
  // ── Static ────────────────────────────────────────────────────────────────
  if (uri === 'sprang://health') {
    return jsonContents(uri, await sprangHealth(loader, {}));
  }

  if (uri === 'sprang://report') {
    const reportPath = join(sprangRoot, '.sprang', 'SPRANG_REPORT.md');
    try {
      const text = await readFile(reportPath, 'utf-8');
      return { contents: [{ uri, mimeType: 'text/markdown', text }] };
    } catch {
      return {
        contents: [
          {
            uri,
            mimeType: 'text/markdown',
            text:
              `# No Sprang report\n\nNo architecture report was found at \`${reportPath}\`.\n\n` +
              'Run `sprang scan` (or `/sprang-analyze`) to generate one.\n',
          },
        ],
      };
    }
  }

  if (uri === 'sprang://graph/stats') {
    const graph = await loader.getGraph();
    if (graph === null) return errorContents(uri, { ...loader.getError() });
    return jsonContents(uri, graph.stats ?? { note: 'This graph carries no stats block.' });
  }

  if (uri === 'sprang://suggestions') {
    const graph = await loader.getGraph();
    if (graph === null) return errorContents(uri, { ...loader.getError() });
    const suggestions = generateSuggestions({ nodes: graph.nodes ?? [], edges: graph.edges ?? [] });
    return jsonContents(uri, { count: suggestions.length, suggestions });
  }

  // ── Templated ─────────────────────────────────────────────────────────────
  const nodeMatch = matchUriTemplate('sprang://node/{nodeId}', uri);
  if (nodeMatch !== null && nodeMatch['nodeId'] !== undefined) {
    return jsonContents(uri, await sprangNode(loader, { node_id: nodeMatch['nodeId'] }));
  }

  const whyMatch = matchUriTemplate('sprang://why/{nodeId}', uri);
  if (whyMatch !== null && whyMatch['nodeId'] !== undefined) {
    return jsonContents(
      uri,
      await sprangWhy(loader, { node_id: whyMatch['nodeId'] }, sprangRoot)
    );
  }

  const fileMatch = matchUriTemplate('sprang://file/{path}', uri);
  if (fileMatch !== null && fileMatch['path'] !== undefined) {
    const path = fileMatch['path'];
    const graph = await loader.getGraph();
    if (graph === null) return errorContents(uri, { ...loader.getError() });
    const fileNode = resolveFileNode(graph.nodes ?? [], path);
    if (fileNode === undefined) {
      return errorContents(uri, {
        error: 'File node not found',
        code: 'NODE_NOT_FOUND',
        path,
        remedy: 'Use a project-relative path that exists in the graph, e.g. src/index.ts.',
      });
    }
    const symbols = symbolsForFile(graph, fileNode);
    return jsonContents(uri, {
      file: fileNode,
      symbol_count: symbols.length,
      symbols,
    });
  }

  return errorContents(uri, {
    error: `Unknown resource URI: ${uri}`,
    code: 'UNKNOWN_RESOURCE',
    remedy:
      'Use one of ' +
      STATIC_RESOURCES.map((r) => r.uri).join(', ') +
      ' or a template: ' +
      RESOURCE_TEMPLATES.map((t) => t.uriTemplate).join(', ') +
      '.',
  });
}

// ─── Completion ──────────────────────────────────────────────────────────────

/** The spec caps a single completion response at 100 values. */
export const COMPLETION_LIMIT = 100;

export interface CompletionResult {
  completion: {
    values: string[];
    total: number;
    hasMore: boolean;
  };
  /** The SDK's result type is open (`_meta`, task fields); mirror that. */
  [key: string]: unknown;
}

const EMPTY_COMPLETION: CompletionResult = {
  completion: { values: [], total: 0, hasMore: false },
};

/** Which template variables we can complete, keyed by template URI. */
const COMPLETABLE_ARGS: Record<string, string> = {
  'sprang://node/{nodeId}': 'nodeId',
  'sprang://why/{nodeId}': 'nodeId',
  'sprang://file/{path}': 'path',
};

/**
 * Rank candidates deterministically: shorter first, then alphabetically.
 *
 * Shorter-first is a proxy for "closer to what was typed" — with a shared
 * prefix, the shortest completion is the one with the least unmatched tail —
 * and the alphabetical tiebreak means two identical requests always produce
 * byte-identical output. Clients cache and diff these lists; a stable order is
 * the difference between a menu that settles and one that flickers.
 */
function rank(values: string[]): string[] {
  return values.sort((a, b) => (a.length !== b.length ? a.length - b.length : a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Complete a node id (or file path) against the ids present in the graph.
 *
 * Prefix matches first, because a user typing `func` means the prefix. If
 * fewer than ten of those exist, substring matches are folded in — node ids are
 * long and prefixed by kind (`function:`, `class:`), so the fragment a user
 * actually remembers is nearly always in the middle.
 *
 * Returns an empty completion, never an error, when no graph exists.
 */
export async function completeNodeIds(
  loader: GraphLoader,
  value: string,
  candidateFilter?: (node: SprangNode) => boolean
): Promise<CompletionResult> {
  const graph = await loader.getGraph();
  if (graph === null) return EMPTY_COMPLETION;

  const nodes = graph.nodes ?? [];
  const pool: string[] = [];
  for (const node of nodes) {
    if (candidateFilter !== undefined && !candidateFilter(node)) continue;
    pool.push(node.id);
  }
  if (pool.length === 0) return EMPTY_COMPLETION;

  const needle = value.toLowerCase();
  let matches: string[];

  if (needle === '') {
    matches = rank([...new Set(pool)]);
  } else {
    const prefix = rank(pool.filter((id) => id.toLowerCase().startsWith(needle)));
    if (prefix.length >= 10) {
      matches = prefix;
    } else {
      const seen = new Set(prefix);
      const substring = rank(
        pool.filter((id) => !seen.has(id) && id.toLowerCase().includes(needle))
      );
      matches = [...prefix, ...substring];
    }
  }

  const total = matches.length;
  return {
    completion: {
      values: matches.slice(0, COMPLETION_LIMIT),
      total,
      hasMore: total > COMPLETION_LIMIT,
    },
  };
}

export interface CompletionRequestParams {
  ref: { type: string; uri?: string; name?: string };
  argument: { name: string; value: string };
}

/**
 * Handle a `completion/complete` request for the resource templates above.
 *
 * Unknown refs, unknown templates and unknown argument names all resolve to an
 * empty completion rather than an error: a client probing what a server can
 * complete should get a boring answer, not a red banner.
 */
export async function complete(
  loader: GraphLoader,
  params: CompletionRequestParams
): Promise<CompletionResult> {
  if (params.ref.type !== 'ref/resource') return EMPTY_COMPLETION;
  const uri = params.ref.uri;
  if (uri === undefined) return EMPTY_COMPLETION;

  const expectedArg = COMPLETABLE_ARGS[uri];
  if (expectedArg === undefined) return EMPTY_COMPLETION;
  if (params.argument.name !== expectedArg) return EMPTY_COMPLETION;

  // `sprang://file/{path}` addresses file nodes only, and by bare path — an id
  // like `file:src/a.ts` is not a valid substitution for `{path}`.
  if (expectedArg === 'path') {
    const graph = await loader.getGraph();
    if (graph === null) return EMPTY_COMPLETION;
    const needle = params.argument.value.toLowerCase();
    const paths = (graph.nodes ?? [])
      .filter((n) => n.type === 'file')
      .map((n) => n.filePath ?? n.id.replace(/^file:/, ''));
    const unique = [...new Set(paths)];
    const prefix = rank(unique.filter((p) => p.toLowerCase().startsWith(needle)));
    let matches: string[];
    if (needle === '') matches = rank(unique);
    else if (prefix.length >= 10) matches = prefix;
    else {
      const seen = new Set(prefix);
      matches = [
        ...prefix,
        ...rank(unique.filter((p) => !seen.has(p) && p.toLowerCase().includes(needle))),
      ];
    }
    const total = matches.length;
    return {
      completion: {
        values: matches.slice(0, COMPLETION_LIMIT),
        total,
        hasMore: total > COMPLETION_LIMIT,
      },
    };
  }

  return completeNodeIds(loader, params.argument.value);
}
