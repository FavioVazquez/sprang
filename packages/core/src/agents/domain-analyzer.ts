import type { AgentContext, AgentResult } from './base.js';
import { BaseAgent } from './base.js';
import type { KnowledgeGraph, Domain, DomainFlow, DomainStep, SprangNode } from '../schema/types.js';

interface ClusterGroup {
  id: string;
  nodeIds: string[];
  cohesionScore: number;
}

export class DomainAnalyzerAgent extends BaseAgent {
  readonly id = 'domain-analyzer';
  readonly phase = 2 as const;

  async run(ctx: AgentContext): Promise<AgentResult> {
    try {
      const { graph, llm } = ctx;
      const fileNodes = graph.nodes.filter(n => n.type === 'file');

      if (fileNodes.length < 3) {
        return this.success(ctx);
      }

      // Step 1: Cluster files by directory and import cohesion
      const clusters = this.clusterByDirectory(fileNodes);

      // Step 2: Name clusters with LLM (or heuristic if skipLLM)
      const domains: Domain[] = [];

      for (const cluster of clusters.slice(0, 8)) { // max 8 domains
        const label = ctx.options.skipLLM
          ? this.heuristicDomainName(cluster.nodeIds, graph)
          : await this.llmDomainName(cluster.nodeIds, graph, llm);

        const flows = this.buildFlows(cluster.nodeIds, graph);

        domains.push({
          id: this.toKebabCase(label),
          label,
          summary: `Domain encompassing ${cluster.nodeIds.length} files`,
          flows,
          entities: [],
        });
      }

      const mutatedGraph: KnowledgeGraph = { ...graph, domains };

      await this.writeIntermediate(ctx, 'domain-analysis.json', domains);

      return this.success(ctx, mutatedGraph);
    } catch (err) {
      return this.failure(ctx, err instanceof Error ? err.message : String(err));
    }
  }

  private clusterByDirectory(fileNodes: SprangNode[]): ClusterGroup[] {
    const dirMap = new Map<string, string[]>();

    for (const node of fileNodes) {
      const filePath = node.location?.file ?? '';
      const parts = filePath.split('/');
      // Use top-level directory as cluster key
      const topDir = parts.length > 1 ? (parts[1] ?? parts[0] ?? 'root') : (parts[0] ?? 'root');
      const existing = dirMap.get(topDir) ?? [];
      existing.push(node.id);
      dirMap.set(topDir, existing);
    }

    const clusters: ClusterGroup[] = [];
    for (const [dir, nodeIds] of dirMap) {
      if (nodeIds.length >= 2) {
        clusters.push({ id: dir, nodeIds, cohesionScore: nodeIds.length });
      }
    }

    return clusters.sort((a, b) => b.cohesionScore - a.cohesionScore);
  }

  private heuristicDomainName(nodeIds: string[], graph: KnowledgeGraph): string {
    const nodes = nodeIds.map(id => graph.nodes.find(n => n.id === id)).filter(Boolean) as SprangNode[];
    const firstNode = nodes[0];
    if (!firstNode) return 'general';

    const filePath = firstNode.location?.file ?? firstNode.id;
    const parts = filePath.split('/');
    return parts[1] ?? parts[0] ?? 'general';
  }

  private async llmDomainName(nodeIds: string[], graph: KnowledgeGraph, llm: ReturnType<AgentContext['llm']['constructor']['prototype']['constructor']> | AgentContext['llm']): Promise<string> {
    const nodes = nodeIds.slice(0, 5).map(id => {
      const n = graph.nodes.find(n => n.id === id);
      return n ? `${n.label}: ${n.summary ?? ''}` : id;
    });

    try {
      const response = await llm.complete([{
        role: 'user',
        content: `These files belong to the same cluster:\n${nodes.join('\n')}\n\nRespond with ONLY a 1-3 word domain name (e.g. "Authentication", "Payment Processing", "User Management"). No explanation.`,
      }]);
      const name = response.trim().replace(/['"]/g, '');
      // The default NullLLMClient returns '' (not a throw), and an agent bridge
      // can also return a blank line — fall back to the directory heuristic so a
      // domain is never left with an empty id/label.
      if (name === '') return this.heuristicDomainName(nodeIds, graph);
      return name;
    } catch {
      return this.heuristicDomainName(nodeIds, graph);
    }
  }

  private buildFlows(nodeIds: string[], graph: KnowledgeGraph): DomainFlow[] {
    // Build simple flows from call/import chains within the cluster
    const clusterSet = new Set(nodeIds);
    const intraEdges = graph.edges.filter(
      e => clusterSet.has(e.source) && clusterSet.has(e.target) &&
           ['calls', 'imports', 'depends_on'].includes(e.type)
    );

    if (intraEdges.length < 2) {
      // Single flow with all nodes
      return [{
        id: 'main-flow',
        label: 'Main Flow',
        steps: nodeIds.slice(0, 6).map((nodeId, i) => ({
          id: `step-${i}`,
          label: graph.nodes.find(n => n.id === nodeId)?.label ?? nodeId,
          node_ids: [nodeId],
          weight: i / Math.max(nodeIds.length - 1, 1),
        })),
      }];
    }

    // Build a topological ordering from intra-cluster edges
    const inDeg = new Map<string, number>();
    for (const id of nodeIds) inDeg.set(id, 0);
    for (const e of intraEdges) inDeg.set(e.target, (inDeg.get(e.target) ?? 0) + 1);

    const queue = nodeIds.filter(id => (inDeg.get(id) ?? 0) === 0);
    const ordered: string[] = [];
    const visited = new Set<string>();

    while (queue.length > 0 && ordered.length < 8) {
      const id = queue.shift()!;
      if (visited.has(id)) continue;
      visited.add(id);
      ordered.push(id);
      for (const e of intraEdges.filter(e => e.source === id)) {
        inDeg.set(e.target, (inDeg.get(e.target) ?? 1) - 1);
        if ((inDeg.get(e.target) ?? 0) <= 0) queue.push(e.target);
      }
    }

    const steps: DomainStep[] = ordered.map((nodeId, i) => ({
      id: `step-${i}`,
      label: graph.nodes.find(n => n.id === nodeId)?.label ?? nodeId,
      summary: graph.nodes.find(n => n.id === nodeId)?.summary,
      node_ids: [nodeId],
      weight: i / Math.max(ordered.length - 1, 1),
    }));

    return [{
      id: 'main-flow',
      label: 'Main Flow',
      steps,
    }];
  }

  private toKebabCase(str: string): string {
    return str.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  }
}
