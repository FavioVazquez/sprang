// Essential types mirrored from @sprang/core — used directly in browser build

export const NODE_TYPES = [
  'file', 'function', 'class', 'module', 'concept',
  'config', 'document', 'service', 'table', 'endpoint',
  'pipeline', 'schema', 'resource',
  'domain', 'flow', 'step',
] as const;
export type NodeType = typeof NODE_TYPES[number];

export const EDGE_TYPES = [
  'imports', 'exports', 'contains', 'inherits', 'implements',
  'calls', 'subscribes', 'publishes', 'middleware',
  'reads_from', 'writes_to', 'transforms', 'validates',
  'depends_on', 'tests', 'configures',
  'related', 'similar_to',
  'deploys', 'serves', 'provisions', 'triggers', 'migrates',
  'documents', 'routes', 'defines_schema',
  'contains_flow', 'flow_step', 'cross_domain',
] as const;
export type EdgeType = typeof EDGE_TYPES[number];

export interface CommitRef {
  sha: string;
  date: string;
  message: string;
  author: string;
  diff_summary?: string;
}

export interface DecisionContext {
  commits: CommitRef[];
  primary_authors: string[];
  last_changed: string;
  change_frequency: number;
  rationale_snippets: string[];
  pr_references: string[];
  changelog_entries: string[];
}

export type SmellCategory =
  | 'duplicate_logic'
  | 'unclear_coupling'
  | 'low_cohesion'
  | 'god_node'
  | 'unstable_interface'
  | 'orphan_node'
  | 'circular_dependency'
  | 'over_connected';

export interface StructuralWarning {
  category: SmellCategory;
  severity: 'low' | 'medium' | 'high';
  description: string;
  related_node_ids: string[];
  heuristic: string;
}

export type RiskFactor =
  | 'high_coupling'
  | 'no_test_coverage'
  | 'frequent_changes'
  | 'large_blast_radius'
  | 'critical_path'
  | 'single_author'
  | 'recent_churn'
  | 'has_structural_warnings';

export interface NodeLocation {
  file: string;
  start_line?: number;
  end_line?: number;
}

export interface SprangNode {
  id: string;
  type: NodeType;
  label: string;
  location?: NodeLocation;
  summary?: string;
  complexity?: 'simple' | 'moderate' | 'complex';
  tags?: string[];
  layer?: string;
  metadata?: Record<string, unknown>;
  decision_context?: DecisionContext;
  structural_warnings?: StructuralWarning[];
  risk_score?: number;
  risk_factors?: RiskFactor[];
  annotations?: Annotation[];
}

export interface SprangEdge {
  source: string;
  target: string;
  type: EdgeType;
  weight?: number;
  metadata?: Record<string, unknown>;
}

export interface Layer {
  id: string;
  name: string;
  description?: string;
  node_ids: string[];
}

export interface TourStep {
  node_id: string;
  step_title: string;
  explanation: string;
  highlight?: boolean;
}

export interface Tour {
  id: string;
  title: string;
  description: string;
  entry_point?: string;
  steps: TourStep[];
}

export interface DomainStep {
  id: string;
  label: string;
  summary?: string;
  node_ids: string[];
  weight: number;
}

export interface DomainFlow {
  id: string;
  label: string;
  summary?: string;
  steps: DomainStep[];
  entry_points?: string[];
  business_rules?: string[];
}

export interface Domain {
  id: string;
  label: string;
  summary?: string;
  flows: DomainFlow[];
  entities?: string[];
}

export interface GraphStats {
  node_count: number;
  edge_count: number;
  risk_summary: { high: number; medium: number; low: number };
  smell_summary: Partial<Record<SmellCategory, number>>;
  llm_token_usage?: number;
  generated_at: string;
  phase2_completed_at?: string;
}

export type GraphPhase = 'skeleton' | 'complete';

export interface KnowledgeGraph {
  version: string;
  generated_at: string;
  project_root: string;
  project_name: string;
  description?: string;
  languages?: string[];
  frameworks?: string[];
  phase: GraphPhase;
  nodes: SprangNode[];
  edges: SprangEdge[];
  layers: Layer[];
  tours: Tour[];
  domains: Domain[];
  stats: GraphStats;
}

export interface Annotation {
  node_id: string;
  node_label: string;
  annotated_by?: string;
  annotated_at: string;
  tags?: string[];
  content: string;
}
