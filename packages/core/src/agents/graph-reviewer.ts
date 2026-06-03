import type { AgentContext, AgentResult } from './base.js';
import { BaseAgent } from './base.js';
import type { KnowledgeGraph } from '../schema/types.js';
import { knowledgeGraphSchema } from '../schema/validators.js';

interface ReviewIssue {
  severity: 'critical' | 'warning';
  message: string;
  nodeId?: string;
}

export class GraphReviewerAgent extends BaseAgent {
  readonly id = 'graph-reviewer';
  readonly phase = 2 as const;

  async run(ctx: AgentContext): Promise<AgentResult> {
    try {
      const { graph } = ctx;
      const issues: ReviewIssue[] = [];

      // 1. Schema validation
      const parseResult = knowledgeGraphSchema.safeParse(graph);
      if (!parseResult.success) {
        for (const err of parseResult.error.errors) {
          issues.push({ severity: 'critical', message: `Schema: ${err.path.join('.')} — ${err.message}` });
        }
      }

      // 2. Referential integrity
      const nodeIds = new Set(graph.nodes.map(n => n.id));
      for (const edge of graph.edges) {
        if (!nodeIds.has(edge.source)) {
          issues.push({ severity: 'critical', message: `Edge source not found: ${edge.source}` });
        }
        if (!nodeIds.has(edge.target)) {
          issues.push({ severity: 'critical', message: `Edge target not found: ${edge.target}` });
        }
      }

      // 3. Self-referential edges
      for (const edge of graph.edges) {
        if (edge.source === edge.target) {
          issues.push({ severity: 'warning', message: `Self-referential edge on node ${edge.source}` });
        }
      }

      // 4. Duplicate node IDs
      const seen = new Set<string>();
      for (const node of graph.nodes) {
        if (seen.has(node.id)) {
          issues.push({ severity: 'critical', message: `Duplicate node ID: ${node.id}` });
        }
        seen.add(node.id);
      }

      // 5. Nodes missing summaries (warning only)
      const missingSum = graph.nodes.filter(n => !n.summary && n.type === 'file').length;
      if (missingSum > 0) {
        issues.push({ severity: 'warning', message: `${missingSum} file nodes are missing summaries` });
      }

      // 6. Tours reference valid nodes
      for (const tour of graph.tours) {
        for (const step of tour.steps) {
          if (!nodeIds.has(step.node_id)) {
            issues.push({ severity: 'critical', message: `Tour "${tour.id}" step references missing node: ${step.node_id}` });
          }
        }
      }

      // 7. Layer node_ids reference valid nodes
      for (const layer of graph.layers) {
        for (const nodeId of layer.node_ids) {
          if (!nodeIds.has(nodeId)) {
            issues.push({ severity: 'warning', message: `Layer "${layer.id}" references missing node: ${nodeId}` });
          }
        }
      }

      const criticalIssues = issues.filter(i => i.severity === 'critical');
      const approved = criticalIssues.length === 0;

      const reviewReport = {
        approved,
        critical_issues: criticalIssues.map(i => i.message),
        warnings: issues.filter(i => i.severity === 'warning').map(i => i.message),
        stats: {
          node_count: graph.nodes.length,
          edge_count: graph.edges.length,
          layer_count: graph.layers.length,
          tour_count: graph.tours.length,
          issue_count: issues.length,
        },
      };

      await this.writeIntermediate(ctx, 'review-report.json', reviewReport);

      if (!approved) {
        // Fix critical referential integrity issues (remove dangling edges)
        const fixedGraph: KnowledgeGraph = {
          ...graph,
          edges: graph.edges.filter(e =>
            nodeIds.has(e.source) && nodeIds.has(e.target) && e.source !== e.target
          ),
          layers: graph.layers.map(l => ({
            ...l,
            node_ids: l.node_ids.filter(id => nodeIds.has(id)),
          })),
          tours: graph.tours.map(t => ({
            ...t,
            steps: t.steps.filter(s => nodeIds.has(s.node_id)),
          })).filter(t => t.steps.length >= 2),
        };
        return this.success(ctx, fixedGraph);
      }

      return this.success(ctx);
    } catch (err) {
      return this.failure(ctx, err instanceof Error ? err.message : String(err));
    }
  }
}
