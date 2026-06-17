import type { GraphLoader } from '../graph-loader.js';
import type { RiskFactor, SmellCategory } from '@sprang/core';
import { calcHealthGrade, gradeColor, loadHistory } from '@sprang/core';

export interface SprangHealthInput {
  // no fields required
}

export interface TopRiskyNode {
  node_id: string;
  label: string;
  type: string;
  risk_score: number;
  risk_factors: RiskFactor[];
}

export interface SprangHealthResult {
  phase: string;
  generated_at: string;
  phase2_completed_at?: string;
  total_nodes: number;
  total_edges: number;
  risk_summary: { high: number; medium: number; low: number };
  smell_summary: Partial<Record<SmellCategory, number>>;
  top_10_risky_nodes: TopRiskyNode[];
  orphan_count: number;
  circular_dependency_count: number;
  nodes_without_tests: number;
  health_score: number;
  health_grade: string;
  grade_color: string;
  grade_breakdown: {
    dead_code_penalty: number;
    circular_penalty: number;
    god_node_penalty: number;
    coupling_penalty: number;
    security_penalty: number;
  };
  security_summary: {
    total: number;
    by_severity: { high: number; medium: number; low: number };
    by_category: Partial<Record<string, number>>;
  };
  history: Array<{
    timestamp: string;
    health_score: number;
    health_grade: string;
    total_nodes: number;
    total_edges: number;
    smell_count: number;
    security_count: number;
  }>;
}

export async function sprangHealth(
  loader: GraphLoader,
  _input: SprangHealthInput
): Promise<SprangHealthResult | { error: string; code: string }> {
  const graph = await loader.getGraph();
  if (!graph) {
    return { error: 'Knowledge graph not found — run sprang scan first', code: 'GRAPH_NOT_FOUND' };
  }

  // Build edge lookup for orphan detection
  const nodeIdsWithEdges = new Set<string>();
  for (const edge of graph.edges) {
    nodeIdsWithEdges.add(edge.source);
    nodeIdsWithEdges.add(edge.target);
  }

  const orphanCount = graph.nodes.filter((n) => !nodeIdsWithEdges.has(n.id)).length;

  const circularDependencyCount = graph.nodes.filter((n) =>
    n.structural_warnings?.some((w) => w.category === 'circular_dependency')
  ).length;

  const testedNodeIds = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.type === 'tested_by') testedNodeIds.add(edge.target);
  }

  const nodesWithoutTests = graph.nodes.filter((n) => {
    const isTestNode = n.type === 'file' && (
      n.location?.file.includes('.test.') ||
      n.location?.file.includes('.spec.') ||
      n.location?.file.includes('__tests__')
    );
    return !isTestNode && !testedNodeIds.has(n.id);
  }).length;

  const sortedByRisk = [...graph.nodes]
    .filter((n) => n.risk_score !== undefined)
    .sort((a, b) => (b.risk_score ?? 0) - (a.risk_score ?? 0))
    .slice(0, 10);

  const top10: TopRiskyNode[] = sortedByRisk.map((n) => ({
    node_id: n.id,
    label: n.label,
    type: n.type,
    risk_score: n.risk_score ?? 0,
    risk_factors: n.risk_factors ?? [],
  }));

  const godNodeCount = graph.stats.smell_summary['god_node'] ?? 0;
  const gradeResult = calcHealthGrade(graph.stats, {
    orphanCount,
    circularCount: circularDependencyCount,
    godNodeCount,
  });

  const securitySummary = graph.stats.security_summary ?? {
    total: 0,
    by_severity: { high: 0, medium: 0, low: 0 },
    by_category: {},
  };

  const projectRoot = process.env.SPRANG_ROOT ?? '.';
  const history = await loadHistory(projectRoot).catch(() => []);

  return {
    phase: graph.phase,
    generated_at: graph.generated_at,
    phase2_completed_at: graph.stats.phase2_completed_at,
    total_nodes: graph.stats.node_count,
    total_edges: graph.stats.edge_count,
    risk_summary: graph.stats.risk_summary,
    smell_summary: graph.stats.smell_summary,
    top_10_risky_nodes: top10,
    orphan_count: orphanCount,
    circular_dependency_count: circularDependencyCount,
    nodes_without_tests: nodesWithoutTests,
    health_score: gradeResult.score,
    health_grade: gradeResult.grade,
    grade_color: gradeColor(gradeResult.grade),
    grade_breakdown: gradeResult.breakdown,
    security_summary: securitySummary,
    history: history.slice(-30),
  };
}
