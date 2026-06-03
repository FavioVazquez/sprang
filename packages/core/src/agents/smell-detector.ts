import { join } from 'node:path';
import type { AgentContext, AgentResult } from './base.js';
import { BaseAgent } from './base.js';
import type {
  KnowledgeGraph,
  SmellCategory,
  SprangEdge,
  SprangNode,
  StructuralWarning,
} from '../schema/types.js';
import {
  DEFAULT_SMELL_THRESHOLDS,
} from '../schema/constants.js';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SmellSummary {
  total_warnings: number;
  by_category: Partial<Record<SmellCategory, number>>;
  by_severity: { high: number; medium: number; low: number };
  affected_nodes: string[];
}

// ─── Adjacency helpers ────────────────────────────────────────────────────────

function buildAdjacencyMaps(edges: SprangEdge[]): {
  outEdges: Map<string, SprangEdge[]>;
  inEdges: Map<string, SprangEdge[]>;
} {
  const outEdges = new Map<string, SprangEdge[]>();
  const inEdges = new Map<string, SprangEdge[]>();

  for (const edge of edges) {
    if (!outEdges.has(edge.source)) outEdges.set(edge.source, []);
    if (!inEdges.has(edge.target)) inEdges.set(edge.target, []);
    outEdges.get(edge.source)!.push(edge);
    inEdges.get(edge.target)!.push(edge);
  }

  return { outEdges, inEdges };
}

function makeWarning(
  category: SmellCategory,
  severity: StructuralWarning['severity'],
  description: string,
  heuristic: string,
  related_node_ids: string[] = []
): StructuralWarning {
  return { category, severity, description, heuristic, related_node_ids };
}

function addWarning(node: SprangNode, warning: StructuralWarning): void {
  if (!node.structural_warnings) node.structural_warnings = [];
  // Avoid exact duplicate category on same node
  const alreadyExists = node.structural_warnings.some(
    (w) => w.category === warning.category && w.heuristic === warning.heuristic
  );
  if (!alreadyExists) {
    node.structural_warnings.push(warning);
  }
}

// ─── Detector 1: god_node ─────────────────────────────────────────────────────

function detectGodNodes(
  graph: KnowledgeGraph,
  nodeMap: Map<string, SprangNode>,
  outEdges: Map<string, SprangEdge[]>,
  inEdges: Map<string, SprangEdge[]>
): void {
  const { godNodeOutDegree, godNodeFunctionCount } = DEFAULT_SMELL_THRESHOLDS;

  for (const node of graph.nodes) {
    if (node.type !== 'file' && node.type !== 'class' && node.type !== 'module') continue;

    const outgoing = outEdges.get(node.id) ?? [];
    const outDegree = outgoing.length;

    const childFunctions = outgoing.filter((e) => {
      if (e.type !== 'contains') return false;
      const target = nodeMap.get(e.target);
      return target?.type === 'function';
    }).length;

    if (outDegree > godNodeOutDegree) {
      addWarning(
        node,
        makeWarning(
          'god_node',
          'high',
          `Node has ${outDegree} outgoing edges, exceeding the threshold of ${godNodeOutDegree}.`,
          `out_degree > ${godNodeOutDegree}`,
          []
        )
      );
    }

    if (childFunctions > godNodeFunctionCount) {
      addWarning(
        node,
        makeWarning(
          'god_node',
          'high',
          `Node contains ${childFunctions} function children, exceeding the threshold of ${godNodeFunctionCount}.`,
          `function_count > ${godNodeFunctionCount}`,
          []
        )
      );
    }
  }
}

// ─── Detector 2: circular_dependency (Johnson's algorithm, iterative DFS) ─────

function detectCircularDependencies(
  graph: KnowledgeGraph,
  nodeMap: Map<string, SprangNode>,
  outEdges: Map<string, SprangEdge[]>
): void {
  const { circularMaxCycleLength } = DEFAULT_SMELL_THRESHOLDS;

  // Build dependency adjacency list from import/depends_on edges
  const depAdj = new Map<string, Set<string>>();
  for (const node of graph.nodes) {
    depAdj.set(node.id, new Set());
  }
  for (const edge of graph.edges) {
    if (edge.type === 'imports' || edge.type === 'depends_on') {
      const targets = depAdj.get(edge.source);
      if (targets) targets.add(edge.target);
    }
  }

  const nodeIds = graph.nodes.map((n) => n.id);
  const cycles: string[][] = [];

  // Johnson's algorithm: iterative implementation using explicit stack
  // For each start node, do DFS looking for cycles back to start
  const visited = new Set<string>();

  function findCyclesFrom(startId: string): void {
    // Stack holds: [nodeId, iterator over neighbors, path so far]
    const path: string[] = [startId];
    const pathSet = new Set<string>([startId]);
    const stack: Array<[string, string[]]> = [[startId, Array.from(depAdj.get(startId) ?? [])]];

    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!;
      const [, neighbors] = frame;

      if (neighbors.length === 0) {
        stack.pop();
        path.pop();
        if (path.length > 0) {
          const last = path[path.length - 1]!;
          pathSet.delete(last);
        }
        continue;
      }

      const nextId = neighbors.shift()!;

      if (nextId === startId && path.length >= 2) {
        // Found a cycle: path + back to startId
        cycles.push([...path, startId]);
        continue;
      }

      if (pathSet.has(nextId) || visited.has(nextId)) {
        continue;
      }

      if (path.length >= circularMaxCycleLength) {
        // Don't go deeper, would exceed max cycle length
        continue;
      }

      pathSet.add(nextId);
      path.push(nextId);
      stack.push([nextId, Array.from(depAdj.get(nextId) ?? [])]);
    }
  }

  for (const nodeId of nodeIds) {
    findCyclesFrom(nodeId);
    visited.add(nodeId);
  }

  // Deduplicate cycles (normalize by rotating to smallest element)
  function normalizeCycle(cycle: string[]): string {
    // cycle[0] === cycle[last] for closed cycles
    const loop = cycle.slice(0, -1);
    let minIdx = 0;
    for (let i = 1; i < loop.length; i++) {
      if ((loop[i] ?? '') < (loop[minIdx] ?? '')) minIdx = i;
    }
    const rotated = [...loop.slice(minIdx), ...loop.slice(0, minIdx)];
    return rotated.join('|');
  }

  const seen = new Set<string>();
  const uniqueCycles: string[][] = [];
  for (const cycle of cycles) {
    const key = normalizeCycle(cycle);
    if (!seen.has(key)) {
      seen.add(key);
      uniqueCycles.push(cycle);
    }
  }

  // Add warnings to all participating nodes
  for (const cycle of uniqueCycles) {
    const participants = cycle.slice(0, -1); // remove the closing duplicate
    const length = participants.length;
    if (length < 2 || length > circularMaxCycleLength) continue;

    const severity: StructuralWarning['severity'] = length <= 3 ? 'high' : 'medium';

    for (const nodeId of participants) {
      const node = nodeMap.get(nodeId);
      if (!node) continue;
      const others = participants.filter((id) => id !== nodeId);
      addWarning(
        node,
        makeWarning(
          'circular_dependency',
          severity,
          `Participates in a circular dependency cycle of length ${length}: ${participants.join(' → ')}.`,
          `cycle_length = ${length}`,
          others
        )
      );
    }
  }
}

// ─── Detector 3: orphan_node ──────────────────────────────────────────────────

const ENTRY_POINT_NAMES = new Set(['index', 'main', 'app', 'server', 'cli']);

function isEntryPointFile(label: string): boolean {
  // label might be "src/index.ts" or "index.ts"
  const base = label.split('/').pop() ?? label;
  const stem = base.replace(/\.[^.]+$/, '').toLowerCase();
  return ENTRY_POINT_NAMES.has(stem);
}

function detectOrphanNodes(
  graph: KnowledgeGraph,
  outEdges: Map<string, SprangEdge[]>,
  inEdges: Map<string, SprangEdge[]>
): void {
  for (const node of graph.nodes) {
    if (node.type !== 'file') continue;

    const outDegree = (outEdges.get(node.id) ?? []).length;
    const inDegree = (inEdges.get(node.id) ?? []).length;

    if (outDegree === 0 && inDegree === 0 && !isEntryPointFile(node.label)) {
      addWarning(
        node,
        makeWarning(
          'orphan_node',
          'low',
          `File "${node.label}" has no incoming or outgoing edges — it may be dead code.`,
          'in_degree = 0 AND out_degree = 0',
          []
        )
      );
    }
  }
}

// ─── Detector 4: over_connected ───────────────────────────────────────────────

function detectOverConnected(
  graph: KnowledgeGraph,
  outEdges: Map<string, SprangEdge[]>,
  inEdges: Map<string, SprangEdge[]>
): void {
  const { overConnectedTotalDegree } = DEFAULT_SMELL_THRESHOLDS;

  for (const node of graph.nodes) {
    const totalDegree =
      (outEdges.get(node.id) ?? []).length + (inEdges.get(node.id) ?? []).length;

    if (totalDegree > overConnectedTotalDegree) {
      addWarning(
        node,
        makeWarning(
          'over_connected',
          'medium',
          `Node has total degree ${totalDegree}, exceeding threshold ${overConnectedTotalDegree}.`,
          `total_degree > ${overConnectedTotalDegree}`,
          []
        )
      );
    }
  }
}

// ─── Detector 5: unstable_interface ──────────────────────────────────────────

function detectUnstableInterfaces(
  graph: KnowledgeGraph,
  inEdges: Map<string, SprangEdge[]>
): void {
  const {
    unstableInterfaceChangeFrequency,
    unstableInterfaceInDegree,
  } = DEFAULT_SMELL_THRESHOLDS;

  for (const node of graph.nodes) {
    if (!node.decision_context) continue;

    const changeFreq = node.decision_context.change_frequency;
    const inDegree = (inEdges.get(node.id) ?? []).length;

    if (changeFreq > unstableInterfaceChangeFrequency && inDegree > unstableInterfaceInDegree) {
      addWarning(
        node,
        makeWarning(
          'unstable_interface',
          'high',
          `Changed ${changeFreq} times in 90 days, depended on by ${inDegree} nodes.`,
          `change_frequency > ${unstableInterfaceChangeFrequency} AND in_degree > ${unstableInterfaceInDegree}`,
          []
        )
      );
    }
  }
}

// ─── Detector 6: duplicate_logic ─────────────────────────────────────────────

function detectDuplicateLogic(
  graph: KnowledgeGraph,
  nodeMap: Map<string, SprangNode>,
  inEdges: Map<string, SprangEdge[]>
): void {
  const functionNodes = graph.nodes.filter((n) => n.type === 'function');

  function complexityBucket(c: SprangNode['complexity']): number {
    if (c === 'complex') return 2;
    if (c === 'moderate') return 1;
    return 0; // simple or undefined
  }

  function paramBucket(node: SprangNode): number {
    const meta = node.metadata as Record<string, unknown> | undefined;
    const paramCount = typeof meta?.['param_count'] === 'number' ? meta['param_count'] : 0;
    return Math.floor(paramCount / 2);
  }

  function signature(node: SprangNode): string {
    return `${paramBucket(node)}:${complexityBucket(node.complexity)}`;
  }

  // Group functions by signature
  const groups = new Map<string, SprangNode[]>();
  for (const fn of functionNodes) {
    const sig = signature(fn);
    if (!groups.has(sig)) groups.set(sig, []);
    groups.get(sig)!.push(fn);
  }

  // For each group with >=2 functions, find pairs with >=2 shared callers
  for (const [, group] of groups) {
    if (group.length < 2) continue;

    // Build caller sets: callers are nodes with 'calls' edge pointing TO this function
    const callerSets = new Map<string, Set<string>>();
    for (const fn of group) {
      const callers = new Set<string>();
      for (const edge of inEdges.get(fn.id) ?? []) {
        if (edge.type === 'calls') {
          callers.add(edge.source);
        }
      }
      callerSets.set(fn.id, callers);
    }

    // Check all pairs
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const fnA = group[i]!;
        const fnB = group[j]!;
        const callersA = callerSets.get(fnA.id)!;
        const callersB = callerSets.get(fnB.id)!;

        let sharedCallers = 0;
        for (const caller of callersA) {
          if (callersB.has(caller)) sharedCallers++;
        }

        if (sharedCallers >= 2) {
          const severity: StructuralWarning['severity'] =
            group.length > 4 ? 'high' : group.length > 2 ? 'medium' : 'low';
          const desc = `Function may duplicate logic with "${fnB.label}" — ${sharedCallers} shared callers and same complexity/param signature.`;
          addWarning(
            fnA,
            makeWarning('duplicate_logic', severity, desc, `shared_callers >= 2`, [fnB.id])
          );
          addWarning(
            fnB,
            makeWarning('duplicate_logic', severity, desc, `shared_callers >= 2`, [fnA.id])
          );
        }
      }
    }
  }
}

// ─── Detector 7: unclear_coupling ────────────────────────────────────────────

function detectUnclearCoupling(
  graph: KnowledgeGraph,
  outEdges: Map<string, SprangEdge[]>
): void {
  const { unclearCouplingSharedImportRatio } = DEFAULT_SMELL_THRESHOLDS;
  const MAX_PAIRS = 1000;

  type CandidateNode = { id: string; importTargets: Set<string> };

  // Find file/module nodes with out_degree > 3 that have import edges
  const candidates: CandidateNode[] = [];
  for (const node of graph.nodes) {
    if (node.type !== 'file' && node.type !== 'module') continue;
    const importEdges = (outEdges.get(node.id) ?? []).filter(
      (e) => e.type === 'imports' || e.type === 'depends_on'
    );
    if (importEdges.length <= 3) continue;
    candidates.push({
      id: node.id,
      importTargets: new Set(importEdges.map((e) => e.target)),
    });
  }

  const nodeMap = new Map<string, SprangNode>(graph.nodes.map((n) => [n.id, n]));

  let pairCount = 0;
  for (let i = 0; i < candidates.length && pairCount < MAX_PAIRS; i++) {
    for (let j = i + 1; j < candidates.length && pairCount < MAX_PAIRS; j++) {
      pairCount++;
      const a = candidates[i]!;
      const b = candidates[j]!;

      // No direct edge between them
      const hasDirectEdge = graph.edges.some(
        (e) =>
          (e.source === a.id && e.target === b.id) ||
          (e.source === b.id && e.target === a.id)
      );
      if (hasDirectEdge) continue;

      // Compute overlap
      let intersection = 0;
      for (const t of a.importTargets) {
        if (b.importTargets.has(t)) intersection++;
      }
      const maxSize = Math.max(a.importTargets.size, b.importTargets.size);
      if (maxSize === 0) continue;
      const overlapRatio = intersection / maxSize;

      if (overlapRatio > unclearCouplingSharedImportRatio) {
        const nodeA = nodeMap.get(a.id);
        const nodeB = nodeMap.get(b.id);
        if (!nodeA || !nodeB) continue;
        const desc =
          `Modules share ${intersection} of ${maxSize} import targets (ratio ${overlapRatio.toFixed(2)}) ` +
          `but have no direct edge — possible hidden coupling.`;
        addWarning(
          nodeA,
          makeWarning('unclear_coupling', 'medium', desc, `overlap_ratio > ${unclearCouplingSharedImportRatio}`, [b.id])
        );
        addWarning(
          nodeB,
          makeWarning('unclear_coupling', 'medium', desc, `overlap_ratio > ${unclearCouplingSharedImportRatio}`, [a.id])
        );
      }
    }
  }
}

// ─── Detector 8: low_cohesion ─────────────────────────────────────────────────

function detectLowCohesion(
  graph: KnowledgeGraph,
  outEdges: Map<string, SprangEdge[]>
): void {
  if (graph.domains.length === 0) return;

  const {
    lowCohesionDomainCount,
    lowCohesionDomainRatio,
  } = DEFAULT_SMELL_THRESHOLDS;

  // Build map: nodeId → set of domain IDs that reference it
  const nodeToDomainsMap = new Map<string, Set<string>>();
  for (const domain of graph.domains) {
    for (const flow of domain.flows) {
      for (const step of flow.steps) {
        for (const nodeId of step.node_ids) {
          if (!nodeToDomainsMap.has(nodeId)) nodeToDomainsMap.set(nodeId, new Set());
          nodeToDomainsMap.get(nodeId)!.add(domain.id);
        }
      }
    }
  }

  for (const fileNode of graph.nodes) {
    if (fileNode.type !== 'file') continue;

    // Find child function nodes via 'contains' edges
    const childFunctionIds = (outEdges.get(fileNode.id) ?? [])
      .filter((e) => e.type === 'contains')
      .map((e) => e.target);

    if (childFunctionIds.length === 0) continue;

    // Count domain references for each child function
    const domainFreq = new Map<string, number>();
    let functionsWithDomainRef = 0;

    for (const fnId of childFunctionIds) {
      const domains = nodeToDomainsMap.get(fnId);
      if (!domains || domains.size === 0) continue;
      functionsWithDomainRef++;
      for (const domainId of domains) {
        domainFreq.set(domainId, (domainFreq.get(domainId) ?? 0) + 1);
      }
    }

    if (domainFreq.size < lowCohesionDomainCount) continue;

    // Check if < 50% reference the same domain
    const maxDomainRefs = Math.max(...Array.from(domainFreq.values()), 0);
    const dominantRatio = functionsWithDomainRef > 0 ? maxDomainRefs / functionsWithDomainRef : 0;

    if (dominantRatio < lowCohesionDomainRatio) {
      addWarning(
        fileNode,
        makeWarning(
          'low_cohesion',
          'medium',
          `File functions reference ${domainFreq.size} distinct domains with no dominant domain (max ${(dominantRatio * 100).toFixed(0)}% in one domain).`,
          `distinct_domains >= ${lowCohesionDomainCount} AND dominant_ratio < ${lowCohesionDomainRatio}`,
          []
        )
      );
    }
  }
}

// ─── Smell summary builder ────────────────────────────────────────────────────

function buildSmellSummary(graph: KnowledgeGraph): SmellSummary {
  const byCategory: Partial<Record<SmellCategory, number>> = {};
  const bySeverity = { high: 0, medium: 0, low: 0 };
  const affectedSet = new Set<string>();

  for (const node of graph.nodes) {
    if (!node.structural_warnings || node.structural_warnings.length === 0) continue;
    affectedSet.add(node.id);
    for (const w of node.structural_warnings) {
      byCategory[w.category] = (byCategory[w.category] ?? 0) + 1;
      bySeverity[w.severity]++;
    }
  }

  const total = Object.values(bySeverity).reduce((a, b) => a + b, 0);
  return {
    total_warnings: total,
    by_category: byCategory,
    by_severity: bySeverity,
    affected_nodes: Array.from(affectedSet),
  };
}

// ─── Agent ────────────────────────────────────────────────────────────────────

export class SmellDetectorAgent extends BaseAgent {
  readonly id = 'smell-detector';
  readonly phase = 2 as const;

  async run(ctx: AgentContext): Promise<AgentResult> {
    const graph = ctx.graph;

    if (graph.nodes.length === 0) {
      await this.writeIntermediate(ctx, 'smells.json', buildSmellSummary(graph));
      return this.success(ctx, graph);
    }

    // Build node map and adjacency maps
    const nodeMap = new Map<string, SprangNode>(graph.nodes.map((n) => [n.id, n]));
    const { outEdges, inEdges } = buildAdjacencyMaps(graph.edges);

    // Run all 8 detectors
    detectGodNodes(graph, nodeMap, outEdges, inEdges);
    detectCircularDependencies(graph, nodeMap, outEdges);
    detectOrphanNodes(graph, outEdges, inEdges);
    detectOverConnected(graph, outEdges, inEdges);
    detectUnstableInterfaces(graph, inEdges);
    detectDuplicateLogic(graph, nodeMap, inEdges);
    detectUnclearCoupling(graph, outEdges);
    detectLowCohesion(graph, outEdges);

    // Build summary
    const summary = buildSmellSummary(graph);

    // Update graph stats
    graph.stats.smell_summary = summary.by_category;

    // Write intermediate output
    await this.writeIntermediate(ctx, 'smells.json', summary);

    return this.success(ctx, graph);
  }
}
