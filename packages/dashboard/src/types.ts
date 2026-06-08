// Essential types mirrored from @sprang/core — used directly in browser build

export const NODE_TYPES = [
  // code
  'file', 'function', 'class', 'module', 'concept',
  // non-code
  'config', 'document', 'service', 'table', 'endpoint',
  'pipeline', 'schema', 'resource',
  // domain
  'domain', 'flow', 'step',
  // knowledge
  'article', 'entity', 'topic', 'claim', 'source',
] as const;
export type NodeType = typeof NODE_TYPES[number];

export const EDGE_TYPES = [
  // structural
  'imports', 'exports', 'contains', 'inherits', 'implements',
  // behavioral
  'calls', 'subscribes', 'publishes', 'middleware',
  // data flow
  'reads_from', 'writes_to', 'transforms', 'validates',
  // dependencies
  'depends_on', 'tested_by', 'configures',
  // semantic
  'related', 'similar_to',
  // infrastructure / schema
  'deploys', 'serves', 'provisions', 'triggers', 'migrates',
  'documents', 'routes', 'defines_schema',
  // domain
  'contains_flow', 'flow_step', 'cross_domain',
  // knowledge
  'cites', 'contradicts', 'builds_on', 'exemplifies', 'categorized_under', 'authored_by',
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
  | 'over_connected'
  | 'name_duplicate';

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

export type SecurityCategory =
  | 'hardcoded_secret'
  | 'sql_injection'
  | 'xss_risk'
  | 'unsafe_eval'
  | 'unsafe_exec'
  | 'unsafe_deserialization'
  | 'path_traversal'
  | 'weak_crypto';

export interface SecurityWarning {
  category: SecurityCategory;
  severity: 'low' | 'medium' | 'high';
  description: string;
  line?: number;
  pattern: string;  // the regex/pattern that matched
  snippet?: string; // code context (max 80 chars)
}

export type DetectedPattern =
  | 'singleton'
  | 'factory'
  | 'observer'
  | 'strategy'
  | 'decorator'
  | 'react_hook'
  | 'event_emitter'
  | 'dependency_injection';

export interface HistorySnapshot {
  timestamp: string;         // ISO-8601
  gitHash?: string;          // HEAD at time of analysis
  phase: GraphPhase;
  health_score: number;      // 0-100
  health_grade: string;      // 'A'|'B'|'C'|'D'|'F'
  total_nodes: number;
  total_edges: number;
  risk_summary: { high: number; medium: number; low: number };
  smell_count: number;
  security_count: number;
}

export interface HealthGrade {
  score: number;    // 0-100
  grade: string;   // 'A'|'B'|'C'|'D'|'F'
  breakdown: {
    dead_code_penalty: number;
    circular_penalty: number;
    god_node_penalty: number;
    coupling_penalty: number;
    security_penalty: number;
  };
}

export interface NodeLocation {
  file: string;
  start_line?: number;
  end_line?: number;
}

export interface KnowledgeMeta {
  wikilinks?: string[];
  backlinks?: string[];
  category?: string;
  content?: string;
}

export interface DomainNodeMeta {
  entities?: string[];
  businessRules?: string[];
  crossDomainInteractions?: string[];
  entryPoint?: string;
  entryType?: 'http' | 'cli' | 'event' | 'cron' | 'manual';
}

export interface SprangNode {
  id: string;
  type: NodeType;
  name?: string;
  label: string;
  filePath?: string;
  lineRange?: [number, number];
  location?: NodeLocation;
  summary?: string;
  complexity?: 'simple' | 'moderate' | 'complex';
  tags?: string[];
  languageNotes?: string;
  layer?: string;
  metadata?: Record<string, unknown>;
  domainMeta?: DomainNodeMeta;
  knowledgeMeta?: KnowledgeMeta;
  decision_context?: DecisionContext;
  structural_warnings?: StructuralWarning[];
  risk_score?: number;
  risk_factors?: RiskFactor[];
  security_warnings?: SecurityWarning[];
  detected_patterns?: DetectedPattern[];
  annotations?: string[];
}

export interface SprangEdge {
  source: string;
  target: string;
  type: EdgeType;
  direction?: 'forward' | 'backward' | 'bidirectional';
  description?: string;
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
  node_id?: string;
  node_ids?: string[];
  step_title: string;
  explanation: string;
  language_lesson?: string;
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
  gitCommitHash?: string;
  security_summary?: { total: number; by_severity: { high: number; medium: number; low: number }; by_category: Partial<Record<SecurityCategory, number>> };
}

export type GraphPhase = 'skeleton' | 'complete';

export type GraphKind = 'codebase' | 'knowledge';

export interface KnowledgeGraph {
  version: string;
  /** Graph kind: 'codebase' (default) or 'knowledge' for markdown note graphs. */
  kind?: GraphKind;
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

// ─── Dashboard-specific types ─────────────────────────────────────────────────

export type Persona = 'non-technical' | 'junior' | 'senior' | 'experienced' | 'pm';
export type ViewMode = 'structural' | 'domain' | 'knowledge';
export type NodeCategory = 'code' | 'config' | 'docs' | 'infra' | 'data' | 'domain' | 'knowledge';
export type Complexity = 'simple' | 'moderate' | 'complex';
export type EdgeCategory = 'structural' | 'behavioral' | 'data-flow' | 'dependencies' | 'semantic' | 'infrastructure' | 'domain' | 'knowledge';

export const NODE_TYPE_TO_CATEGORY: Record<NodeType, NodeCategory> = {
  file: 'code', function: 'code', class: 'code', module: 'code', concept: 'code',
  config: 'config', document: 'docs',
  service: 'infra', table: 'data', endpoint: 'infra', pipeline: 'infra',
  schema: 'data', resource: 'infra',
  domain: 'domain', flow: 'domain', step: 'domain',
  article: 'knowledge', entity: 'knowledge', topic: 'knowledge', claim: 'knowledge', source: 'knowledge',
};

export const EDGE_CATEGORY_MAP: Record<EdgeCategory, EdgeType[]> = {
  structural: ['imports', 'exports', 'contains', 'inherits', 'implements'],
  behavioral: ['calls', 'subscribes', 'publishes', 'middleware'],
  'data-flow': ['reads_from', 'writes_to', 'transforms', 'validates'],
  dependencies: ['depends_on', 'tested_by', 'configures'],
  semantic: ['related', 'similar_to'],
  infrastructure: ['deploys', 'serves', 'provisions', 'triggers', 'migrates', 'documents', 'routes', 'defines_schema', 'contains_flow', 'flow_step', 'cross_domain'],
  domain: ['contains_flow', 'flow_step', 'cross_domain'],
  knowledge: ['cites', 'contradicts', 'builds_on', 'exemplifies', 'categorized_under', 'authored_by'],
};

export interface FilterState {
  nodeTypes: Set<NodeType>;
  complexities: Set<Complexity>;
  layerIds: Set<string>;
  edgeCategories: Set<EdgeCategory>;
  riskLevels: Set<'high' | 'medium' | 'low'>;
}

export interface DiffOverlay {
  version: string;
  generatedAt: string;
  baseBranch: string;
  changedFiles: string[];
  changedNodeIds: string[];
  affectedNodeIds: string[];
  blastRadius?: number;
  crossLayerChanges?: number;
}
