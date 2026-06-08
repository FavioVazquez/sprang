import { existsSync, mkdirSync } from 'node:fs';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import type { KnowledgeGraph, HistorySnapshot } from '../schema/types.js';
import { calcHealthGrade } from './health-grade.js';

const HISTORY_FILE = '.sprang/history.json';
const MAX_SNAPSHOTS = 50;

export async function appendSnapshot(
  projectRoot: string,
  graph: KnowledgeGraph,
  gitHash?: string,
): Promise<void> {
  const historyPath = join(projectRoot, HISTORY_FILE);
  const dir = dirname(historyPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  let snapshots: HistorySnapshot[] = [];
  try {
    const raw = await readFile(historyPath, 'utf-8');
    snapshots = JSON.parse(raw) as HistorySnapshot[];
  } catch { /* first run or corrupt — start fresh */ }

  const connectedIds = new Set([
    ...graph.edges.map((e) => e.source),
    ...graph.edges.map((e) => e.target),
  ]);
  const orphanCount = graph.nodes.filter((n) => !connectedIds.has(n.id)).length;

  const circularCount = graph.nodes.filter((n) =>
    n.structural_warnings?.some((w) => w.category === 'circular_dependency')
  ).length;

  const godNodeCount = graph.stats.smell_summary['god_node'] ?? 0;
  const gradeResult = calcHealthGrade(graph.stats, { orphanCount, circularCount, godNodeCount });

  const smellCount = Object.values(graph.stats.smell_summary).reduce(
    (a, b) => a + (b ?? 0), 0,
  );
  const securityCount = graph.stats.security_summary?.total ?? 0;

  const snapshot: HistorySnapshot = {
    timestamp: new Date().toISOString(),
    gitHash,
    phase: graph.phase,
    health_score: gradeResult.score,
    health_grade: gradeResult.grade,
    total_nodes: graph.nodes.length,
    total_edges: graph.edges.length,
    risk_summary: { ...graph.stats.risk_summary },
    smell_count: smellCount,
    security_count: securityCount,
  };

  snapshots.push(snapshot);
  if (snapshots.length > MAX_SNAPSHOTS) {
    snapshots = snapshots.slice(snapshots.length - MAX_SNAPSHOTS);
  }

  const tmp = historyPath + '.tmp';
  await writeFile(tmp, JSON.stringify(snapshots, null, 2), 'utf-8');
  await rename(tmp, historyPath);
}

export async function loadHistory(projectRoot: string): Promise<HistorySnapshot[]> {
  const historyPath = join(projectRoot, HISTORY_FILE);
  try {
    const raw = await readFile(historyPath, 'utf-8');
    return JSON.parse(raw) as HistorySnapshot[];
  } catch {
    return [];
  }
}
