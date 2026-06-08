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
import { sprangAnnotate } from './tools/sprang_annotate.js';
import type { SprangAnnotateInput } from './tools/sprang_annotate.js';
import { sprangRespond } from './tools/sprang_respond.js';
import type { SprangRespondInput } from './tools/sprang_respond.js';

const sprangRoot = process.env['SPRANG_ROOT'] ?? process.cwd();
const loader = new GraphLoader(sprangRoot);

const server = new Server(
  {
    name: 'sprang',
    version: '0.2.0',
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
      'Return a guided architecture tour of the codebase. Supports different personas: junior (all steps), senior (skip intro), pm (domain/service nodes only).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tour_id: {
          type: 'string',
          description: 'Specific tour ID to load. If omitted, returns the first tour.',
        },
        persona: {
          type: 'string',
          enum: ['junior', 'senior', 'pm'],
          description:
            'Filter tour steps for a persona. junior=all, senior=skip intro, pm=domain/service only.',
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
