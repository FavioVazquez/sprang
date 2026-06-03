// 16 node types covering files, code constructs, and architectural concepts
export const NODE_TYPES = [
  'file', 'function', 'class', 'module', 'concept',
  'config', 'document', 'service', 'table', 'endpoint',
  'pipeline', 'schema', 'resource',
  'domain', 'flow', 'step',
] as const;
export type NodeType = typeof NODE_TYPES[number];

// Edge types (29)
export const EDGE_TYPES = [
  // structural
  'imports', 'exports', 'contains', 'inherits', 'implements',
  // behavioral
  'calls', 'subscribes', 'publishes', 'middleware',
  // data flow
  'reads_from', 'writes_to', 'transforms', 'validates',
  // dependencies
  'depends_on', 'tests', 'configures',
  // semantic
  'related', 'similar_to',
  // infrastructure
  'deploys', 'serves', 'provisions', 'triggers', 'migrates',
  'documents', 'routes', 'defines_schema',
  // domain
  'contains_flow', 'flow_step', 'cross_domain',
] as const;
export type EdgeType = typeof EDGE_TYPES[number];

// ─── Sprang extensions ───────────────────────────────────────────────

export interface CommitRef {
  sha: string;         // 7-char short SHA
  date: string;        // ISO-8601
  message: string;     // first line only
  author: string;
  diff_summary?: string; // LLM-condensed diff for this file
}

export interface DecisionContext {
  commits: CommitRef[];
  primary_authors: string[];
  last_changed: string;         // ISO-8601
  change_frequency: number;     // commits in last 90 days
  rationale_snippets: string[]; // LLM-extracted "why" from commit messages
  pr_references: string[];      // "#123" patterns from commit messages
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
  heuristic: string; // e.g. "out_degree > 20"
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

// ─── Core graph types ────────────────────────────────────────────────

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
  // Sprang extensions
  decision_context?: DecisionContext;
  structural_warnings?: StructuralWarning[];
  risk_score?: number;       // 0.0–1.0
  risk_factors?: RiskFactor[];
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
  weight: number; // 0.0–1.0, monotonically increasing within flow
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

// ─── Agent I/O types ─────────────────────────────────────────────────

export interface FileRecord {
  path: string;              // project-relative
  absolutePath: string;
  language: string;
  sizeLines: number;
  fileCategory: string;
  mtime: number;
}

export interface ImportEdge {
  from: string;
  to: string;
  resolved: boolean;
}

export interface ScanResult {
  name: string;
  description?: string;
  languages: string[];
  frameworks: string[];
  files: FileRecord[];
  totalFiles: number;
  filteredByIgnore: number;
  estimatedComplexity: string;
  importMap: Record<string, string[]>;
}

export interface FunctionRecord {
  name: string;
  start_line: number;
  end_line: number;
  param_count: number;
  cyclomatic_complexity: number;
  exported: boolean;
  return_type?: string;
}

export interface ClassRecord {
  name: string;
  start_line: number;
  end_line: number;
  method_count: number;
  exported: boolean;
}

export interface FileAnalysis {
  path: string;
  functions: FunctionRecord[];
  classes: ClassRecord[];
  topLevelExports: string[];
  summary?: string;
  complexity: 'simple' | 'moderate' | 'complex';
  tags?: string[];
}

// ─── Annotation format ────────────────────────────────────────────────

export interface Annotation {
  node_id: string;
  node_label: string;
  annotated_by?: string;
  annotated_at: string;
  tags?: string[];
  content: string; // raw markdown body
}
