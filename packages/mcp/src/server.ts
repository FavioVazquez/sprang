import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
  CompleteRequestSchema,
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { join } from 'node:path';
import {
  complete,
  listResources,
  listResourceTemplates,
  readResource,
} from './resources.js';
import {
  ResourceSubscriptionManager,
  ProgressReporter,
  progressTokenOf,
  elicitAnnotationContent,
  elicitReviewProceed,
  highRiskUnreadFiles,
  type ReviewLike,
} from './notifications.js';
import { GraphLoader } from './graph-loader.js';
import { sprangQuery } from './tools/sprang_query.js';
import type { SprangQueryInput } from './tools/sprang_query.js';
import { sprangNode } from './tools/sprang_node.js';
import { sprangDiffImpact } from './tools/sprang_diff_impact.js';
import { sprangTour } from './tools/sprang_tour.js';
import type { SprangTourInput } from './tools/sprang_tour.js';
import { sprangDomain } from './tools/sprang_domain.js';
import type { SprangDomainInput } from './tools/sprang_domain.js';
import { sprangHealth } from './tools/sprang_health.js';
import { sprangWhy } from './tools/sprang_why.js';
import { sprangCoupled } from './tools/sprang_coupled.js';
import { sprangTraps } from './tools/sprang_traps.js';
import { sprangOwners } from './tools/sprang_owners.js';
import { sprangReview } from './tools/sprang_review.js';
import { sprangContext } from './tools/sprang_context.js';
import { ReadLog } from './receipt.js';
import { projectNode, type DetailLevel } from '@sprang/core';
import { sprangAnnotate } from './tools/sprang_annotate.js';
import type { SprangAnnotateInput } from './tools/sprang_annotate.js';
import { sprangRespond } from './tools/sprang_respond.js';
import type { SprangRespondInput } from './tools/sprang_respond.js';
import {
  SPRANG_QUERY_OUTPUT,
  SPRANG_NODE_OUTPUT,
  SPRANG_DIFF_IMPACT_OUTPUT,
  SPRANG_TOUR_OUTPUT,
  SPRANG_DOMAIN_OUTPUT,
  SPRANG_HEALTH_OUTPUT,
  SPRANG_WHY_OUTPUT,
  SPRANG_COUPLED_OUTPUT,
  SPRANG_TRAPS_OUTPUT,
  SPRANG_OWNERS_OUTPUT,
  SPRANG_REVIEW_OUTPUT,
  SPRANG_CONTEXT_OUTPUT,
  SPRANG_ANNOTATE_OUTPUT,
  SPRANG_RESPOND_OUTPUT,
} from './schemas.js';

// `||`, not `??`: Devin substitutes an unset ${...} in an MCP env value with an
// EMPTY STRING rather than leaving it unset, so `??` would keep "" and every
// graph path would resolve against the filesystem root instead of the project.
const sprangRoot = process.env['SPRANG_ROOT'] || process.cwd();
const loader = new GraphLoader(sprangRoot);
// Records which nodes this session actually looked at, so `sprang_review` can
// later report what the agent never opened. See receipt.ts.

/**
 * Collect every graph node the agent has just been shown.
 *
 * Done once over the serialised result rather than per tool: a per-tool hook
 * would need updating every time a tool is added, and the one that gets
 * forgotten is the one that silently under-reports coverage — which would make
 * `sprang_review` claim gaps that do not exist.
 */

/**
 * Apply a detail level to whatever a tool returned.
 *
 * Done once over the result tree rather than inside each tool, for the same
 * reason read receipts and truncation are: fourteen tools with fourteen
 * implementations means the one that gets forgotten silently returns
 * everything, and the caller has no way to tell which.
 *
 * Node-shaped objects are recognised by an `id` matching the graph's id
 * grammar. Anything else is left exactly as it was — a health summary or a
 * guidance string is not a node and must not be projected away.
 *
 * The argument for doing this at all: models measurably degrade as context
 * grows even inside their nominal window, so returning less is not merely
 * cheaper, it improves answers. `summary` is the default in the schema for
 * that reason, and a caller that wants everything asks for `full`.
 */
const NODE_ID = /^(file|function|class|module|concept|config|service|table|endpoint|pipeline|schema|resource):/;

function applyDetail(value: unknown, level: DetailLevel, depth = 0): unknown {
  if (level === 'full' || depth > 8 || value === null || value === undefined) return value;

  if (Array.isArray(value)) {
    return value.map((item) => applyDetail(item, level, depth + 1));
  }
  if (typeof value !== 'object') return value;

  const record = value as Record<string, unknown>;
  const id = record['id'];
  if (typeof id === 'string' && NODE_ID.test(id) && typeof record['type'] === 'string') {
    return projectNode(record as never, level);
  }

  // Some tools return rows that reference a node rather than embedding one —
  // `sprang_context` items and `sprang_diff_impact` entries use `node_id`.
  // Passing those to projectNode would produce `{id: undefined}`, so they get
  // an equivalent field policy here. Without this branch `detail` would appear
  // to be supported on those tools and quietly do nothing, which is worse than
  // not offering it.
  const nodeId = record['node_id'];
  if (typeof nodeId === 'string' && NODE_ID.test(nodeId)) {
    if (level === 'ids') return { node_id: nodeId };
    const KEEP_SUMMARY = new Set([
      'node_id', 'path', 'kind', 'type', 'label', 'score', 'risk_score', 'found_by',
    ]);
    const KEEP_SKELETON = new Set([
      ...KEEP_SUMMARY, 'risk_factors', 'hops_from_seed', 'path_confidence', 'reason', 'hops',
    ]);
    const keep = level === 'summary' ? KEEP_SUMMARY : KEEP_SKELETON;
    const projected: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(record)) {
      if (keep.has(key)) projected[key] = child;
    }
    return projected;
  }

  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(record)) {
    out[key] = applyDetail(child, level, depth + 1);
  }
  return out;
}

function collectNodeIds(value: unknown, out: Set<string>, depth = 0): void {
  if (depth > 8 || value === null || value === undefined) return;
  if (typeof value === 'string') {
    if (/^(file|function|class):/.test(value)) out.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectNodeIds(item, out, depth + 1);
    return;
  }
  if (typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      // `path`/`file` fields carry bare paths that are still reads.
      if ((key === 'path' || key === 'file') && typeof child === 'string' && child.includes('.')) {
        out.add(child);
      }
      collectNodeIds(child, out, depth + 1);
    }
  }
}

const readLog = new ReadLog(sprangRoot, `${process.pid}-${Date.now()}`);

// Injected at build time by tsup `define` (see tsup.config.ts) so it always
// matches package.json. Falls back to a dev sentinel when run un-bundled via tsx.
declare const __SPRANG_VERSION__: string;
const VERSION = typeof __SPRANG_VERSION__ !== 'undefined' ? __SPRANG_VERSION__ : '0.0.0-dev';

const server = new Server(
  {
    name: 'sprang',
    version: VERSION,
  },
  {
    capabilities: {
      tools: {},
      // Resources are application-controlled: a user attaches one from the `@`
      // menu without the model deciding anything. `listChanged: true` says the
      // list can change (it does — a `sprang scan` adds the report), so a client
      // knows to re-list rather than caching the first answer forever.
      //
      // `subscribe: true` is what lets a client ask to be *told* when a resource
      // it holds has changed, instead of being warned once at session start that
      // the graph might be stale. See notifications.ts: the subscription
      // replaces the SessionStart staleness hook rather than duplicating it —
      // running both leaves a stale text warning in the context window
      // contradicting a fresh push notification.
      resources: { subscribe: true, listChanged: true },
      // Declared empty, as the spec requires: presence is the signal that
      // `completion/complete` is supported. Without it clients never probe, and
      // the node-id autocomplete below is dead code.
      completions: {},
    },
  }
);

/**
 * Annotation presets.
 *
 * `annotations` are HINTS. The spec is explicit that a client may ignore them,
 * and a client must never treat them as a security boundary — nothing stops a
 * server from lying. They exist so a client can present the tool honestly and,
 * more usefully, so a team can write an allowlist policy that means something.
 *
 * `readOnlyHint: true` plus `openWorldHint: false` is the pair that matters
 * here: it says this tool does not modify its environment AND does not reach
 * outside a closed, local domain (Sprang reads `.sprang/` and the local git
 * history — no network, no external service). That combination is precisely
 * what lets a security-conscious team auto-approve the twelve read tools while
 * still requiring a prompt for anything that writes. Getting these wrong in the
 * unsafe direction — marking a writer read-only — would silently widen whatever
 * auto-approval the user has configured, so the contract test asserts them.
 */
const READ_ONLY = {
  readOnlyHint: true,
  openWorldHint: false,
} as const;

/**
 * The two writers. Both only ever create or overwrite a file under `.sprang/`
 * that Sprang itself owns, so `destructiveHint: false` is accurate: no existing
 * user content is removed. `idempotentHint: false` because each call stamps a
 * fresh timestamp (and `sprang_respond` appends to the conversation log), so
 * repeating a call is not a no-op.
 */
const WRITES_ADDITIVELY = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;

const TOOLS = [
  {
    name: 'sprang_query',
    description:
      'Search the knowledge graph for nodes matching a query string. Returns nodes whose label or summary contains the query, sorted by match quality.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Search query string',
        },
        node_types: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Optional filter by node types (e.g. ["function", "class", "service"])',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return (default 10)',
        },
        mode: {
          type: 'string',
          enum: ['keyword', 'semantic'],
          description: 'Search mode: "keyword" for TF-IDF text match (default), "semantic" for embedding-based similarity search.',
        },
              detail: {
          type: 'string',
          enum: ['ids', 'summary', 'skeleton', 'full'],
          description:
            'How much of each node to return. Defaults to full for backward compatibility; ' +
            'prefer summary or skeleton to keep the context window for reasoning.',
        },
      },
      required: ['query'],
    },
    outputSchema: SPRANG_QUERY_OUTPUT,
    annotations: { title: 'Search the graph', ...READ_ONLY },
  },
  {
    name: 'sprang_node',
    description:
      'Retrieve a specific node by ID, including its full details and 1-hop neighborhood (immediate neighbors in both directions).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        node_id: {
          type: 'string',
          description: 'The unique node identifier (e.g. a file path or function id)',
        },
              detail: {
          type: 'string',
          enum: ['ids', 'summary', 'skeleton', 'full'],
          description:
            'How much of each node to return. Defaults to full for backward compatibility; ' +
            'prefer summary or skeleton to keep the context window for reasoning.',
        },
      },
      required: ['node_id'],
    },
    outputSchema: SPRANG_NODE_OUTPUT,
    annotations: { title: 'Node detail and neighbours', ...READ_ONLY },
  },
  {
    name: 'sprang_diff_impact',
    description:
      'Compute the blast radius of a set of changed files. Performs BFS over incoming edges to find all dependent nodes. Returns changed nodes, impact nodes sorted by risk, and risk counts.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        files: {
          type: 'array',
          items: { type: 'string' },
          description:
            'List of changed file paths (project-relative), e.g. ["src/auth/login.ts"]',
        },
              detail: {
          type: 'string',
          enum: ['ids', 'summary', 'skeleton', 'full'],
          description:
            'How much of each node to return. Defaults to full for backward compatibility; ' +
            'prefer summary or skeleton to keep the context window for reasoning.',
        },
      },
      required: ['files'],
    },
    outputSchema: SPRANG_DIFF_IMPACT_OUTPUT,
    annotations: { title: 'Blast radius', ...READ_ONLY },
  },
  {
    name: 'sprang_tour',
    description:
      'Return a guided architecture tour of the codebase. Supports personas: junior (all steps + language lessons), senior/experienced (skip intro, technical focus), pm (domain/service nodes, business process focus), non-technical (entry-points and domains only, no code details).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tour_id: {
          type: 'string',
          description: 'Specific tour ID to load. If omitted, returns the first tour.',
        },
        persona: {
          type: 'string',
          enum: ['junior', 'senior', 'experienced', 'pm', 'non-technical'],
          description:
            'Filter tour steps by audience. junior=all steps, senior/experienced=skip intro, pm=domain/service only, non-technical=entry-points and domains only.',
        },
              detail: {
          type: 'string',
          enum: ['ids', 'summary', 'skeleton', 'full'],
          description:
            'How much of each node to return. Defaults to full for backward compatibility; ' +
            'prefer summary or skeleton to keep the context window for reasoning.',
        },
      },
      required: [],
    },
    outputSchema: SPRANG_TOUR_OUTPUT,
    annotations: { title: 'Guided architecture tour', ...READ_ONLY },
  },
  {
    name: 'sprang_domain',
    description:
      'Explore business domain mappings. Without arguments, lists all domains. With domain_name, returns that domain\'s flows and steps in detail.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        domain_name: {
          type: 'string',
          description: 'Name or ID of the domain to inspect (case-insensitive). Omit to list all.',
        },
              detail: {
          type: 'string',
          enum: ['ids', 'summary', 'skeleton', 'full'],
          description:
            'How much of each node to return. Defaults to full for backward compatibility; ' +
            'prefer summary or skeleton to keep the context window for reasoning.',
        },
      },
      required: [],
    },
    outputSchema: SPRANG_DOMAIN_OUTPUT,
    annotations: { title: 'Business domains', ...READ_ONLY },
  },
  {
    name: 'sprang_health',
    description:
      'Return a comprehensive health report: health grade (A–F), score (0–100), node/edge counts, risk summary, smell summary, security summary, top 10 risky nodes, orphan count, circular dependency count, nodes without tests, and run history (last 30 snapshots).',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
    outputSchema: SPRANG_HEALTH_OUTPUT,
    annotations: { title: 'Codebase health report', ...READ_ONLY },
  },
  {
    name: 'sprang_why',
    description:
      'Explain why a node exists: returns decision_context (commit history, authors, rationale) and any team annotation file for the node.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        node_id: {
          type: 'string',
          description: 'The node ID to look up the decision context for.',
        },
              detail: {
          type: 'string',
          enum: ['ids', 'summary', 'skeleton', 'full'],
          description:
            'How much of each node to return. Defaults to full for backward compatibility; ' +
            'prefer summary or skeleton to keep the context window for reasoning.',
        },
      },
      required: ['node_id'],
    },
    outputSchema: SPRANG_WHY_OUTPUT,
    annotations: { title: 'Why does this exist?', ...READ_ONLY },
  },
  {
    name: 'sprang_coupled',
    description:
      'Files that historically change together with this file, from git history. Surfaces HIDDEN couplings: ' +
      'files with no import or call path between them that nonetheless change together. Static analysis cannot ' +
      'find these. Call before considering a change complete.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        file: {
          type: 'string',
          description: 'File path (or file:<path> node id) to find co-changing files for.',
        },
        since_months: {
          type: 'number',
          description: 'Months of history to consider. Defaults to 12.',
        },
        limit: { type: 'number', description: 'Maximum couplings to return. Defaults to 10.' },
      },
      required: ['file'],
    },
    outputSchema: SPRANG_COUPLED_OUTPUT,
    annotations: { title: 'Change coupling', ...READ_ONLY },
  },
  {
    name: 'sprang_traps',
    description:
      'Past changes to this code that were reverted or urgently fixed. Read before editing a file so the ' +
      'same mistake is not repeated. Omit `file` for a repository-wide report.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        file: { type: 'string', description: 'File path or file:<path>. Omit for the whole repo.' },
        since_months: { type: 'number', description: 'History window. Defaults to 12.' },
        limit: { type: 'number', description: 'Maximum entries. Defaults to 15.' },
      },
      required: [],
    },
    outputSchema: SPRANG_TRAPS_OUTPUT,
    annotations: { title: 'Past traps in this code', ...READ_ONLY },
  },
  {
    name: 'sprang_owners',
    description:
      'Who actually knows this file: recency-weighted ownership shares, main developer, bus factor, ' +
      'knowledge diffusion and minor-contributor count. Use to pick a reviewer or to spot a bus factor of 1.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        file: { type: 'string', description: 'File path or file:<path> node id.' },
        since_months: { type: 'number', description: 'History window. Defaults to 24.' },
      },
      required: ['file'],
    },
    outputSchema: SPRANG_OWNERS_OUTPUT,
    annotations: { title: 'Who knows this code', ...READ_ONLY },
  },
  {
    name: 'sprang_review',
    description:
      'Check whether a change is COMPLETE. Compares the blast radius of the changed files against the nodes ' +
      'this session actually read, and reports impacted files that were never opened, riskiest first. ' +
      'Call before declaring work finished.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        changed_files: {
          type: 'array',
          items: { type: 'string' },
          description: 'Files the change touches (paths or file:<path> ids).',
        },
        depth: { type: 'number', description: 'Blast-radius hops to consider. Defaults to 2.' },
              detail: {
          type: 'string',
          enum: ['ids', 'summary', 'skeleton', 'full'],
          description:
            'How much of each node to return. Defaults to full for backward compatibility; ' +
            'prefer summary or skeleton to keep the context window for reasoning.',
        },
      },
      required: ['changed_files'],
    },
    outputSchema: SPRANG_REVIEW_OUTPUT,
    annotations: { title: 'Is this change complete?', ...READ_ONLY },
  },
  {
    name: 'sprang_context',
    description:
      'Choose what to read for a task, within a token budget. Merges exact-symbol, keyword, dependency-graph ' +
      'and change-history channels, reranks by PageRank, and returns ranked items each labelled with the ' +
      'channels that found it. Call FIRST on an unfamiliar area instead of grepping.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        task: { type: 'string', description: 'What you are trying to do, in your own words.' },
        budget_tokens: { type: 'number', description: 'Token ceiling. Defaults to 8000.' },
        seed_files: {
          type: 'array',
          items: { type: 'string' },
          description: 'Files already open or being edited. Strong relevance prior.',
        },
        mentioned_idents: {
          type: 'array',
          items: { type: 'string' },
          description: 'Specific identifiers named in the task.',
        },
        limit: { type: 'number', description: 'Maximum items. Defaults to 40.' },
              detail: {
          type: 'string',
          enum: ['ids', 'summary', 'skeleton', 'full'],
          description:
            'How much of each node to return. Defaults to full for backward compatibility; ' +
            'prefer summary or skeleton to keep the context window for reasoning.',
        },
      },
      required: ['task'],
    },
    outputSchema: SPRANG_CONTEXT_OUTPUT,
    annotations: { title: 'What to read for this task', ...READ_ONLY },
  },
  {
    name: 'sprang_annotate',
    description:
      'Write a team annotation for a node. Creates or overwrites `.sprang/annotations/<node-id>.md` with YAML frontmatter and the provided content.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        node_id: {
          type: 'string',
          description: 'The node ID to annotate.',
        },
        content: {
          type: 'string',
          description:
            'Markdown content for the annotation body. If omitted and the client supports ' +
            'elicitation, the user is asked for it — an annotation is knowledge a person has ' +
            'and the graph does not, so inventing one is worse than asking.',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional tags for the annotation.',
        },
      },
      // `content` is no longer required: omitting it is the signal to elicit.
      // Clients that always send it are unaffected — relaxing a requirement
      // cannot break a caller that already satisfies it.
      required: ['node_id'],
    },
    outputSchema: SPRANG_ANNOTATE_OUTPUT,
    annotations: { title: 'Write a team annotation', ...WRITES_ADDITIVELY },
  },
  {
    name: 'sprang_respond',
    description:
      'Write a response to .sprang/cascade-response.json so the Sprang dashboard can display it. Use this after answering a question triggered via the dashboard Ask Agent feature.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        response: {
          type: 'string',
          description: 'The response text to send back to the dashboard.',
        },
        question: {
          type: 'string',
          description: 'Optional: the original question being answered.',
        },
      },
      required: ['response'],
    },
    outputSchema: SPRANG_RESPOND_OUTPUT,
    annotations: { title: 'Answer a dashboard question', ...WRITES_ADDITIVELY },
  },
];

/**
 * Beyond this, the client starts cutting the result for us.
 *
 * Claude Code warns above roughly 10k tokens and hard-truncates above 25k, and
 * other clients have their own limits; 60k characters is a conservative ceiling
 * that sits under the strictest of them once JSON punctuation is counted.
 *
 * The point is not the exact number. It is that being truncated arbitrarily is
 * strictly worse than truncating deliberately: an arbitrary cut lands mid-token
 * and produces invalid JSON, drops the tail of a risk-sorted list with no
 * indication that anything is missing, and leaves the agent believing it has
 * seen the whole answer. Cutting it ourselves keeps the payload parseable,
 * keeps the highest-value head of every sorted list (all of them are sorted
 * worst-first), and — crucially — says so in `_truncated`, so the agent knows
 * to narrow the query instead of concluding there was nothing more to find.
 */
export const MAX_RESULT_CHARS = 60_000;

export interface TruncationMarker {
  field: string;
  shown: number;
  total: number;
  hint: string;
}

/**
 * Shrink an oversized result by trimming its single largest array field.
 *
 * One field, not all of them: every Sprang result has exactly one list that
 * dominates its size (impact_nodes, items, traps, neighbors…), and the scalar
 * summary fields around it are the part an agent gates on. Trimming the list
 * and keeping the counts intact means `total_impact` still reports the true
 * number even when only part of the list is shown.
 */
export function truncateOversizedResult(result: unknown): unknown {
  if (result === null || typeof result !== 'object' || Array.isArray(result)) return result;

  const serialised = JSON.stringify(result);
  if (typeof serialised !== 'string' || serialised.length <= MAX_RESULT_CHARS) return result;

  const record = { ...(result as Record<string, unknown>) };

  let field: string | null = null;
  let fieldChars = -1;
  for (const [key, value] of Object.entries(record)) {
    if (!Array.isArray(value) || value.length === 0) continue;
    const chars = JSON.stringify(value)?.length ?? 0;
    if (chars > fieldChars) {
      field = key;
      fieldChars = chars;
    }
  }
  // Nothing array-shaped to trim: a single enormous string, say. Better to hand
  // it over whole and let the client do what it does than to mangle it here.
  if (field === null) return result;

  const full = record[field] as unknown[];
  const total = full.length;
  const overhead = serialised.length - fieldChars;

  let shown = total;
  while (shown > 0) {
    const chars = JSON.stringify(full.slice(0, shown))?.length ?? 0;
    if (overhead + chars <= MAX_RESULT_CHARS) break;
    // Geometric backoff, with a floor of one element per step so it terminates.
    const next = Math.floor(shown * 0.9);
    shown = next < shown ? next : shown - 1;
  }

  record[field] = full.slice(0, shown);
  record['_truncated'] = {
    field,
    shown,
    total,
    hint:
      `Result exceeded ${MAX_RESULT_CHARS} characters, so '${field}' was cut to the first ` +
      `${shown} of ${total} entries (the list is ordered most-important-first). ` +
      `Narrow the query — a smaller limit, fewer files, or a shorter history window — to see the rest.`,
  } satisfies TruncationMarker;

  return record;
}

/** Exported for the contract test; the handler below is the only other caller. */
export function listTools(): { tools: typeof TOOLS } {
  return { tools: TOOLS };
}

export { TOOLS };

server.setRequestHandler(ListToolsRequestSchema, async () => {
  // Returned in a fixed order, straight from the TOOLS literal. Clients cache
  // the tool list and some key their prompt on its order, so it must not vary
  // between calls.
  return listTools();
});

server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
  const { name, arguments: args } = request.params;
  const input = (args ?? {}) as Record<string, unknown>;

  // Progress is opt-in per call: no `_meta.progressToken`, no notifications.
  // `ProgressReporter` swallows every call when the token is absent, so the
  // tool bodies below do not need to branch on it.
  const progress = ProgressReporter.from(progressTokenOf(request.params._meta), (params) =>
    extra.sendNotification({ method: 'notifications/progress', params })
  );
  // Set only by tools that report real phase boundaries; drives the final
  // "complete" tick after projection and truncation, which are the last work
  // done on the caller's behalf.
  let progressTotal: number | undefined;

  try {
    let result: unknown;

    switch (name) {
      case 'sprang_query': {
        const queryInput: SprangQueryInput = { query: input['query'] as string };
        if (input['node_types'] !== undefined) {
          queryInput.node_types = input['node_types'] as string[];
        }
        if (input['limit'] !== undefined) {
          queryInput.limit = input['limit'] as number;
        }
        if (input['mode'] !== undefined) {
          queryInput.mode = input['mode'] as 'keyword' | 'semantic';
        }
        result = await sprangQuery(loader, queryInput);
        break;
      }

      case 'sprang_node': {
        result = await sprangNode(loader, {
          node_id: input['node_id'] as string,
        });
        break;
      }

      case 'sprang_diff_impact': {
        result = await sprangDiffImpact(loader, {
          files: input['files'] as string[],
        });
        break;
      }

      case 'sprang_tour': {
        const tourInput: SprangTourInput = {};
        if (input['tour_id'] !== undefined) {
          tourInput.tour_id = input['tour_id'] as string;
        }
        if (input['persona'] !== undefined) {
          tourInput.persona = input['persona'] as 'junior' | 'senior' | 'pm';
        }
        result = await sprangTour(loader, tourInput);
        break;
      }

      case 'sprang_domain': {
        const domainInput: SprangDomainInput = {};
        if (input['domain_name'] !== undefined) {
          domainInput.domain_name = input['domain_name'] as string;
        }
        result = await sprangDomain(loader, domainInput);
        break;
      }

      case 'sprang_health': {
        result = await sprangHealth(loader, {});
        break;
      }

      case 'sprang_why': {
        result = await sprangWhy(loader, { node_id: input['node_id'] as string }, sprangRoot);
        break;
      }

      // ── The three git-history tools ───────────────────────────────────────
      // Each is a single blocking walk of `git log` (readRepoHistory) whose
      // duration is unknown up front — tens of seconds on a repository with a
      // long history — and which reports nothing while it runs. There is no
      // honest intermediate number to send, so each sends exactly one
      // indeterminate "working" ping and nothing more. Inventing a total and
      // stepping it on a timer would be a progress bar measuring the timer.
      case 'sprang_coupled': {
        await progress.indeterminate('Reading git history for change coupling…');
        const coupledInput: Parameters<typeof sprangCoupled>[1] = {
          file: input['file'] as string,
        };
        if (input['since_months'] !== undefined) {
          coupledInput.since_months = input['since_months'] as number;
        }
        if (input['limit'] !== undefined) coupledInput.limit = input['limit'] as number;
        result = await sprangCoupled(loader, coupledInput, sprangRoot);
        break;
      }

      case 'sprang_traps': {
        await progress.indeterminate('Scanning git history for reverts and hotfixes…');
        const trapsInput: Parameters<typeof sprangTraps>[0] = {};
        if (input['file'] !== undefined) trapsInput.file = input['file'] as string;
        if (input['since_months'] !== undefined) trapsInput.since_months = input['since_months'] as number;
        if (input['limit'] !== undefined) trapsInput.limit = input['limit'] as number;
        result = await sprangTraps(trapsInput, sprangRoot);
        break;
      }

      case 'sprang_owners': {
        await progress.indeterminate('Reading git history for ownership…');
        const ownersInput: Parameters<typeof sprangOwners>[0] = {
          file: input['file'] as string,
        };
        if (input['since_months'] !== undefined) ownersInput.since_months = input['since_months'] as number;
        result = await sprangOwners(ownersInput, sprangRoot);
        break;
      }

      case 'sprang_review': {
        const reviewInput: Parameters<typeof sprangReview>[1] = {
          changed_files: (input['changed_files'] as string[]) ?? [],
        };
        if (input['depth'] !== undefined) reviewInput.depth = input['depth'] as number;
        result = await sprangReview(loader, reviewInput, sprangRoot);

        // The one Sprang answer that is a judgement call rather than a fact:
        // shipping a change whose blast radius includes files at risk ≥ 0.8
        // that nobody opened. Ask the human — the model is the last party who
        // should get to wave that through, since it is marking its own
        // homework. Silent no-op on a client without `elicitation`, so the
        // result is byte-identical to today's for everyone else.
        if (result !== null && typeof result === 'object') {
          const risky = highRiskUnreadFiles(result as ReviewLike);
          if (risky.length > 0) {
            const decision = await elicitReviewProceed(server, risky);
            if (decision !== null) {
              result = {
                ...(result as Record<string, unknown>),
                human_decision: decision,
                human_decision_files: risky,
              };
            }
          }
        }
        break;
      }

      // Unlike the git tools, this one has real, observable phase boundaries:
      // parsing the graph (the dominant cost on a first call — the file can be
      // tens of megabytes, and it is cached afterwards) is genuinely distinct
      // from running the retrieval channels, which is genuinely distinct from
      // projecting and size-checking the result. Each tick below is sent after
      // the work it names has actually finished.
      case 'sprang_context': {
        progressTotal = 3;
        await progress.report(0, 3, 'Loading knowledge graph…');
        const warm = await loader.getGraph();
        await progress.report(
          1,
          3,
          warm === null
            ? 'No knowledge graph found — returning guidance'
            : `Graph loaded (${warm.nodes?.length ?? 0} nodes) — selecting context`
        );
        const ctxInput: Parameters<typeof sprangContext>[1] = { task: input['task'] as string };
        if (input['budget_tokens'] !== undefined) ctxInput.budget_tokens = input['budget_tokens'] as number;
        if (input['seed_files'] !== undefined) ctxInput.seed_files = input['seed_files'] as string[];
        if (input['mentioned_idents'] !== undefined) {
          ctxInput.mentioned_idents = input['mentioned_idents'] as string[];
        }
        if (input['limit'] !== undefined) ctxInput.limit = input['limit'] as number;
        result = await sprangContext(loader, ctxInput);
        break;
      }

      case 'sprang_respond': {
        const respondInput: SprangRespondInput = {
          response: input['response'] as string,
        };
        if (input['question'] !== undefined) {
          respondInput.question = input['question'] as string;
        }
        result = await sprangRespond(respondInput, sprangRoot);
        break;
      }

      case 'sprang_annotate': {
        // An annotation is prose a *person* writes — that is the entire point
        // of the annotations directory, which holds the knowledge the graph
        // cannot derive. Called with no content, ask for it rather than
        // writing a placeholder. `elicitAnnotationContent` returns null when
        // the client never declared `elicitation` (or the user declined), and
        // the original argument is then passed through untouched, so a client
        // that ignores this feature sees exactly today's behaviour.
        let content = input['content'] as string;
        if (typeof content !== 'string' || content.trim() === '') {
          const elicited = await elicitAnnotationContent(server, input['node_id'] as string);
          if (elicited !== null) content = elicited;
        }
        const annotateInput: SprangAnnotateInput = {
          node_id: input['node_id'] as string,
          content,
        };
        if (input['tags'] !== undefined) {
          annotateInput.tags = input['tags'] as string[];
        }
        result = await sprangAnnotate(loader, annotateInput, sprangRoot);
        break;
      }

      default:
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: `Unknown tool: ${name}`, code: 'UNKNOWN_TOOL' }, null, 2),
            },
          ],
          isError: true,
        };
    }

    if (progressTotal !== undefined) {
      await progress.report(2, progressTotal, 'Selection complete — projecting result');
    }

    // Project to the requested detail level before anything else looks at the
    // result, so receipts and truncation both see what the client will see.
    const detail = input['detail'];
    if (typeof detail === 'string' && detail !== 'full') {
      result = applyDetail(result, detail as DetailLevel);
    }

    // Record what this call exposed, unless the call *is* the audit — counting
    // sprang_review's own output would let it mark its findings as read.
    // Done before truncation: the agent was shown the full set conceptually,
    // but only the retained entries are what it can actually act on, so record
    // the truncated payload to keep coverage honest.
    const payload = truncateOversizedResult(result);

    if (name !== 'sprang_review') {
      const shown = new Set<string>();
      collectNodeIds(payload, shown);
      readLog.record(Array.from(shown), name);
    }

    // `structuredContent` is the typed channel the declared outputSchema
    // describes; the text block stays for backward compatibility, because a
    // client that predates structured output would otherwise see an empty
    // result. Both carry the same object.
    const structured =
      payload !== null && typeof payload === 'object' && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : { value: payload };

    // Final tick, for phased tools only. Sent last so a client can retire its
    // indicator on `progress === total` without racing the result.
    if (progressTotal !== undefined) {
      await progress.report(progressTotal, progressTotal, 'Complete');
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(payload, null, 2),
        },
      ],
      structuredContent: structured,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({ error: message, code: 'INTERNAL_ERROR' }, null, 2),
        },
      ],
      isError: true,
    };
  }
});

// ─── Resources, templates and completion ─────────────────────────────────────
//
// See resources.ts for why these exist. All four handlers are total: they never
// throw and never depend on a graph being present.

/**
 * Push side of the resource surface.
 *
 * Constructed eagerly but inert: no watcher exists until the first
 * `resources/subscribe`, so a client that never subscribes costs exactly one
 * object and zero file descriptors — the "unaffected if ignored" contract.
 */
const subscriptions = new ResourceSubscriptionManager({
  graphPath: join(sprangRoot, '.sprang', 'knowledge-graph.json'),
  reportPath: join(sprangRoot, '.sprang', 'SPRANG_REPORT.md'),
  notifier: {
    sendResourceUpdated: (params) => server.sendResourceUpdated(params),
    sendResourceListChanged: () => server.sendResourceListChanged(),
  },
});

export { subscriptions };

server.setRequestHandler(SubscribeRequestSchema, async (request) => {
  subscriptions.subscribe(request.params.uri);
  // An empty result is the whole protocol answer here; the value arrives later
  // as `notifications/resources/updated`.
  return {};
});

server.setRequestHandler(UnsubscribeRequestSchema, async (request) => {
  subscriptions.unsubscribe(request.params.uri);
  return {};
});

server.setRequestHandler(ListResourcesRequestSchema, async () => listResources());

server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => listResourceTemplates());

server.setRequestHandler(ReadResourceRequestSchema, async (request) =>
  readResource(loader, sprangRoot, request.params.uri)
);

server.setRequestHandler(CompleteRequestSchema, async (request) =>
  complete(loader, {
    ref: request.params.ref,
    argument: request.params.argument,
  })
);

/**
 * Release the file watcher when the connection ends.
 *
 * A stdio server whose client has gone away must exit. An `fs.watch` handle or
 * a live `setInterval` left behind keeps the event loop alive and leaves an
 * orphan process the user has to hunt down — so cleanup is hung off every exit
 * path there is, not just the tidy one.
 */
function shutdown(): void {
  subscriptions.close();
}

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  server.onclose = shutdown;
  process.once('SIGINT', () => {
    shutdown();
    process.exit(0);
  });
  process.once('SIGTERM', () => {
    shutdown();
    process.exit(0);
  });
  process.once('exit', shutdown);
  await server.connect(transport);
}

/** Exported for the in-process smoke test, which connects it to a memory transport. */
export { server };

// Guarded so the contract test can import TOOLS and the size guard without the
// process attaching itself to stdio and hanging. Nothing else sets this.
if (process.env['SPRANG_MCP_NO_LISTEN'] !== '1') {
  main().catch((err) => {
    process.stderr.write(`Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
