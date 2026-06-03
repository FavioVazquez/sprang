import path from 'node:path';
import { stat } from 'node:fs/promises';
import type { KnowledgeGraph, SprangNode, ScanResult } from '../schema/types.js';
import type { SprangOptions } from '../agents/base.js';
import { LLMClient } from '../llm/client.js';
import { loadGraph, saveGraph } from '../graph/store.js';
import { FileAnalyzerAgent } from '../agents/file-analyzer.js';
import { writeFileAtomic, ensureDir } from '../utils/fs.js';
import { getChangedFiles, saveFingerprints } from './fingerprint.js';
import { EXTENSION_TO_LANGUAGE } from '../schema/constants.js';

export async function runIncrementalUpdate(
  projectRoot: string,
  sprangDir: string,
  changedFiles: string[],
  options: SprangOptions,
  onProgress?: (msg: string) => void,
): Promise<void> {
  const cacheDir = path.join(sprangDir, 'cache');
  const intermediateDir = path.join(sprangDir, 'intermediate');

  // Filter to only truly changed files (by content hash)
  const absoluteChanged = changedFiles.map(f =>
    path.isAbsolute(f) ? f : path.join(projectRoot, f)
  );
  const { changed, updatedMap } = await getChangedFiles(absoluteChanged, cacheDir);

  if (changed.length === 0) {
    onProgress?.('No content changes detected, skipping update');
    return;
  }

  onProgress?.(`Incrementally updating ${changed.length} changed file(s)...`);

  let graph = await loadGraph(sprangDir);
  const llm = new LLMClient(process.env['ANTHROPIC_API_KEY']);

  // Convert to project-relative paths
  const relativeChanged = changed.map(f =>
    path.isAbsolute(f) ? path.relative(projectRoot, f) : f
  );

  // Find all node IDs for changed files
  const affectedNodeIds = new Set<string>();
  for (const relPath of relativeChanged) {
    const nodeId = `file:${relPath}`;
    if (graph.nodes.some(n => n.id === nodeId)) {
      affectedNodeIds.add(nodeId);
    }
  }

  // Also include 1-hop importers of changed files (they may have stale edge data)
  const importerIds = new Set<string>();
  for (const nodeId of affectedNodeIds) {
    for (const edge of graph.edges) {
      if (edge.target === nodeId && edge.type === 'imports') {
        importerIds.add(edge.source);
      }
    }
  }
  for (const id of importerIds) affectedNodeIds.add(id);

  // Remove stale nodes and their edges
  const staleIds = new Set(
    relativeChanged.map(p => `file:${p}`)
  );
  graph = {
    ...graph,
    nodes: graph.nodes.filter(n => !staleIds.has(n.id)),
    edges: graph.edges.filter(e => !staleIds.has(e.source) && !staleIds.has(e.target)),
  };

  // Write a minimal scan-result for only the changed files so FileAnalyzerAgent
  // re-analyzes just those files in the next step
  await ensureDir(intermediateDir);
  const changedFileRecords = await Promise.all(
    relativeChanged.map(async (relPath) => {
      const absPath = path.join(projectRoot, relPath);
      const ext = path.extname(relPath).slice(1);
      let lines = 0;
      let mtime = Date.now();
      try {
        const content = await import('node:fs/promises').then(m => m.readFile(absPath, 'utf-8'));
        lines = content.split('\n').length;
        const s = await stat(absPath);
        mtime = s.mtimeMs;
      } catch { /* deleted file — skip */ }
      const language = EXTENSION_TO_LANGUAGE[ext] ?? 'unknown';
      return {
        path: relPath,
        absolutePath: absPath,
        language,
        sizeLines: lines,
        fileCategory: 'source',
        mtime,
      };
    })
  );
  const partialScan: ScanResult = {
    name: path.basename(projectRoot),
    languages: [...new Set(changedFileRecords.map(f => f.language).filter(l => l !== 'unknown'))],
    frameworks: [],
    files: changedFileRecords,
    totalFiles: changedFileRecords.length,
    filteredByIgnore: 0,
    estimatedComplexity: 'unknown',
    importMap: {},
  };
  await writeFileAtomic(
    path.join(intermediateDir, 'scan-result.json'),
    JSON.stringify(partialScan, null, 2),
  );

  const ctx = {
    projectRoot,
    sprangDir,
    intermediateDir,
    cacheDir,
    graph,
    llm,
    options: { ...options, phase: 1 as const },
  };

  const analyzer = new FileAnalyzerAgent();
  const result = await analyzer.run(ctx);
  if (result.success) {
    graph = result.mutatedGraph;
  }

  // Re-run smell detector and risk scorer on affected subgraph
  try {
    const { SmellDetectorAgent } = await import('../agents/smell-detector.js');
    const smellResult = await new SmellDetectorAgent().run({ ...ctx, graph });
    if (smellResult.success) graph = smellResult.mutatedGraph;
  } catch {}

  try {
    const { RiskScorerAgent } = await import('../agents/risk-scorer.js');
    const riskResult = await new RiskScorerAgent().run({ ...ctx, graph });
    if (riskResult.success) graph = riskResult.mutatedGraph;
  } catch {}

  // Atomic save
  await saveGraph(sprangDir, graph);
  await saveFingerprints(cacheDir, updatedMap);

  onProgress?.(`✓ Updated ${changed.length} file(s), graph now has ${graph.nodes.length} nodes`);
}
