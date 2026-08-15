import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
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
import { sprangAnnotate } from './tools/sprang_annotate.js';
import type { SprangAnnotateInput } from './tools/sprang_annotate.js';
import { sprangRespond } from './tools/sprang_respond.js';
import type { SprangRespondInput } from './tools/sprang_respond.js';

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
    },
  }
);

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
      },
      required: ['query'],
    },
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
      },
      required: ['node_id'],
    },
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
      },
      required: ['files'],
    },
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
      },
      required: [],
    },
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
      },
      required: [],
    },
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
      },
      required: ['node_id'],
    },
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
      },
      required: ['changed_files'],
    },
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
      },
      required: ['task'],
    },
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
          description: 'Markdown content for the annotation body.',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional tags for the annotation.',
        },
      },
      required: ['node_id', 'content'],
    },
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
  },
];

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: TOOLS };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const input = (args ?? {}) as Record<string, unknown>;

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

      case 'sprang_coupled': {
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
        const trapsInput: Parameters<typeof sprangTraps>[0] = {};
        if (input['file'] !== undefined) trapsInput.file = input['file'] as string;
        if (input['since_months'] !== undefined) trapsInput.since_months = input['since_months'] as number;
        if (input['limit'] !== undefined) trapsInput.limit = input['limit'] as number;
        result = await sprangTraps(trapsInput, sprangRoot);
        break;
      }

      case 'sprang_owners': {
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
        break;
      }

      case 'sprang_context': {
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
        const annotateInput: SprangAnnotateInput = {
          node_id: input['node_id'] as string,
          content: input['content'] as string,
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

    // Record what this call exposed, unless the call *is* the audit — counting
    // sprang_review's own output would let it mark its findings as read.
    if (name !== 'sprang_review') {
      const shown = new Set<string>();
      collectNodeIds(result, shown);
      readLog.record(Array.from(shown), name);
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(result, null, 2),
        },
      ],
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

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
