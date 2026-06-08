import type { GraphStats, HealthGrade } from '../schema/types.js';

/**
 * Calculate a health grade (A-F) from graph stats.
 * Formula derived from codeflow's health scoring:
 *   score = 100
 *     - min(20, dead_code_pct)
 *     - min(20, circular_count × 5)
 *     - min(15, god_node_count × 3)
 *     - min(15, max(0, avg_coupling - 3) × 2)
 *     - min(20, high_security_count × 5)
 *
 * Grade thresholds: A≥90, B≥80, C≥70, D≥60, F<60
 */
export function calcHealthGrade(
  stats: GraphStats,
  opts?: {
    orphanCount?: number;
    circularCount?: number;
    godNodeCount?: number;
    avgCoupling?: number;
    highSecurityCount?: number;
  }
): HealthGrade {
  const smells = stats.smell_summary;
  const circularCount = opts?.circularCount ?? (smells['circular_dependency'] ?? 0);
  const godNodeCount = opts?.godNodeCount ?? (smells['god_node'] ?? 0);
  const orphanCount = opts?.orphanCount ?? (smells['orphan_node'] ?? 0);
  const avgCoupling = opts?.avgCoupling ?? 0;
  const highSecurityCount = opts?.highSecurityCount ?? (stats.security_summary?.by_severity.high ?? 0);

  const totalNodes = stats.node_count || 1;
  const deadCodePct = (orphanCount / totalNodes) * 100;

  const deadPenalty = Math.min(20, deadCodePct);
  const circularPenalty = Math.min(20, circularCount * 5);
  const godNodePenalty = Math.min(15, godNodeCount * 3);
  const couplingPenalty = Math.min(15, Math.max(0, avgCoupling - 3) * 2);
  const securityPenalty = Math.min(20, highSecurityCount * 5);

  const score = Math.max(
    0,
    Math.min(
      100,
      100 - deadPenalty - circularPenalty - godNodePenalty - couplingPenalty - securityPenalty
    )
  );

  let grade: string;
  if (score >= 90) grade = 'A';
  else if (score >= 80) grade = 'B';
  else if (score >= 70) grade = 'C';
  else if (score >= 60) grade = 'D';
  else grade = 'F';

  return {
    score: Math.round(score),
    grade,
    breakdown: {
      dead_code_penalty: Math.round(deadPenalty),
      circular_penalty: Math.round(circularPenalty),
      god_node_penalty: Math.round(godNodePenalty),
      coupling_penalty: Math.round(couplingPenalty),
      security_penalty: Math.round(securityPenalty),
    },
  };
}

export function gradeColor(grade: string): string {
  switch (grade) {
    case 'A': return '#22c55e';
    case 'B': return '#84cc16';
    case 'C': return '#f59e0b';
    case 'D': return '#f97316';
    default:  return '#ef4444';
  }
}
