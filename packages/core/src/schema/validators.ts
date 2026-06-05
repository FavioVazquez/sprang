import { z } from 'zod';
import { NODE_TYPES, EDGE_TYPES } from './types.js';

const nodeTypeSchema = z.enum(NODE_TYPES);
const edgeTypeSchema = z.enum(EDGE_TYPES);

export const commitRefSchema = z.object({
  sha: z.string().min(1),
  date: z.string(),
  message: z.string(),
  author: z.string(),
  diff_summary: z.string().optional(),
});

export const decisionContextSchema = z.object({
  commits: z.array(commitRefSchema),
  primary_authors: z.array(z.string()),
  last_changed: z.string(),
  change_frequency: z.number().int().min(0),
  rationale_snippets: z.array(z.string()),
  pr_references: z.array(z.string()),
  changelog_entries: z.array(z.string()),
});

export const structuralWarningSchema = z.object({
  category: z.enum([
    'duplicate_logic', 'unclear_coupling', 'low_cohesion', 'god_node',
    'unstable_interface', 'orphan_node', 'circular_dependency', 'over_connected',
  ]),
  severity: z.enum(['low', 'medium', 'high']),
  description: z.string(),
  related_node_ids: z.array(z.string()),
  heuristic: z.string(),
});

export const sprangNodeSchema = z.object({
  id: z.string().min(1),
  type: nodeTypeSchema,
  /** Canonical name — optional for backward compat with existing skeleton graphs. */
  name: z.string().optional(),
  label: z.string().min(1),
  /** File path relative to project root. */
  filePath: z.string().optional(),
  lineRange: z.tuple([z.number().int(), z.number().int()]).optional(),
  location: z.object({
    file: z.string(),
    start_line: z.number().int().optional(),
    end_line: z.number().int().optional(),
  }).optional(),
  summary: z.string().optional(),
  complexity: z.enum(['simple', 'moderate', 'complex']).optional(),
  tags: z.array(z.string()).optional(),
  languageNotes: z.string().optional(),
  layer: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  domainMeta: z.record(z.unknown()).optional(),
  knowledgeMeta: z.record(z.unknown()).optional(),
  decision_context: decisionContextSchema.optional(),
  structural_warnings: z.array(structuralWarningSchema).optional(),
  risk_score: z.number().min(0).max(1).optional(),
  risk_factors: z.array(z.enum([
    'high_coupling', 'no_test_coverage', 'frequent_changes',
    'large_blast_radius', 'critical_path', 'single_author',
    'recent_churn', 'has_structural_warnings',
  ])).optional(),
  annotations: z.array(z.string()).optional(),
});

export const sprangEdgeSchema = z.object({
  source: z.string().min(1),
  target: z.string().min(1),
  type: edgeTypeSchema,
  direction: z.enum(['forward', 'backward', 'bidirectional']).optional(),
  description: z.string().optional(),
  weight: z.number().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const layerSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  node_ids: z.array(z.string()),
});

export const tourStepSchema = z.object({
  node_id: z.string().optional(),
  node_ids: z.array(z.string()).optional(),
  step_title: z.string(),
  explanation: z.string(),
  language_lesson: z.string().optional(),
  highlight: z.boolean().optional(),
});

export const tourSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  entry_point: z.string().optional(),
  steps: z.array(tourStepSchema).min(1).max(15),
});

export const domainStepSchema = z.object({
  id: z.string(),
  label: z.string(),
  summary: z.string().optional(),
  node_ids: z.array(z.string()),
  weight: z.number().min(0).max(1),
});

export const domainFlowSchema = z.object({
  id: z.string(),
  label: z.string(),
  summary: z.string().optional(),
  steps: z.array(domainStepSchema),
  entry_points: z.array(z.string()).optional(),
  business_rules: z.array(z.string()).optional(),
});

export const domainSchema = z.object({
  id: z.string(),
  label: z.string(),
  summary: z.string().optional(),
  flows: z.array(domainFlowSchema),
  entities: z.array(z.string()).optional(),
});

export const knowledgeGraphSchema = z.object({
  version: z.string(),
  kind: z.enum(['codebase', 'knowledge']).optional(),
  generated_at: z.string(),
  project_root: z.string(),
  project_name: z.string(),
  description: z.string().optional(),
  languages: z.array(z.string()).optional(),
  frameworks: z.array(z.string()).optional(),
  phase: z.enum(['skeleton', 'enriched', 'complete']),
  nodes: z.array(sprangNodeSchema),
  edges: z.array(sprangEdgeSchema),
  layers: z.array(layerSchema),
  tours: z.array(tourSchema),
  domains: z.array(domainSchema),
  stats: z.object({
    node_count: z.number().int().min(0),
    edge_count: z.number().int().min(0),
    risk_summary: z.object({
      high: z.number().int().min(0),
      medium: z.number().int().min(0),
      low: z.number().int().min(0),
    }),
    smell_summary: z.record(z.number().int().min(0)),
    llm_token_usage: z.number().optional(),
    generated_at: z.string(),
    phase2_completed_at: z.string().optional(),
    gitCommitHash: z.string().optional(),
  }),
});

export type ValidatedKnowledgeGraph = z.infer<typeof knowledgeGraphSchema>;
export type ValidatedNode = z.infer<typeof sprangNodeSchema>;
export type ValidatedEdge = z.infer<typeof sprangEdgeSchema>;
