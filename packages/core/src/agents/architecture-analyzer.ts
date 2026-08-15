import type { AgentContext, AgentResult } from './base.js';
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

/**
 * Layer heuristics, matched against individual path segments.
 *
 * Matching against the whole path is the obvious implementation and it is
 * wrong. On this repository it put 183 of 405 files in "Domain" — not because
 * they are domain logic, but because the monorepo has a package called `core`
 * and the domain pattern contains `core`, so every file under `packages/core/`
 * matched on its second path segment. A layer map where 45% of the codebase is
 * one bucket tells you nothing.
 *
 * Segments are scanned from the filename backwards, because specificity
 * increases as you approach the file: in `packages/core/src/api/routes.ts` the
 * meaningful signal is `api`/`routes`, and `core` is an accident of where the
 * package happens to live.
 *
 * Patterns are anchored to whole segments (or clear word boundaries within a
 * segment) so `ui` does not match `build`, and `api` does not match `rapid`.
 */
const LAYER_HEURISTICS: Array<{ id: string; name: string; patterns: RegExp[]; priority: number }> = [
  { id: 'test', name: 'Tests', patterns: [/^(tests?|specs?|__tests__|__mocks__|fixtures?|mocks?|e2e)$/i, /\.(test|spec)\./i, /^test[_-]/i, /[_-](test|spec)$/i], priority: 0 },
  { id: 'infrastructure', name: 'Infrastructure', patterns: [/^(infra|infrastructure|k8s|kubernetes|docker|terraform|deploy|deployment|\.github|ci|cd|charts|helm|ops)$/i, /^dockerfile/i, /\.(tf|tfvars)$/i], priority: 1 },
  { id: 'config', name: 'Configuration', patterns: [/^(config|configs|configuration|settings|env)$/i, /^\.env/i, /\.(config|rc)\./i, /^(package|tsconfig|eslint|vite|vitest|tsup|pnpm-workspace)\b/i], priority: 2 },
  { id: 'schema', name: 'Schema', patterns: [/^(schema|schemas|migration|migrations|prisma|models?|entities|entity|types?|proto)$/i], priority: 3 },
  { id: 'data', name: 'Data', patterns: [/^(data|store|stores|repository|repositories|db|database|storage|cache|persistence|dao|dal)$/i], priority: 4 },
  { id: 'api', name: 'API', patterns: [/^(controllers?|handlers?|routes?|router|routers|endpoints?|resolvers?|api|rest|graphql|rpc|server)$/i], priority: 5 },
  { id: 'ui', name: 'UI', patterns: [/^(components?|pages?|views?|screens?|widgets?|layouts?|ui|styles?|assets)$/i, /\.(tsx|jsx|vue|svelte|css|scss)$/i], priority: 6 },
  { id: 'domain', name: 'Domain', patterns: [/^(domain|business|usecases?|use-cases?|commands?|queries|services?|agents?|orchestrator|analyzers?|engine)$/i], priority: 7 },
  { id: 'util', name: 'Utilities', patterns: [/^(utils?|helpers?|lib|libs|common|shared|tools?|scripts?|bin)$/i], priority: 8 },
  { id: 'docs', name: 'Documentation', patterns: [/^(docs?|documentation|examples?|website|homepage)$/i, /\.(md|mdx|rst|txt)$/i, /^(readme|license|changelog|contributing|authors|notice)/i], priority: 9 },
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

      // Assign each file node to a layer
      const layerMap = new Map<string, string[]>();
      for (const layerHeuristic of LAYER_HEURISTICS) {
        layerMap.set(layerHeuristic.id, []);
      }
      layerMap.set('general', []);

      for (const node of fileNodes) {
        const assignedLayer = this.classifyNode(node);
        if (!layerMap.has(assignedLayer)) layerMap.set(assignedLayer, []);
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

      // Layers derived from the repository's own structure.
      //
      // The heuristics above encode conventions that hold across projects, and
      // they stop there on purpose. A directory called `behavioral` or
      // `artifacts` is meaningful in *this* codebase and meaningless as a
      // universal rule, so extending the pattern list to cover it would be
      // whack-a-mole that never converges and would misfire elsewhere.
      //
      // Naming such a group after its own directory is strictly more
      // informative than forcing it into "Domain", and it is honest: the layer
      // is called what the team called it. Groups of one or two files are
      // pooled into "Other" instead, because a layer diagram with forty
      // single-file layers is as useless as one with a single 183-file layer.
      const MIN_DERIVED_LAYER = 3;
      const other: string[] = [];
      for (const [id, nodeIds] of layerMap) {
        if (id !== 'general' || nodeIds.length === 0) continue;
        const byDirectory = new Map<string, string[]>();
        for (const nodeId of nodeIds) {
          const node = fileNodes.find((n) => n.id === nodeId);
          const path = (node?.location?.file ?? nodeId).replace(/\\/g, '/');
          const segments = path.split('/').filter(Boolean);
          // The directory holding the file, or "root" for a top-level file.
          const dir = segments.length > 1 ? (segments[segments.length - 2] ?? 'root') : 'root';
          const bucket = byDirectory.get(dir) ?? [];
          bucket.push(nodeId);
          byDirectory.set(dir, bucket);
        }
        for (const [dir, members] of Array.from(byDirectory).sort((a, b) => a[0].localeCompare(b[0]))) {
          if (members.length < MIN_DERIVED_LAYER || dir === 'root' || dir === 'src') {
            other.push(...members);
            continue;
          }
          layers.push({
            id: `derived:${dir}`,
            name: dir.charAt(0).toUpperCase() + dir.slice(1),
            description: `Derived from the ${dir}/ directory (${members.length} files)`,
            node_ids: members,
          });
        }
      }
      if (other.length > 0) {
        layers.push({
          id: 'other',
          name: 'Other',
          description: `Files matching no layer convention and no sizeable directory group (${other.length} files)`,
          node_ids: other,
        });
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

  private classifyNode(node: SprangNode): string {
    const filePath = node.location?.file ?? node.id;
    const normalized = filePath.replace(/\\/g, '/');
    const segments = normalized.split('/').filter(Boolean);
    if (segments.length === 0) return 'general';

    // Walk from the filename outwards. The first segment that matches any
    // heuristic wins, so a specific directory near the file beats a generic
    // one near the repository root — which is the whole point.
    //
    // Each segment is tested both as written and with its extension removed,
    // because the anchored patterns match whole words: without the stem,
    // `repository.ts` never matches `repository` and the file falls through to
    // whatever its parent directory happens to be called.
    for (let i = segments.length - 1; i >= 0; i--) {
      const segment = segments[i];
      if (segment === undefined) continue;
      const stem = segment.replace(/\.[^.]+$/, '');
      const candidates = stem !== segment ? [segment, stem] : [segment];
      for (const heuristic of LAYER_HEURISTICS) {
        if (heuristic.patterns.some((p) => candidates.some((c) => p.test(c)))) {
          return heuristic.id;
        }
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
