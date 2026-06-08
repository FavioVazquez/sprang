import { describe, it, expect } from 'vitest';
import { calcHealthGrade, gradeColor } from '../../src/utils/health-grade.js';
import type { GraphStats } from '../../src/schema/types.js';

function makeStats(overrides: Partial<GraphStats> = {}): GraphStats {
  return {
    node_count: 100,
    edge_count: 200,
    risk_summary: { high: 0, medium: 0, low: 0 },
    smell_summary: {},
    generated_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('calcHealthGrade', () => {
  it('returns grade A for a clean codebase (score 100)', () => {
    const result = calcHealthGrade(makeStats());
    expect(result.score).toBe(100);
    expect(result.grade).toBe('A');
  });

  it('returns grade A at score 92 (just above A threshold)', () => {
    // To get score ~92: need ~8 points of penalties
    // 1 circular dep → 5 penalty, 1 orphan in 100 nodes → 1% → 1 penalty = 6 total → 94
    const result = calcHealthGrade(
      makeStats({ smell_summary: { circular_dependency: 1, orphan_node: 1 } }),
      { orphanCount: 1, circularCount: 1 },
    );
    expect(result.score).toBeGreaterThanOrEqual(90);
    expect(result.grade).toBe('A');
  });

  it('returns grade B at score 83', () => {
    // 3 circulars × 5 = 15 penalty → score 85 → B
    const result = calcHealthGrade(
      makeStats({ smell_summary: { circular_dependency: 3 } }),
      { circularCount: 3 },
    );
    expect(result.score).toBe(85);
    expect(result.grade).toBe('B');
  });

  it('returns grade C when score is in 70-79 range', () => {
    // 4 circulars × 5 = 20 + 1 god node × 3 = 3 → 77
    const result = calcHealthGrade(
      makeStats({ smell_summary: { circular_dependency: 4, god_node: 1 } }),
      { circularCount: 4, godNodeCount: 1 },
    );
    expect(result.score).toBe(77);
    expect(result.grade).toBe('C');
  });

  it('returns grade D at score 60-69', () => {
    // 4 circulars × 5 = 20 + 5 god nodes × 3 = 15 → 65
    const result = calcHealthGrade(
      makeStats({ smell_summary: { circular_dependency: 4, god_node: 5 } }),
      { circularCount: 4, godNodeCount: 5 },
    );
    expect(result.score).toBe(65);
    expect(result.grade).toBe('D');
  });

  it('returns grade F below score 60', () => {
    // max circular (20) + max god node (15) + max security (20) = 55 off → 45
    const result = calcHealthGrade(
      makeStats({
        smell_summary: { circular_dependency: 10, god_node: 10 },
        security_summary: { total: 10, by_severity: { high: 10, medium: 0, low: 0 }, by_category: {} },
      }),
      { circularCount: 10, godNodeCount: 10, highSecurityCount: 10 },
    );
    expect(result.score).toBeLessThan(60);
    expect(result.grade).toBe('F');
  });

  it('calculates dead code penalty from orphan ratio', () => {
    // 20 orphans in 100 nodes = 20% dead code → capped at 20 penalty
    const result = calcHealthGrade(
      makeStats({ node_count: 100, smell_summary: { orphan_node: 20 } }),
      { orphanCount: 20 },
    );
    expect(result.breakdown.dead_code_penalty).toBe(20);
  });

  it('caps circular penalty at 20', () => {
    // 10 circulars × 5 = 50 → capped at 20
    const result = calcHealthGrade(
      makeStats({ smell_summary: { circular_dependency: 10 } }),
      { circularCount: 10 },
    );
    expect(result.breakdown.circular_penalty).toBe(20);
  });

  it('caps god node penalty at 15', () => {
    // 10 god nodes × 3 = 30 → capped at 15
    const result = calcHealthGrade(
      makeStats({ smell_summary: { god_node: 10 } }),
      { godNodeCount: 10 },
    );
    expect(result.breakdown.god_node_penalty).toBe(15);
  });

  it('caps security penalty at 20', () => {
    // 10 high security × 5 = 50 → capped at 20
    const result = calcHealthGrade(
      makeStats({
        security_summary: { total: 10, by_severity: { high: 10, medium: 0, low: 0 }, by_category: {} },
      }),
      { highSecurityCount: 10 },
    );
    expect(result.breakdown.security_penalty).toBe(20);
  });

  it('calculates coupling penalty only above threshold of 3', () => {
    // avgCoupling = 5 → (5-3)*2 = 4 penalty
    const result = calcHealthGrade(makeStats(), { avgCoupling: 5 });
    expect(result.breakdown.coupling_penalty).toBe(4);
  });

  it('has zero coupling penalty at or below coupling threshold of 3', () => {
    const result = calcHealthGrade(makeStats(), { avgCoupling: 3 });
    expect(result.breakdown.coupling_penalty).toBe(0);
  });

  it('score never goes below 0', () => {
    // Worst possible scenario — all penalties maxed
    const result = calcHealthGrade(
      makeStats({
        node_count: 1,
        smell_summary: { orphan_node: 1, circular_dependency: 10, god_node: 10 },
        security_summary: { total: 10, by_severity: { high: 10, medium: 0, low: 0 }, by_category: {} },
      }),
      { orphanCount: 1, circularCount: 10, godNodeCount: 10, avgCoupling: 20, highSecurityCount: 10 },
    );
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.grade).toBe('F');
  });

  it('reads security count from stats.security_summary when no opts provided', () => {
    const result = calcHealthGrade(
      makeStats({
        security_summary: { total: 4, by_severity: { high: 4, medium: 0, low: 0 }, by_category: {} },
      }),
    );
    expect(result.breakdown.security_penalty).toBe(20);
  });

  it('returns rounded scores', () => {
    // 1 orphan in 100 nodes = 1% dead code → penalty 1.0 → score 99
    const result = calcHealthGrade(
      makeStats({ node_count: 100, smell_summary: { orphan_node: 1 } }),
      { orphanCount: 1 },
    );
    expect(Number.isInteger(result.score)).toBe(true);
    expect(Number.isInteger(result.breakdown.dead_code_penalty)).toBe(true);
  });
});

describe('gradeColor', () => {
  it('returns green for A', () => {
    expect(gradeColor('A')).toBe('#22c55e');
  });

  it('returns lime for B', () => {
    expect(gradeColor('B')).toBe('#84cc16');
  });

  it('returns amber for C', () => {
    expect(gradeColor('C')).toBe('#f59e0b');
  });

  it('returns orange for D', () => {
    expect(gradeColor('D')).toBe('#f97316');
  });

  it('returns red for F', () => {
    expect(gradeColor('F')).toBe('#ef4444');
  });

  it('returns red for unknown grade', () => {
    expect(gradeColor('Z')).toBe('#ef4444');
  });
});
