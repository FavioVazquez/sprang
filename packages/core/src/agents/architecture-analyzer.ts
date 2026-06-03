import path from 'node:path';
import type { AgentContext, AgentResult, SprangOptions } from './base.js';
import { BaseAgent } from './base.js';
import type { KnowledgeGraph, SprangNode, Layer } from '../schema/types.js';

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

      await this.writeIntermediate(ctx, 'architecture.json', {
        layers,
        nodeLayerMap: Object.fromEntries(
          mutatedGraph.nodes.filter(n => n.layer).map(n => [n.id, n.layer])
        ),
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
}
