import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentContext, AgentResult } from './base.js';
import { BaseAgent } from './base.js';
import type { KnowledgeGraph, Tour, TourStep, SprangNode } from '../schema/types.js';
import { ENTRY_POINT_PATTERNS } from '../schema/constants.js';
import { detectLanguageLessons } from './language-lessons.js';

export class TourBuilderAgent extends BaseAgent {
  readonly id = 'tour-builder';
  readonly phase = 2 as const;

  async run(ctx: AgentContext): Promise<AgentResult> {
    try {
      const { graph } = ctx;
      const fileNodes = graph.nodes.filter(n => n.type === 'file');

      if (fileNodes.length === 0) {
        return this.success(ctx);
      }

      // Build adjacency for BFS
      const outEdges = this.buildOutEdgeMap(graph);
      const inDegree = this.computeInDegrees(graph);

      // Find entry points
      const entryPoints = this.findEntryPoints(fileNodes, inDegree);

      // Generate tours (max 2: a default and an optional domain-focused one)
      const tours: Tour[] = [];

      // Tour 1: dependency-ordered full tour
      const defaultTour = await this.buildDefaultTour(graph, fileNodes, entryPoints, outEdges, ctx);
      if (defaultTour) tours.push(defaultTour);

      // Tour 2: risk-focused tour (highest risk nodes)
      const riskTour = this.buildRiskTour(graph, fileNodes);
      if (riskTour) tours.push(riskTour);

      const mutatedGraph: KnowledgeGraph = { ...graph, tours };

      await this.writeIntermediate(ctx, 'tours.json', tours);

      return this.success(ctx, mutatedGraph);
    } catch (err) {
      return this.failure(ctx, err instanceof Error ? err.message : String(err));
    }
  }

  private buildOutEdgeMap(graph: KnowledgeGraph): Map<string, string[]> {
    const map = new Map<string, string[]>();
    for (const edge of graph.edges) {
      if (!['imports', 'depends_on', 'calls'].includes(edge.type)) continue;
      const targets = map.get(edge.source) ?? [];
      targets.push(edge.target);
      map.set(edge.source, targets);
    }
    return map;
  }

  private computeInDegrees(graph: KnowledgeGraph): Map<string, number> {
    const degrees = new Map<string, number>();
    for (const node of graph.nodes) degrees.set(node.id, 0);
    for (const edge of graph.edges) {
      if (!['imports', 'depends_on', 'calls'].includes(edge.type)) continue;
      degrees.set(edge.target, (degrees.get(edge.target) ?? 0) + 1);
    }
    return degrees;
  }

  private findEntryPoints(fileNodes: SprangNode[], inDegree: Map<string, number>): SprangNode[] {
    const entryPointPatterns = [
      /index\.(ts|js|tsx|jsx)$/,
      /main\.(ts|js)$/,
      /app\.(ts|js|tsx)$/,
      /server\.(ts|js)$/,
      /cli\.(ts|js)$/,
    ];

    return fileNodes.filter(node => {
      const filePath = node.location?.file ?? node.id;
      const isEntryPattern = entryPointPatterns.some(p => p.test(filePath));
      const hasLowInDegree = (inDegree.get(node.id) ?? 0) === 0;
      return isEntryPattern || hasLowInDegree;
    }).slice(0, 3);
  }

  private async buildDefaultTour(
    graph: KnowledgeGraph,
    fileNodes: SprangNode[],
    entryPoints: SprangNode[],
    outEdges: Map<string, string[]>,
    ctx: AgentContext,
  ): Promise<Tour | null> {
    const startNode = entryPoints[0] ?? fileNodes[0];
    if (!startNode) return null;

    // BFS traversal to get dependency-ordered nodes
    const visited = new Set<string>();
    const queue: string[] = [startNode.id];
    const orderedNodeIds: string[] = [];

    while (queue.length > 0 && orderedNodeIds.length < 12) {
      const nodeId = queue.shift()!;
      if (visited.has(nodeId)) continue;
      visited.add(nodeId);

      const node = graph.nodes.find(n => n.id === nodeId);
      if (!node || node.type !== 'file') continue;

      orderedNodeIds.push(nodeId);

      const targets = outEdges.get(nodeId) ?? [];
      for (const t of targets) queue.push(t);
    }

    // Add any high-risk nodes not yet in tour
    const highRisk = fileNodes
      .filter(n => !visited.has(n.id) && (n.risk_score ?? 0) > 0.6)
      .slice(0, 3);
    for (const n of highRisk) orderedNodeIds.push(n.id);

    const steps: TourStep[] = orderedNodeIds.slice(0, 10).map((nodeId, i) => {
      const node = graph.nodes.find(n => n.id === nodeId)!;
      return {
        node_id: nodeId,
        step_title: `Step ${i + 1}: ${node.label}`,
        explanation: node.summary ?? `${node.label} is a ${node.type} in the ${node.layer ?? 'general'} layer.`,
        highlight: i === 0,
      };
    });

    if (steps.length < 2) return null;

    // Attach language lessons to steps (and back-annotate nodes)
    await this.attachLanguageLessons(steps, graph, ctx);

    return {
      id: 'default-tour',
      title: 'Architecture Overview',
      description: `A dependency-ordered tour of ${graph.project_name} starting from entry points.`,
      entry_point: startNode.id,
      steps,
    };
  }

  private async attachLanguageLessons(
    steps: TourStep[],
    graph: KnowledgeGraph,
    ctx: AgentContext,
  ): Promise<void> {
    const nodeMap = new Map<string, SprangNode>(graph.nodes.map(n => [n.id, n]));

    for (const step of steps) {
      const node = nodeMap.get(step.node_id ?? '');
      if (!node) continue;

      const filePath = node.location?.file ?? node.filePath;
      if (!filePath) continue;

      let content: string;
      try {
        content = await readFile(join(ctx.projectRoot, filePath), 'utf-8');
      } catch {
        continue;
      }

      // Infer language from extension
      const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
      const extToLang: Record<string, string> = {
        ts: 'typescript', tsx: 'typescript',
        js: 'javascript', jsx: 'javascript',
        py: 'python',
        go: 'go',
        rs: 'rust',
        java: 'java',
        kt: 'kotlin',
        cs: 'csharp',
        rb: 'ruby',
        php: 'php',
      };
      const language = extToLang[ext] ?? ext;

      const lessons = detectLanguageLessons(content, language, filePath);
      const lesson = lessons[0];
      if (!lesson) continue;

      step.languageLesson = {
        pattern: lesson.pattern,
        title: lesson.title,
        explanation: lesson.explanation,
        lines: lesson.lines,
      };

      // Back-annotate node in the graph
      if (!node.languageLesson) {
        node.languageLesson = {
          pattern: lesson.pattern,
          title: lesson.title,
          explanation: lesson.explanation,
          lines: lesson.lines,
        };
      }
    }
  }

  private buildRiskTour(graph: KnowledgeGraph, fileNodes: SprangNode[]): Tour | null {
    const riskyNodes = fileNodes
      .filter(n => n.risk_score !== undefined && n.risk_score > 0.5)
      .sort((a, b) => (b.risk_score ?? 0) - (a.risk_score ?? 0))
      .slice(0, 8);

    if (riskyNodes.length < 2) return null;

    const steps: TourStep[] = riskyNodes.map((node, i) => ({
      node_id: node.id,
      step_title: `Risk ${i + 1}: ${node.label} (score: ${(node.risk_score ?? 0).toFixed(2)})`,
      explanation: [
        node.summary ?? `${node.label} requires attention.`,
        node.risk_factors?.length ? `Risk factors: ${node.risk_factors.join(', ')}.` : '',
        node.structural_warnings?.length ? `Warnings: ${node.structural_warnings.map(w => w.category).join(', ')}.` : '',
      ].filter(Boolean).join(' '),
      highlight: true,
    }));

    return {
      id: 'risk-tour',
      title: 'High-Risk Areas',
      description: 'Tour of the highest-risk nodes, ordered by risk score.',
      steps,
    };
  }
}
