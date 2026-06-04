import type { KnowledgeGraph, SprangNode, SprangEdge } from '../schema/types.js';

export interface NormalizationReport {
  doublePrefix: number;     // node IDs that had doubled prefixes fixed
  dedupedNodes: number;     // duplicate node IDs removed
  dedupedEdges: number;     // duplicate edges removed
  danglingEdges: number;    // edges removed because source/target didn't exist
  testedByFixed: number;    // tested_by edges canonicalized
}

const DOUBLE_PREFIX_RE =
  /^(file|function|class|module|concept|config|document|service|table|endpoint|pipeline|schema|resource|domain|flow|step|article|entity|topic|claim|source):\1:/;

const TEST_FILE_RE = /\.test\.|\.spec\.|__tests__/;

export function normalizeGraph(
  graph: KnowledgeGraph
): { graph: KnowledgeGraph; report: NormalizationReport } {
  const report: NormalizationReport = {
    doublePrefix: 0,
    dedupedNodes: 0,
    dedupedEdges: 0,
    danglingEdges: 0,
    testedByFixed: 0,
  };

  // ── Step 1: Strip double-prefixed node IDs ──────────────────────────────────
  // Build a rename map: oldId → newId (only for nodes that need fixing)
  const renameMap = new Map<string, string>();

  const fixedNodes: SprangNode[] = graph.nodes.map((node) => {
    if (DOUBLE_PREFIX_RE.test(node.id)) {
      // Strip one prefix level: "file:file:src/..." → "file:src/..."
      const colonIndex = node.id.indexOf(':');
      const newId = node.id.slice(colonIndex + 1);
      renameMap.set(node.id, newId);
      report.doublePrefix++;
      return { ...node, id: newId };
    }
    return node;
  });

  // Update edge references for renamed IDs
  const renamedEdges: SprangEdge[] = graph.edges.map((edge) => {
    const newSource = renameMap.get(edge.source) ?? edge.source;
    const newTarget = renameMap.get(edge.target) ?? edge.target;
    if (newSource !== edge.source || newTarget !== edge.target) {
      return { ...edge, source: newSource, target: newTarget };
    }
    return edge;
  });

  // ── Step 2: Deduplicate nodes (last-write-wins) ─────────────────────────────
  const nodeMap = new Map<string, SprangNode>();
  for (const node of fixedNodes) {
    if (nodeMap.has(node.id)) {
      report.dedupedNodes++;
    }
    nodeMap.set(node.id, node);
  }
  const dedupedNodes = Array.from(nodeMap.values());

  // ── Step 3: Deduplicate edges (keep first occurrence) ──────────────────────
  const edgeKeySet = new Set<string>();
  const dedupedEdges: SprangEdge[] = [];
  for (const edge of renamedEdges) {
    const key = `${edge.source}:${edge.target}:${edge.type}`;
    if (edgeKeySet.has(key)) {
      report.dedupedEdges++;
    } else {
      edgeKeySet.add(key);
      dedupedEdges.push(edge);
    }
  }

  // ── Step 4: Remove dangling edges ──────────────────────────────────────────
  const nodeIdSet = new Set<string>(dedupedNodes.map((n) => n.id));
  const nonDanglingEdges: SprangEdge[] = [];
  for (const edge of dedupedEdges) {
    if (!nodeIdSet.has(edge.source) || !nodeIdSet.has(edge.target)) {
      report.danglingEdges++;
    } else {
      nonDanglingEdges.push(edge);
    }
  }

  // ── Step 5: Canonicalize tested_by edges (two-pass) ────────────────────────
  // Pass 1: collect all node IDs that have at least one tested_by edge pointing TO them
  const testedByTargets = new Set<string>();
  for (const edge of nonDanglingEdges) {
    if (edge.type === 'tested_by') {
      testedByTargets.add(edge.target);
    }
  }

  // Pass 2: flip reversed tested_by edges
  // A tested_by edge should go FROM the test file TO the source file.
  // If the source of a tested_by edge is a test file, that's correct (test→source).
  // If the target of a tested_by edge is a test file (i.e. source→testFile is reversed), flip it.
  const canonicalEdges: SprangEdge[] = nonDanglingEdges.map((edge) => {
    if (edge.type !== 'tested_by') return edge;

    const targetNode = nodeMap.get(edge.target);
    const targetPath =
      targetNode?.filePath ??
      targetNode?.location?.file ??
      targetNode?.label ??
      '';

    // If the target is a test file, the edge is backwards — flip it
    if (TEST_FILE_RE.test(targetPath)) {
      report.testedByFixed++;
      return { ...edge, source: edge.target, target: edge.source };
    }
    return edge;
  });

  // ── Step 6: Update stats ────────────────────────────────────────────────────
  const normalizedGraph: KnowledgeGraph = {
    ...graph,
    nodes: dedupedNodes,
    edges: canonicalEdges,
    stats: {
      ...graph.stats,
      node_count: dedupedNodes.length,
      edge_count: canonicalEdges.length,
    },
  };

  return { graph: normalizedGraph, report };
}
