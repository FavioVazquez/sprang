import path from 'node:path';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import type { KnowledgeGraph } from '../schema/types.js';
import type { AgentContext, SprangOptions } from '../agents/base.js';
import { LLMClient } from '../llm/client.js';
import { loadGraph, saveGraph } from '../graph/store.js';
import { createEmptyGraph } from '../graph/store.js';
import { GRAPH_VERSION } from '../schema/constants.js';
import { ArchitectureAnalyzerAgent } from '../agents/architecture-analyzer.js';
import { DomainAnalyzerAgent } from '../agents/domain-analyzer.js';
import { TourBuilderAgent } from '../agents/tour-builder.js';
import { GraphReviewerAgent } from '../agents/graph-reviewer.js';

// Dynamic imports to avoid loading heavy deps until needed
async function loadGitLayer() {
  const { GitLayerAgent } = await import('../agents/git-layer.js');
  return new GitLayerAgent();
}
async function loadSmellDetector() {
  const { SmellDetectorAgent } = await import('../agents/smell-detector.js');
  return new SmellDetectorAgent();
}
async function loadRiskScorer() {
  const { RiskScorerAgent } = await import('../agents/risk-scorer.js');
  return new RiskScorerAgent();
}

export interface Phase2Progress {
  phase: 'phase2';
  startedAt: string;
  completedAt?: string;
  agents: Record<string, { status: 'pending' | 'running' | 'done' | 'failed'; error?: string }>;
  tokensUsed: number;
}

async function writeProgress(intermediateDir: string, progress: Phase2Progress): Promise<void> {
  const file = path.join(intermediateDir, 'phase2-progress.json');
  await writeFile(file, JSON.stringify(progress, null, 2), 'utf-8');
}

export async function runPhase2(
  projectRoot: string,
  sprangDir: string,
  options: SprangOptions,
  onProgress?: (msg: string) => void,
): Promise<KnowledgeGraph> {
  const intermediateDir = path.join(sprangDir, 'intermediate');
  const cacheDir = path.join(sprangDir, 'cache');
  await mkdir(intermediateDir, { recursive: true });
  await mkdir(cacheDir, { recursive: true });

  const llm = new LLMClient(process.env['ANTHROPIC_API_KEY']);

  // Load skeleton graph from Phase 1
  let graph = await loadGraph(sprangDir);

  const progress: Phase2Progress = {
    phase: 'phase2',
    startedAt: new Date().toISOString(),
    agents: {
      'architecture-analyzer': { status: 'pending' },
      'domain-analyzer': { status: 'pending' },
      'git-layer': { status: 'pending' },
      'smell-detector': { status: 'pending' },
      'tour-builder': { status: 'pending' },
      'risk-scorer': { status: 'pending' },
      'graph-reviewer': { status: 'pending' },
    },
    tokensUsed: 0,
  };
  await writeProgress(intermediateDir, progress);

  const buildCtx = (g: KnowledgeGraph): AgentContext => ({
    projectRoot,
    sprangDir,
    intermediateDir,
    cacheDir,
    graph: g,
    llm,
    options,
  });

  // ── Group 1: parallel (no inter-dependencies) ────────────────────
  const group1 = async () => {
    const ctx = buildCtx(graph);
    const [archResult, domainResult, gitResult, smellResult] = await Promise.allSettled([
      (async () => {
        progress.agents['architecture-analyzer'] = { status: 'running' };
        await writeProgress(intermediateDir, progress);
        onProgress?.('architecture-analyzer running...');
        const r = await new ArchitectureAnalyzerAgent().run(ctx);
        progress.agents['architecture-analyzer'] = { status: r.success ? 'done' : 'failed', error: r.error };
        return r;
      })(),
      (async () => {
        progress.agents['domain-analyzer'] = { status: 'running' };
        await writeProgress(intermediateDir, progress);
        onProgress?.('domain-analyzer running...');
        const r = await new DomainAnalyzerAgent().run(ctx);
        progress.agents['domain-analyzer'] = { status: r.success ? 'done' : 'failed', error: r.error };
        return r;
      })(),
      (async () => {
        progress.agents['git-layer'] = { status: 'running' };
        await writeProgress(intermediateDir, progress);
        onProgress?.('git-layer running...');
        const agent = await loadGitLayer();
        const r = await agent.run(ctx);
        progress.agents['git-layer'] = { status: r.success ? 'done' : 'failed', error: r.error };
        return r;
      })(),
      (async () => {
        progress.agents['smell-detector'] = { status: 'running' };
        await writeProgress(intermediateDir, progress);
        onProgress?.('smell-detector running...');
        const agent = await loadSmellDetector();
        const r = await agent.run(ctx);
        progress.agents['smell-detector'] = { status: r.success ? 'done' : 'failed', error: r.error };
        return r;
      })(),
    ]);

    // Merge all group-1 results into graph
    for (const result of [archResult, domainResult, gitResult, smellResult]) {
      if (result.status === 'fulfilled' && result.value.success) {
        graph = mergeGraphs(graph, result.value.mutatedGraph);
        progress.tokensUsed += result.value.tokensUsed ?? 0;
      }
    }
    await writeProgress(intermediateDir, progress);
  };

  // ── Group 2: depends on group 1 ──────────────────────────────────
  const group2 = async () => {
    const ctx = buildCtx(graph);
    const [tourResult, riskResult] = await Promise.allSettled([
      (async () => {
        progress.agents['tour-builder'] = { status: 'running' };
        await writeProgress(intermediateDir, progress);
        onProgress?.('tour-builder running...');
        const r = await new TourBuilderAgent().run(ctx);
        progress.agents['tour-builder'] = { status: r.success ? 'done' : 'failed', error: r.error };
        return r;
      })(),
      (async () => {
        progress.agents['risk-scorer'] = { status: 'running' };
        await writeProgress(intermediateDir, progress);
        onProgress?.('risk-scorer running...');
        const agent = await loadRiskScorer();
        const r = await agent.run(ctx);
        progress.agents['risk-scorer'] = { status: r.success ? 'done' : 'failed', error: r.error };
        return r;
      })(),
    ]);

    for (const result of [tourResult, riskResult]) {
      if (result.status === 'fulfilled' && result.value.success) {
        graph = mergeGraphs(graph, result.value.mutatedGraph);
        progress.tokensUsed += result.value.tokensUsed ?? 0;
      }
    }
    await writeProgress(intermediateDir, progress);
  };

  // ── Group 3: final QA ─────────────────────────────────────────────
  const group3 = async () => {
    progress.agents['graph-reviewer'] = { status: 'running' };
    await writeProgress(intermediateDir, progress);
    onProgress?.('graph-reviewer running...');
    const result = await new GraphReviewerAgent().run(buildCtx(graph));
    progress.agents['graph-reviewer'] = { status: result.success ? 'done' : 'failed', error: result.error };
    if (result.success) {
      graph = mergeGraphs(graph, result.mutatedGraph);
    }
    await writeProgress(intermediateDir, progress);
  };

  await group1();
  await group2();
  await group3();

  // Mark complete
  const now = new Date().toISOString();
  graph = {
    ...graph,
    phase: 'complete',
    stats: {
      ...graph.stats,
      node_count: graph.nodes.length,
      edge_count: graph.edges.length,
      phase2_completed_at: now,
      llm_token_usage: progress.tokensUsed,
      risk_summary: computeRiskSummary(graph),
      smell_summary: computeSmellSummary(graph),
    },
  };

  await saveGraph(sprangDir, graph);
  onProgress?.('Phase 2 complete');

  progress.completedAt = now;
  await writeProgress(intermediateDir, progress);

  return graph;
}

function mergeGraphs(base: KnowledgeGraph, updated: KnowledgeGraph): KnowledgeGraph {
  if (!updated) return base;
  // Merge nodes: updated nodes take precedence over base by id
  const nodeMap = new Map(base.nodes.map(n => [n.id, n]));
  for (const n of updated.nodes) nodeMap.set(n.id, n);

  // Merge edges: deduplicate by source+target+type
  const edgeKey = (e: { source: string; target: string; type: string }) => `${e.source}|${e.target}|${e.type}`;
  const edgeMap = new Map(base.edges.map(e => [edgeKey(e), e]));
  for (const e of updated.edges) edgeMap.set(edgeKey(e), e);

  return {
    ...base,
    ...updated,
    nodes: Array.from(nodeMap.values()),
    edges: Array.from(edgeMap.values()),
    layers: updated.layers.length > 0 ? updated.layers : base.layers,
    tours: updated.tours.length > 0 ? updated.tours : base.tours,
    domains: updated.domains.length > 0 ? updated.domains : base.domains,
  };
}

function computeRiskSummary(graph: KnowledgeGraph) {
  let high = 0, medium = 0, low = 0;
  for (const n of graph.nodes) {
    if (n.risk_score === undefined) continue;
    if (n.risk_score >= 0.7) high++;
    else if (n.risk_score >= 0.4) medium++;
    else low++;
  }
  return { high, medium, low };
}

function computeSmellSummary(graph: KnowledgeGraph): Record<string, number> {
  const summary: Record<string, number> = {};
  for (const n of graph.nodes) {
    for (const w of n.structural_warnings ?? []) {
      summary[w.category] = (summary[w.category] ?? 0) + 1;
    }
  }
  return summary;
}
