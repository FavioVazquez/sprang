/**
 * Declared output schemas for every Sprang MCP tool.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The MCP spec lets a tool advertise an `outputSchema` alongside its
 * `inputSchema`, and requires the server to return `structuredContent` whenever
 * it does. Without one, an agent that wants to act on `risk_score > 0.7` has to
 * parse a number out of prose and hope. With one, the same decision is a typed
 * comparison: a hook can gate on it, and a code-mode agent can filter over the
 * result the way it would over any other JSON.
 *
 * Every schema below is derived by reading the tool's actual return type in
 * `src/tools/*.ts`. They are JSON Schema draft 2020-12 shaped, deliberately
 * plain objects — no zod, no codegen — so that what is advertised over the wire
 * is the thing a reader can see here.
 *
 * A NOTE ON ENUMS
 * ---------------
 * Closed sets that the tool code itself literally constructs (`'incoming' |
 * 'outgoing'`, a verdict, a trap kind) are declared as `enum`. Open-ish sets
 * that come out of the graph file (node types, risk factors, smell categories)
 * are declared as plain strings with the known values named in the
 * `description`. A client that validates `structuredContent` strictly would
 * otherwise start rejecting perfectly good results the first time the graph
 * schema grows a value — a validation error is a worse outcome than a slightly
 * looser type.
 *
 * ERRORS
 * ------
 * Several tools return an error *as a normal result* (`{error, code, remedy?}`)
 * rather than as a protocol-level failure — "node not found" is an answer, not
 * a crash. Those tools declare `oneOf: [success, error]` so the shape is honest
 * about both outcomes. Tools whose signature cannot return an error object
 * (`sprang_query` degrades to an empty result set instead) have no error
 * branch. Protocol-level failures still go back with `isError: true` and no
 * `structuredContent`, which is the case the spec exempts from validation.
 */

/** Any JSON Schema fragment. Loose on purpose: this is wire data, not a model. */
export type JsonSchema = Record<string, unknown>;

/** The top-level shape MCP requires of `outputSchema`: always an object. */
export interface ToolOutputSchema {
  type: 'object';
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  oneOf?: ToolOutputSchema[];
}

// ─── Primitives ────────────────────────────────────────────────────────────

const STR: JsonSchema = { type: 'string' };
const NUM: JsonSchema = { type: 'number' };
const BOOL: JsonSchema = { type: 'boolean' };
const STR_ARRAY: JsonSchema = { type: 'array', items: { type: 'string' } };

function str(description: string): JsonSchema {
  return { type: 'string', description };
}
function num(description: string): JsonSchema {
  return { type: 'number', description };
}
function arrayOf(items: JsonSchema, description?: string): JsonSchema {
  return description ? { type: 'array', items, description } : { type: 'array', items };
}
function object(
  properties: Record<string, JsonSchema>,
  required: string[] = [],
  description?: string,
): JsonSchema {
  return description
    ? { type: 'object', description, properties, required }
    : { type: 'object', properties, required };
}

// ─── Shared fragments ──────────────────────────────────────────────────────

/**
 * Present on any result the size guard in server.ts had to shorten. Declared
 * everywhere a result contains an array, so a client can tell "there were no
 * more" from "there were more and you are not seeing them".
 */
const TRUNCATED: JsonSchema = object(
  {
    field: str('Name of the array field that was shortened.'),
    shown: num('How many elements are present in this response.'),
    total: num('How many elements there were before truncation.'),
    hint: str('How to retrieve the rest — usually a narrower query or a lower limit.'),
  },
  ['field', 'shown', 'total', 'hint'],
  'Set only when the result exceeded the size budget and was deterministically shortened.',
);

const RISK_SCORE: JsonSchema = {
  type: 'number',
  minimum: 0,
  maximum: 1,
  description: 'Composite risk, 0–1. Above 0.7 is conventionally "high risk" in Sprang.',
};

const RISK_FACTORS: JsonSchema = arrayOf(
  str(
    'One of: high_coupling, no_test_coverage, frequent_changes, large_blast_radius, ' +
      'critical_path, single_author, recent_churn, has_structural_warnings, ' +
      'previously_reverted, repeated_bug_fixes, bus_factor_one, hotspot.',
  ),
  'Named reasons the risk score is what it is.',
);

const NODE_TYPE: JsonSchema = str(
  'Graph node type — file, function, class, module, concept, config, document, service, ' +
    'table, endpoint, pipeline, schema, resource, domain, flow, step, article, entity, ' +
    'topic, claim, source.',
);

const SEVERITY: JsonSchema = { type: 'string', enum: ['low', 'medium', 'high'] };

const NODE_LOCATION: JsonSchema = object(
  { file: STR, start_line: NUM, end_line: NUM },
  ['file'],
);

const STRUCTURAL_WARNING: JsonSchema = object(
  {
    category: str(
      'Smell category — duplicate_logic, unclear_coupling, low_cohesion, god_node, ' +
        'unstable_interface, orphan_node, circular_dependency, over_connected, ' +
        'name_duplicate, layer_violation.',
    ),
    severity: SEVERITY,
    description: STR,
    related_node_ids: STR_ARRAY,
    heuristic: str('The rule that fired, e.g. "out_degree > 20".'),
  },
  ['category', 'severity', 'description', 'related_node_ids', 'heuristic'],
);

const SECURITY_WARNING: JsonSchema = object(
  {
    category: str(
      'hardcoded_secret, sql_injection, xss_risk, unsafe_eval, unsafe_exec, ' +
        'unsafe_deserialization, path_traversal or weak_crypto.',
    ),
    severity: SEVERITY,
    description: STR,
    line: NUM,
    pattern: str('The regex that matched.'),
    snippet: STR,
    confidence: {
      type: 'string',
      enum: ['unverified', 'confirmed'],
      description:
        'Sprang\'s built-in scanner only ever emits "unverified": a regex matched source text, ' +
        'with no dataflow or reachability analysis behind it.',
    },
  },
  ['category', 'severity', 'description', 'pattern', 'confidence'],
);

const COMMIT_REF: JsonSchema = object(
  {
    sha: STR,
    date: str('ISO-8601.'),
    message: str('First line of the commit message.'),
    author: STR,
    diff_summary: STR,
  },
  ['sha', 'date', 'message', 'author'],
);

const DECISION_CONTEXT: JsonSchema = object(
  {
    commits: arrayOf(COMMIT_REF),
    primary_authors: STR_ARRAY,
    last_changed: str('ISO-8601.'),
    change_frequency: num('Commits in the last 90 days.'),
    rationale_snippets: arrayOf(STR, 'The "why", extracted from commit messages.'),
    pr_references: STR_ARRAY,
    changelog_entries: STR_ARRAY,
  },
  [
    'commits',
    'primary_authors',
    'last_changed',
    'change_frequency',
    'rationale_snippets',
    'pr_references',
    'changelog_entries',
  ],
);

const LANGUAGE_LESSON: JsonSchema = object(
  {
    pattern: str('closures, async_await, promises, generics, middleware, …'),
    title: STR,
    explanation: STR,
    lines: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
  },
  ['pattern', 'title', 'explanation'],
);

/** A full graph node, as returned verbatim by `sprang_node`. */
const SPRANG_NODE: JsonSchema = object(
  {
    id: STR,
    type: NODE_TYPE,
    name: STR,
    label: STR,
    location: NODE_LOCATION,
    filePath: STR,
    lineRange: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
    summary: STR,
    complexity: { type: 'string', enum: ['simple', 'moderate', 'complex'] },
    tags: STR_ARRAY,
    languageNotes: STR,
    layer: STR,
    metadata: { type: 'object' },
    domainMeta: { type: 'object' },
    knowledgeMeta: { type: 'object' },
    decision_context: DECISION_CONTEXT,
    structural_warnings: arrayOf(STRUCTURAL_WARNING),
    risk_score: RISK_SCORE,
    risk_factors: RISK_FACTORS,
    security_warnings: arrayOf(SECURITY_WARNING),
    detected_patterns: STR_ARRAY,
    annotations: STR_ARRAY,
    languageLesson: LANGUAGE_LESSON,
  },
  ['id', 'type', 'label'],
);

/**
 * The error shape a tool can return as an ordinary result.
 *
 * `code` is the part worth branching on: GRAPH_NOT_FOUND and GRAPH_INVALID mean
 * very different things (one is fixed by scanning, the other is not).
 */
export const ERROR_OUTPUT: ToolOutputSchema = {
  type: 'object',
  description: 'A handled failure returned as a normal result rather than a protocol error.',
  properties: {
    error: str('Human-readable description of what went wrong.'),
    code: str(
      'Machine-readable code — GRAPH_NOT_FOUND, GRAPH_INVALID, GRAPH_TOO_LARGE, ' +
        'GRAPH_READ_ERROR, NODE_NOT_FOUND, NO_TOURS, TOUR_NOT_FOUND, DOMAIN_NOT_FOUND, ' +
        'INVALID_INPUT, NO_HISTORY, NO_HISTORY_FOR_FILE, MISSING_RESPONSE.',
    ),
    remedy: str('What the caller should actually do about it.'),
    graph_path: str('Absolute path of the graph file that was consulted.'),
    validation_issues: str('Condensed schema issues — only present for GRAPH_INVALID.'),
  },
  required: ['error', 'code'],
};

/**
 * Combine a success shape with the error shape.
 *
 * The branches are mutually exclusive because each requires a field the other
 * does not have, so `oneOf` (exactly one match) is the correct combinator here
 * rather than `anyOf`.
 */
function orError(...successes: ToolOutputSchema[]): ToolOutputSchema {
  return { type: 'object', oneOf: [...successes, ERROR_OUTPUT] };
}

/** A success branch. `_truncated` is allowed on every one of them. */
function success(
  description: string,
  properties: Record<string, JsonSchema>,
  required: string[],
): ToolOutputSchema {
  return {
    type: 'object',
    description,
    properties: { ...properties, _truncated: TRUNCATED },
    required,
  };
}

// ─── sprang_query ──────────────────────────────────────────────────────────

export const SPRANG_QUERY_OUTPUT: ToolOutputSchema = success(
  'Nodes matching the query, best match first. Degrades to an empty list when no graph exists.',
  {
    nodes: arrayOf(
      object(
        {
          id: STR,
          type: NODE_TYPE,
          label: STR,
          summary: STR,
          risk_score: RISK_SCORE,
          score: num('Cosine similarity — semantic mode only.'),
        },
        ['id', 'type', 'label'],
      ),
    ),
    total: num('Total matches found before the limit was applied.'),
    query: str('The query as it was interpreted.'),
  },
  ['nodes', 'total', 'query'],
);

// ─── sprang_node ───────────────────────────────────────────────────────────

const NEIGHBOR: JsonSchema = object(
  {
    node_id: STR,
    label: STR,
    type: NODE_TYPE,
    direction: { type: 'string', enum: ['incoming', 'outgoing'] },
    edge_type: str('imports, calls, depends_on, tested_by, contains, …'),
  },
  ['node_id', 'label', 'type', 'direction', 'edge_type'],
);

export const SPRANG_NODE_OUTPUT: ToolOutputSchema = orError(
  success(
    'A single node with its 1-hop neighbourhood, degrees and annotation status.',
    {
      node: SPRANG_NODE,
      neighbors: arrayOf(NEIGHBOR, 'Immediate neighbours in both directions.'),
      layer: object({ id: STR, name: STR }, ['id', 'name']),
      layer_mate_count: num('How many other nodes share this layer.'),
      in_degree: num('Edges pointing at this node — how much depends on it.'),
      out_degree: num('Edges leaving this node — how much it depends on.'),
      has_annotation: BOOL,
      annotation_path: str('Project-relative path of the team annotation, if any.'),
    },
    ['node', 'neighbors', 'in_degree', 'out_degree', 'has_annotation'],
  ),
);

// ─── sprang_diff_impact ────────────────────────────────────────────────────

const IMPACT_ENTRY: JsonSchema = object(
  {
    node_id: STR,
    label: STR,
    type: NODE_TYPE,
    risk_score: RISK_SCORE,
    risk_factors: RISK_FACTORS,
    path_from_changed: arrayOf(STR, 'Node ids from the changed node to this one.'),
  },
  ['node_id', 'label', 'type', 'path_from_changed'],
);

export const SPRANG_DIFF_IMPACT_OUTPUT: ToolOutputSchema = orError(
  success(
    'Blast radius of a set of changed files: what depends on them, riskiest first.',
    {
      changed_nodes: arrayOf(IMPACT_ENTRY, 'Nodes that map to the changed files themselves.'),
      impact_nodes: arrayOf(IMPACT_ENTRY, 'Dependents reachable over incoming edges, risk-sorted.'),
      total_impact: num('Number of impacted nodes, excluding the changed ones.'),
      high_risk_count: num('Impacted nodes with risk_score >= 0.7.'),
    },
    ['changed_nodes', 'impact_nodes', 'total_impact', 'high_risk_count'],
  ),
);

// ─── sprang_tour ───────────────────────────────────────────────────────────

const TOUR_STEP: JsonSchema = object(
  {
    step_number: NUM,
    step_title: STR,
    explanation: STR,
    highlight: BOOL,
    languageLesson: LANGUAGE_LESSON,
    node: object(
      { id: STR, type: NODE_TYPE, label: STR, summary: STR, risk_score: RISK_SCORE },
      ['id', 'type', 'label'],
    ),
  },
  ['step_number', 'step_title', 'explanation'],
);

export const SPRANG_TOUR_OUTPUT: ToolOutputSchema = orError(
  success(
    'One guided tour, its steps already filtered for the requested persona.',
    {
      tour_id: STR,
      title: STR,
      description: STR,
      persona: str('The persona the steps were filtered for.'),
      steps: arrayOf(TOUR_STEP),
      total_steps: num('Number of steps after persona filtering.'),
    },
    ['tour_id', 'title', 'description', 'persona', 'steps', 'total_steps'],
  ),
  success(
    'The list of available tours, returned when no single tour is selected.',
    {
      tours: arrayOf(
        object({ id: STR, title: STR, description: STR, step_count: NUM }, [
          'id',
          'title',
          'description',
          'step_count',
        ]),
      ),
    },
    ['tours'],
  ),
);

// ─── sprang_domain ─────────────────────────────────────────────────────────

const DOMAIN_STEP: JsonSchema = object(
  {
    id: STR,
    label: STR,
    summary: STR,
    node_ids: STR_ARRAY,
    weight: num('0–1, monotonically increasing within a flow.'),
  },
  ['id', 'label', 'node_ids', 'weight'],
);

const DOMAIN_FLOW: JsonSchema = object(
  {
    id: STR,
    label: STR,
    summary: STR,
    steps: arrayOf(DOMAIN_STEP),
    entry_points: STR_ARRAY,
    business_rules: STR_ARRAY,
  },
  ['id', 'label', 'steps'],
);

const DOMAIN: JsonSchema = object(
  { id: STR, label: STR, summary: STR, flows: arrayOf(DOMAIN_FLOW), entities: STR_ARRAY },
  ['id', 'label', 'flows'],
);

export const SPRANG_DOMAIN_OUTPUT: ToolOutputSchema = orError(
  success('One business domain in full, with its flows and steps.', { domain: DOMAIN }, ['domain']),
  success(
    'Every business domain, summarised — returned when no domain_name is given.',
    {
      domains: arrayOf(
        object({ id: STR, label: STR, summary: STR, flow_count: NUM, entity_count: NUM }, [
          'id',
          'label',
          'flow_count',
          'entity_count',
        ]),
      ),
      total: NUM,
    },
    ['domains', 'total'],
  ),
);

// ─── sprang_health ─────────────────────────────────────────────────────────

const RISK_SUMMARY: JsonSchema = object({ high: NUM, medium: NUM, low: NUM }, [
  'high',
  'medium',
  'low',
]);

export const SPRANG_HEALTH_OUTPUT: ToolOutputSchema = orError(
  success(
    'Whole-repository health: grade, score, the penalties behind it, and the trend.',
    {
      phase: str('skeleton or complete. A skeleton graph has no LLM enrichment.'),
      generated_at: str('ISO-8601 timestamp of the graph build.'),
      phase2_completed_at: STR,
      total_nodes: NUM,
      total_edges: NUM,
      risk_summary: RISK_SUMMARY,
      smell_summary: {
        type: 'object',
        description: 'Count per smell category. Sparse — absent categories scored zero.',
        additionalProperties: { type: 'number' },
      },
      top_10_risky_nodes: arrayOf(
        object(
          {
            node_id: STR,
            label: STR,
            type: NODE_TYPE,
            risk_score: RISK_SCORE,
            risk_factors: RISK_FACTORS,
          },
          ['node_id', 'label', 'type', 'risk_score', 'risk_factors'],
        ),
      ),
      orphan_count: num('Nodes with no edges at all.'),
      circular_dependency_count: NUM,
      nodes_without_tests: NUM,
      health_score: num('0–100.'),
      health_grade: { type: 'string', description: 'A, B, C, D or F.' },
      grade_color: STR,
      grade_breakdown: object(
        {
          dead_code_penalty: NUM,
          circular_penalty: NUM,
          god_node_penalty: NUM,
          coupling_penalty: NUM,
          security_penalty: NUM,
        },
        [
          'dead_code_penalty',
          'circular_penalty',
          'god_node_penalty',
          'coupling_penalty',
          'security_penalty',
        ],
      ),
      security_disclaimer: str(
        'Present whenever there are security findings: they are regex hints, not audited findings.',
      ),
      security_summary: object(
        {
          total: NUM,
          by_severity: RISK_SUMMARY,
          by_category: { type: 'object', additionalProperties: { type: 'number' } },
        },
        ['total', 'by_severity', 'by_category'],
      ),
      history: arrayOf(
        object(
          {
            timestamp: STR,
            health_score: NUM,
            health_grade: STR,
            total_nodes: NUM,
            total_edges: NUM,
            smell_count: NUM,
            security_count: NUM,
          },
          ['timestamp', 'health_score', 'health_grade', 'total_nodes', 'total_edges'],
        ),
        'Up to the last 30 snapshots, oldest first.',
      ),
    },
    [
      'phase',
      'generated_at',
      'total_nodes',
      'total_edges',
      'risk_summary',
      'smell_summary',
      'top_10_risky_nodes',
      'orphan_count',
      'circular_dependency_count',
      'nodes_without_tests',
      'health_score',
      'health_grade',
      'grade_color',
      'grade_breakdown',
      'security_summary',
      'history',
    ],
  ),
);

// ─── sprang_why ────────────────────────────────────────────────────────────

export const SPRANG_WHY_OUTPUT: ToolOutputSchema = orError(
  success(
    'Why a node exists: git decision context plus any team annotation written for it.',
    {
      node_id: STR,
      label: STR,
      summary: STR,
      decision_context: DECISION_CONTEXT,
      annotation: str('Raw markdown of the team annotation, when one exists.'),
      annotation_path: STR,
      phase_note: str('Set when the graph has not been enriched, explaining what is missing.'),
    },
    ['node_id', 'label'],
  ),
);

// ─── sprang_coupled ────────────────────────────────────────────────────────

export const SPRANG_COUPLED_OUTPUT: ToolOutputSchema = orError(
  success(
    'Files that historically change together with the queried file, from git history.',
    {
      file: str('The file the couplings are relative to.'),
      window_months: NUM,
      commits_analysed: NUM,
      coupled: arrayOf(
        object(
          {
            path: STR,
            co_change_percent: num(
              'Percentage of this file\'s changes that also touched the queried file.',
            ),
            shared_commits: num('Commits touching both — how much the percentage can be trusted.'),
            lift: num('Above 1 means they co-change more than chance predicts.'),
            hidden: {
              type: 'boolean',
              description:
                'True when no dependency path connects the two files — static analysis cannot find this one.',
            },
            note: STR,
          },
          ['path', 'co_change_percent', 'shared_commits', 'lift', 'hidden', 'note'],
        ),
      ),
      hidden_coupling_count: num('How many of the couplings have no static path.'),
      guidance: str('One-paragraph reading of the numbers.'),
    },
    ['file', 'window_months', 'commits_analysed', 'coupled', 'hidden_coupling_count', 'guidance'],
  ),
);

// ─── sprang_traps ──────────────────────────────────────────────────────────

export const SPRANG_TRAPS_OUTPUT: ToolOutputSchema = orError(
  success(
    'Past changes here that were reverted or urgently fixed.',
    {
      scope: str('The file queried, or "(whole repository)".'),
      window_months: NUM,
      files_with_history: NUM,
      traps: arrayOf(
        object(
          {
            file: STR,
            kind: {
              type: 'string',
              enum: ['reverted', 'quick_fix'],
              description:
                '"reverted" is definitive; "quick_fix" is a weaker heuristic and may be ordinary iteration.',
            },
            what_happened: STR,
            hours_to_correction: NUM,
            commit: str('Short SHA of the change that went wrong.'),
            corrected_by: str('Subject of the commit that corrected it.'),
          },
          [
            'file',
            'kind',
            'what_happened',
            'hours_to_correction',
            'commit',
            'corrected_by',
          ],
        ),
        'Soonest correction first — the fastest reverts are the sharpest traps.',
      ),
      guidance: STR,
    },
    ['scope', 'window_months', 'files_with_history', 'traps', 'guidance'],
  ),
);

// ─── sprang_owners ─────────────────────────────────────────────────────────

export const SPRANG_OWNERS_OUTPUT: ToolOutputSchema = orError(
  success(
    'Recency-weighted ownership of a file: who to ask, and whether the bus factor is 1.',
    {
      file: STR,
      window_months: NUM,
      main_developer: {
        type: ['string', 'null'],
        description: 'Top contributor by recency-weighted share, or null when unknown.',
      },
      top_share: num('Share held by the top contributor, 0–1.'),
      bus_factor: num('People needed to cover more than half the contribution. 1 is a risk.'),
      knowledge_diffusion: num('0 = one owner, 1 = perfectly diffused. Both extremes are risks.'),
      minor_contributors: num('Contributors with under 5% each.'),
      authors: arrayOf(
        object(
          {
            name: STR,
            commits: NUM,
            share: num('0–1, recency-weighted.'),
            last_touched: str('YYYY-MM-DD.'),
          },
          ['name', 'commits', 'share', 'last_touched'],
        ),
      ),
      guidance: STR,
    },
    [
      'file',
      'window_months',
      'main_developer',
      'top_share',
      'bus_factor',
      'knowledge_diffusion',
      'minor_contributors',
      'authors',
      'guidance',
    ],
  ),
);

// ─── sprang_review ─────────────────────────────────────────────────────────

export const SPRANG_REVIEW_OUTPUT: ToolOutputSchema = orError(
  success(
    'Whether a change looks complete: blast radius versus what the session actually read.',
    {
      changed_files: STR_ARRAY,
      blast_radius_size: num('Files reachable from the change that could be affected.'),
      context_coverage: num('Fraction of the blast radius that was opened, 0–1.'),
      unread: arrayOf(
        object(
          {
            path: STR,
            risk_score: RISK_SCORE,
            hops: num('Distance from the changed file.'),
            reason: STR,
          },
          ['path', 'risk_score', 'hops', 'reason'],
        ),
        'Impacted files never read, riskiest first. Capped at 20.',
      ),
      sessions_considered: num('How many receipt files contributed. 0 means coverage is unknown.'),
      verdict: {
        type: 'string',
        enum: ['looks_complete', 'gaps_found', 'no_receipts'],
        description:
          '"no_receipts" is NOT a pass — it means coverage could not be measured at all.',
      },
      guidance: STR,
    },
    [
      'changed_files',
      'blast_radius_size',
      'context_coverage',
      'unread',
      'sessions_considered',
      'verdict',
      'guidance',
    ],
  ),
);

// ─── sprang_context ────────────────────────────────────────────────────────

export const SPRANG_CONTEXT_OUTPUT: ToolOutputSchema = orError(
  success(
    'What to read for a task, within a token budget, each item labelled with why it is here.',
    {
      task: STR,
      budget_tokens: NUM,
      used_tokens: num('Estimated tokens for the returned selection.'),
      items: arrayOf(
        object(
          {
            node_id: STR,
            path: STR,
            kind: str('Node type of the item.'),
            score: num('Fused retrieval score after PageRank reranking.'),
            found_by: arrayOf(
              STR,
              'Which retrieval channels surfaced this — symbol, keyword, graph, history.',
            ),
            hops_from_seed: NUM,
            risk_score: RISK_SCORE,
          },
          ['node_id', 'path', 'kind', 'score', 'found_by'],
        ),
      ),
      omitted: num('Candidates that did not fit in the budget.'),
      guidance: STR,
    },
    ['task', 'budget_tokens', 'used_tokens', 'items', 'omitted', 'guidance'],
  ),
);

// ─── sprang_annotate ───────────────────────────────────────────────────────

export const SPRANG_ANNOTATE_OUTPUT: ToolOutputSchema = orError(
  success(
    'Confirmation that a team annotation was written, and where it landed.',
    {
      success: { type: 'boolean', const: true },
      path: str('Project-relative path of the annotation file.'),
      node_id: str('The resolved node id — may differ from the one supplied.'),
      node_label: STR,
    },
    ['success', 'path', 'node_id', 'node_label'],
  ),
);

// ─── sprang_respond ────────────────────────────────────────────────────────

export const SPRANG_RESPOND_OUTPUT: ToolOutputSchema = orError(
  success(
    'Confirmation that a response was written for the dashboard to pick up.',
    {
      success: { type: 'boolean', const: true },
      path: str('Project-relative path of the response file.'),
      written_at: str('ISO-8601.'),
      timestamp: str('ISO-8601. Same value as written_at, kept for older dashboard builds.'),
    },
    ['success', 'path', 'written_at', 'timestamp'],
  ),
);
