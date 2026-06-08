import path from 'node:path';
import type { AgentContext, AgentResult, SprangOptions } from './base.js';
import { BaseAgent } from './base.js';
import type { KnowledgeGraph, SprangNode, Layer, StructuralWarning } from '../schema/types.js';

/**
 * Dependency hierarchy rank — higher number = higher level (closer to the UI).
 * A clean architecture flows downward: ui → api → domain → data → schema → config.
 * A `layer_violation` is a lower layer importing from a higher one (e.g. data → ui).
 * `util` and `test` are cross-cutting and exempt from the check.
 */
const LAYER_RANK: Record<string, number> = {
  infrastructure: 0,
  config: 1,
  schema: 2,
  data: 3,
  domain: 4,
  api: 5,
  ui: 6,
};

interface LayerCandidate {
  id: string;
  name: string;
  depth: number;
  nodeIds: string[];
  patterns: string[];
}

const LAYER_HEURISTICS: Array<{ id: string; name: string; patterns: RegExp[]; priority: number }> = [
  { id: 'infrastructure', name: 'Infrastructure', patterns: [/infra|k8s|docker|terraform|deploy|ci|cd|github|\.github/i], priority: 0 },
  { id: 'config', name: 'Configuration', patterns: [/config|settings|env|\.env/i], priority: 1 },
  { id: 'schema', name: 'Schema', patterns: [/schema|migration|prisma|model|entity|type/i], priority: 2 },
  { id: 'data', name: 'Data', patterns: [/store|repository|repo|db|database|storage|cache|persist/i], priority: 3 },
  { id: 'domain', name: 'Domain', patterns: [/service|domain|core|business|use.?case|command|query/i], priority: 4 },
  { id: 'api', name: 'API', patterns: [/controller|handler|route|router|endpoint|resolver|api/i], priority: 5 },
  { id: 'ui', name: 'UI', patterns: [/component|page|view|screen|widget|layout|ui/i], priority: 6 },
  { id: 'util', name: 'Utilities', patterns: [/util|helper|lib|common|shared|tool/i], priority: 7 },
  { id: 'test', name: 'Tests', patterns: [/test|spec|__tests__|fixture|mock/i], priority: 8 },
];

export class ArchitectureAnalyzerAgent extends BaseAgent {
  readonly id = 'architecture-analyzer';
  readonly phase = 2 as const;

  async run(ctx: AgentContext): Promise<AgentResult> {
    try {
      const { graph } = ctx;
      const fileNodes = graph.nodes.filter(n => n.type === 'file');

      if (fileNodes.length === 0) {
        return this.success(ctx);
      }

      // Build adjacency for depth calculation
      const outEdges = this.buildOutEdges(graph);
      const depths = this.computeLayerDepths(fileNodes, outEdges);

      // Assign each file node to a layer
      const layerMap = new Map<string, string[]>();
      for (const layerHeuristic of LAYER_HEURISTICS) {
        layerMap.set(layerHeuristic.id, []);
      }
      layerMap.set('general', []);

      for (const node of fileNodes) {
        const assignedLayer = this.classifyNode(node);
        const layerNodes = layerMap.get(assignedLayer) ?? layerMap.get('general')!;
        layerNodes.push(node.id);
      }

      // Build Layer objects, skip empty ones
      const layers: Layer[] = [];
      for (const heuristic of LAYER_HEURISTICS) {
        const nodeIds = layerMap.get(heuristic.id) ?? [];
        if (nodeIds.length > 0) {
          layers.push({
            id: heuristic.id,
            name: heuristic.name,
            description: `${heuristic.name} layer (${nodeIds.length} files)`,
            node_ids: nodeIds,
          });
        }
      }

      // Assign layer field to nodes
      const mutatedGraph: KnowledgeGraph = { ...graph, layers };
      for (const node of mutatedGraph.nodes) {
        for (const layer of layers) {
          if (layer.node_ids.includes(node.id)) {
            node.layer = layer.id;
            break;
          }
        }
      }

      // Detect layer violations: a lower layer importing from a higher layer
      const violationCount = this.detectLayerViolations(mutatedGraph);

      await this.writeIntermediate(ctx, 'architecture.json', {
        layers,
        nodeLayerMap: Object.fromEntries(
          mutatedGraph.nodes.filter(n => n.layer).map(n => [n.id, n.layer])
        ),
        layerViolations: violationCount,
      });

      return this.success(ctx, mutatedGraph);
    } catch (err) {
      return this.failure(ctx, err instanceof Error ? err.message : String(err));
    }
  }

  private buildOutEdges(graph: KnowledgeGraph): Map<string, string[]> {
    const outEdges = new Map<string, string[]>();
    for (const node of graph.nodes) {
      outEdges.set(node.id, []);
    }
    for (const edge of graph.edges) {
      const targets = outEdges.get(edge.source) ?? [];
      targets.push(edge.target);
      outEdges.set(edge.source, targets);
    }
    return outEdges;
  }

  private computeLayerDepths(nodes: SprangNode[], outEdges: Map<string, string[]>): Map<string, number> {
    const depths = new Map<string, number>();
    // Simple: BFS from all nodes, assign depth by longest path from any leaf
    for (const node of nodes) {
      if (!depths.has(node.id)) {
        depths.set(node.id, 0);
      }
    }
    return depths;
  }

  private classifyNode(node: SprangNode): string {
    const filePath = node.location?.file ?? node.id;
    const normalized = filePath.toLowerCase().replace(/\\/g, '/');

    for (const heuristic of LAYER_HEURISTICS) {
      if (heuristic.patterns.some(p => p.test(normalized))) {
        return heuristic.id;
      }
    }
    return 'general';
  }

  /**
   * Flag `imports` edges where a lower-ranked layer depends on a higher-ranked
   * layer (e.g. a data-layer file importing a ui-layer file). Each violation is
   * attached as a `layer_violation` structural warning on the source node so it
   * surfaces in `smell_summary`, the health grade, and the dashboard.
   * Returns the number of violations found.
   */
  private detectLayerViolations(graph: KnowledgeGraph): number {
    const layerById = new Map(graph.nodes.map((n) => [n.id, n.layer]));
    let count = 0;
    for (const edge of graph.edges) {
      if (edge.type !== 'imports') continue;
      const srcLayer = layerById.get(edge.source);
      const tgtLayer = layerById.get(edge.target);
      if (!srcLayer || !tgtLayer || srcLayer === tgtLayer) continue;
      const srcRank = LAYER_RANK[srcLayer];
      const tgtRank = LAYER_RANK[tgtLayer];
      // Both must be ranked (util/test/general are exempt cross-cutting layers)
      if (srcRank === undefined || tgtRank === undefined) continue;
      if (srcRank < tgtRank) {
        const srcNode = graph.nodes.find((n) => n.id === edge.source);
        if (!srcNode) continue;
        const warning: StructuralWarning = {
          category: 'layer_violation',
          severity: tgtRank - srcRank >= 3 ? 'high' : 'medium',
          description: `${srcLayer} layer imports from ${tgtLayer} layer — dependencies should flow downward (${tgtLayer} → ${srcLayer}), not upward`,
          related_node_ids: [edge.target],
          heuristic: `layer_rank(${srcLayer}=${srcRank}) < layer_rank(${tgtLayer}=${tgtRank})`,
        };
        if (!srcNode.structural_warnings) srcNode.structural_warnings = [];
        const dup = srcNode.structural_warnings.some(
          (w) => w.category === 'layer_violation' && w.related_node_ids[0] === edge.target,
        );
        if (!dup) {
          srcNode.structural_warnings.push(warning);
          count++;
        }
      }
    }
    return count;
  }
}
