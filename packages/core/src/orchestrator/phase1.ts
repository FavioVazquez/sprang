import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { ensureDir, writeFileAtomic, fileExists } from '../utils/fs.js';
import { createEmptyGraph, saveGraph } from '../graph/store.js';
import { normalizeGraph } from '../graph/normalize.js';
import { ProjectScannerAgent } from '../agents/project-scanner.js';
import { FileAnalyzerAgent } from '../agents/file-analyzer.js';
import type { LLMClient } from '../llm/client.js';
import type { KnowledgeGraph, ScanResult } from '../schema/types.js';
import type { AgentContext, SprangOptions } from '../agents/base.js';
import {
  INTERMEDIATE_DIR,
  CACHE_DIR,
  REPORT_FILE,
} from '../schema/constants.js';

export async function runPhase1(
  projectRoot: string,
  sprangDir: string,
  options: SprangOptions,
  llm: LLMClient,
  onProgress?: (msg: string) => void
): Promise<KnowledgeGraph> {
  const log = onProgress ?? ((msg: string) => process.stdout.write(msg + '\n'));

  const intermediateDir = join(sprangDir, INTERMEDIATE_DIR);
  const cacheDir = join(sprangDir, CACHE_DIR);

  await ensureDir(sprangDir);
  await ensureDir(intermediateDir);
  await ensureDir(cacheDir);

  log('[phase1] Initialising knowledge graph...');
  let graph = createEmptyGraph(projectRoot, '');

  const baseCtx: AgentContext = {
    projectRoot,
    sprangDir,
    intermediateDir,
    cacheDir,
    graph,
    llm,
    options,
  };

  // Step 1: Project scanner
  log('[phase1] Running ProjectScannerAgent...');
  const scanner = new ProjectScannerAgent();
  const scanResult = await scanner.run(baseCtx);
  if (!scanResult.success) {
    log(`[phase1] ProjectScannerAgent failed: ${scanResult.error ?? 'unknown error'}`);
  } else {
    log(
      `[phase1] Scan complete: ${scanResult.mutatedGraph.nodes.length} file nodes found.`
    );
  }
  graph = scanResult.mutatedGraph;

  // Step 2: File analyzer
  log('[phase1] Running FileAnalyzerAgent...');
  const analyzerCtx: AgentContext = { ...baseCtx, graph };
  const analyzer = new FileAnalyzerAgent();
  const analyzeResult = await analyzer.run(analyzerCtx);
  if (!analyzeResult.success) {
    log(`[phase1] FileAnalyzerAgent failed: ${analyzeResult.error ?? 'unknown error'}`);
  } else {
    log(
      `[phase1] Analysis complete: ${analyzeResult.mutatedGraph.nodes.length} nodes, ` +
        `${analyzeResult.mutatedGraph.edges.length} edges.`
    );
  }
  graph = analyzeResult.mutatedGraph;

  // Update stats
  const now = new Date().toISOString();
  graph = {
    ...graph,
    generated_at: now,
    phase: 'skeleton',
    stats: {
      ...graph.stats,
      node_count: graph.nodes.length,
      edge_count: graph.edges.length,
      generated_at: now,
    },
  };

  // Normalize graph before saving
  const { graph: normalizedGraph, report } = normalizeGraph(graph);
  if (report.dedupedNodes > 0 || report.danglingEdges > 0 || report.doublePrefix > 0) {
    log(
      `[sprang] Graph normalized: ${report.doublePrefix} ID fixes, ${report.dedupedNodes} dup nodes, ` +
        `${report.dedupedEdges} dup edges, ${report.danglingEdges} dangling edges removed`
    );
  }
  graph = normalizedGraph;

  // Save skeleton graph
  log('[phase1] Saving skeleton knowledge graph...');
  await saveGraph(sprangDir, graph);

  // Write SPRANG_REPORT.md skeleton
  const scanData = await readScanResult(intermediateDir);
  const fileCount = scanData?.totalFiles ?? graph.nodes.filter((n) => n.type === 'file').length;
  const reportContent = buildSkeletonReport(graph, fileCount);
  await writeFileAtomic(join(sprangDir, REPORT_FILE), reportContent);
  log('[phase1] SPRANG_REPORT.md written.');

  return graph;
}

async function readScanResult(intermediateDir: string): Promise<ScanResult | null> {
  try {
    const scanPath = join(intermediateDir, 'scan-result.json');
    if (!(await fileExists(scanPath))) return null;
    const raw = await readFile(scanPath, 'utf-8');
    return JSON.parse(raw) as ScanResult;
  } catch {
    return null;
  }
}

function buildSkeletonReport(graph: KnowledgeGraph, fileCount: number): string {
  const lines: string[] = [
    `# Sprang Report: ${graph.project_name}`,
    '',
    `> Generated at: ${graph.generated_at}`,
    '',
    '## Summary',
    '',
    `- **Project**: ${graph.project_name}`,
    `- **Root**: ${graph.project_root}`,
    `- **Files scanned**: ${fileCount}`,
    `- **Graph nodes**: ${graph.nodes.length}`,
    `- **Graph edges**: ${graph.edges.length}`,
    '',
    '## Languages',
    '',
    (graph.languages ?? []).map((l) => `- ${l}`).join('\n') || '- (none detected)',
    '',
    '## Frameworks',
    '',
    (graph.frameworks ?? []).map((f) => `- ${f}`).join('\n') || '- (none detected)',
    '',
    '## Status',
    '',
    '**Phase 1 (skeleton) complete.** Phase 2 analysis running in background...',
    '',
    '_Full summaries, decision context, structural warnings, and risk scores will be populated by Phase 2._',
    '',
  ];
  return lines.join('\n');
}
