import type { AgentContext, AgentResult } from './base.js';
import { BaseAgent } from './base.js';
import type {
  KnowledgeGraph,
  RiskFactor,
  SprangNode,
} from '../schema/types.js';
import { DEFAULT_RISK_WEIGHTS } from '../schema/constants.js';

// ─── Types ────────────────────────────────────────────────────────────────────

interface NodeRiskDetail {
  nodeId: string;
  nodeLabel: string;
  risk_score: number;
  risk_factors: RiskFactor[];
  blast_radius_score: number;
  coupling_density_score: number;
  test_gap_score: number;
  churn_score: number;
}

interface RiskScoresOutput {
  generatedAt: string;
  nodes: NodeRiskDetail[];
  risk_summary: { high: number; medium: number; low: number };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function isTestNode(node: SprangNode): boolean {
  const label = node.label;
  return (
    /\.test\.tsx?$/.test(label) ||
    /\.spec\.tsx?$/.test(label) ||
    /\.test\.jsx?$/.test(label) ||
    /\.spec\.jsx?$/.test(label)
  );
}

function isTestFile(label: string): boolean {
  return (
    /\.test\.tsx?$/.test(label) ||
    /\.spec\.tsx?$/.test(label) ||
    /\.test\.jsx?$/.test(label) ||
    /\.spec\.jsx?$/.test(label)
  );
}

function isConfigNode(node: SprangNode): boolean {
  return node.type === 'config';
}

// ─── BFS for blast radius ─────────────────────────────────────────────────────

function computeBlastRadius(
  nodeId: string,
  inEdges: Map<string, Array<{ source: string }>>,
  totalNodeCount: number
): number {
  // BFS following INCOMING edges: find all nodes that (transitively) depend on nodeId
  const visited = new Set<string>();
  const queue: string[] = [nodeId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const edge of inEdges.get(current) ?? []) {
      if (!visited.has(edge.source)) {
        visited.add(edge.source);
        queue.push(edge.source);
      }
    }
  }

  // visited doesn't include self
  const reachableCount = visited.size;
  return Math.min(reachableCount / totalNodeCount, 1.0);
}

// ─── Agent ────────────────────────────────────────────────────────────────────

export class RiskScorerAgent extends BaseAgent {
  readonly id = 'risk-scorer';
  readonly phase = 2 as const;

  async run(ctx: AgentContext): Promise<AgentResult> {
    const graph = ctx.graph;

    // Build adjacency maps
    const inEdges = new Map<string, Array<{ source: string; type: string }>>();
    const outEdges = new Map<string, Array<{ target: string; type: string }>>();

    for (const node of graph.nodes) {
      inEdges.set(node.id, []);
      outEdges.set(node.id, []);
    }

    for (const edge of graph.edges) {
      inEdges.get(edge.target)?.push({ source: edge.source, type: edge.type });
      outEdges.get(edge.source)?.push({ target: edge.target, type: edge.type });
    }

    // Build node map
    const nodeMap = new Map<string, SprangNode>(graph.nodes.map((n) => [n.id, n]));

    // Build test-node set for quick lookup
    const testNodeIds = new Set<string>(
      graph.nodes.filter(isTestNode).map((n) => n.id)
    );

    // Build tour appearance count: nodeId → count of tours it appears in
    const tourAppearances = new Map<string, number>();
    for (const tour of graph.tours) {
      const seenInTour = new Set<string>();
      for (const step of tour.steps) {
        const nodeIds = step.node_ids ?? (step.node_id ? [step.node_id] : []);
        for (const nid of nodeIds) {
          if (!seenInTour.has(nid)) {
            seenInTour.add(nid);
            tourAppearances.set(nid, (tourAppearances.get(nid) ?? 0) + 1);
          }
        }
      }
    }

    const totalNodeCount = graph.nodes.length;
    const {
      maxCouplingDegree,
      maxChurnCommits90d,
      blastRadius: w_blast,
      couplingDensity: w_coupling,
      testGap: w_test,
      churn: w_churn,
    } = DEFAULT_RISK_WEIGHTS;

    const riskDetails: NodeRiskDetail[] = [];
    const riskSummary = { high: 0, medium: 0, low: 0 };

    for (const node of graph.nodes) {
      // Skip config nodes and test files
      if (isConfigNode(node) || isTestFile(node.label)) continue;

      // ── blast_radius_score ──────────────────────────────────────────────────
      const blastRadiusScore = computeBlastRadius(node.id, inEdges, totalNodeCount);

      // ── coupling_density_score ──────────────────────────────────────────────
      const inDegree = (inEdges.get(node.id) ?? []).length;
      const outDegree = (outEdges.get(node.id) ?? []).length;
      const directDeps = inDegree + outDegree;

      const hasCircularDep = node.structural_warnings?.some(
        (w) => w.category === 'circular_dependency'
      ) ?? false;

      const couplingBase = Math.min(directDeps / maxCouplingDegree, 1.0);
      const couplingDensityScore = Math.min(couplingBase + (hasCircularDep ? 0.2 : 0), 1.0);

      // ── test_gap_score ──────────────────────────────────────────────────────
      const hasDirectTest = graph.edges.some((e) => {
        if (e.target !== node.id) return false;
        if (e.type !== 'tested_by' && e.type !== 'calls') return false;
        return testNodeIds.has(e.source);
      });

      const testGapScore = hasDirectTest
        ? 0.0
        : 0.5 + Math.min(blastRadiusScore * 0.5, 0.5);

      // ── churn_score ─────────────────────────────────────────────────────────
      const changeFrequency = node.decision_context?.change_frequency;
      const churnScore =
        changeFrequency !== undefined
          ? Math.min(changeFrequency / maxChurnCommits90d, 1.0)
          : 0.0;

      // ── risk_score ──────────────────────────────────────────────────────────
      const rawScore =
        blastRadiusScore * w_blast +
        couplingDensityScore * w_coupling +
        testGapScore * w_test +
        churnScore * w_churn;

      const riskScore = clamp(rawScore, 0.0, 1.0);

      // ── risk_factors ────────────────────────────────────────────────────────
      const riskFactors: RiskFactor[] = [];

      if (couplingDensityScore > 0.6) {
        riskFactors.push('high_coupling');
      }

      if (testGapScore > 0.5) {
        riskFactors.push('no_test_coverage');
      }

      if (churnScore > 0.5) {
        riskFactors.push('frequent_changes');
      }

      if (blastRadiusScore > 0.5) {
        riskFactors.push('large_blast_radius');
      }

      const tourCount = tourAppearances.get(node.id) ?? 0;
      if (tourCount >= 2 && blastRadiusScore > 0.3) {
        riskFactors.push('critical_path');
      }

      if (
        node.decision_context &&
        node.decision_context.primary_authors.length === 1 &&
        (node.decision_context.change_frequency ?? 0) > 5
      ) {
        riskFactors.push('single_author');
      }

      if (node.decision_context) {
        const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;
        const cutoff = Date.now() - fourteenDaysMs;
        const recentCommits = node.decision_context.commits.filter(
          (c) => new Date(c.date).getTime() >= cutoff
        ).length;
        if (recentCommits >= 3) {
          riskFactors.push('recent_churn');
        }
      }

      if ((node.structural_warnings?.length ?? 0) > 0) {
        riskFactors.push('has_structural_warnings');
      }

      // Mutate node in graph
      node.risk_score = riskScore;
      node.risk_factors = riskFactors;

      // Track summary
      if (riskScore > 0.7) {
        riskSummary.high++;
      } else if (riskScore >= 0.4) {
        riskSummary.medium++;
      } else {
        riskSummary.low++;
      }

      riskDetails.push({
        nodeId: node.id,
        nodeLabel: node.label,
        risk_score: riskScore,
        risk_factors: riskFactors,
        blast_radius_score: blastRadiusScore,
        coupling_density_score: couplingDensityScore,
        test_gap_score: testGapScore,
        churn_score: churnScore,
      });
    }

    // Update graph stats
    graph.stats.risk_summary = riskSummary;

    // Write intermediate output
    const output: RiskScoresOutput = {
      generatedAt: new Date().toISOString(),
      nodes: riskDetails,
      risk_summary: riskSummary,
    };
    await this.writeIntermediate(ctx, 'risk-scores.json', output);

    return this.success(ctx, graph);
  }
}
