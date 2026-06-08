import type { KnowledgeGraph, SprangNode } from '../types';

function getRiskColor(score: number): string {
  if (score >= 0.7) return '#ef4444';
  if (score >= 0.4) return '#f59e0b';
  return '#22c55e';
}

// ─── Force-graph 3D data format ───────────────────────────────────────────────

export interface FGNode {
  id: string;
  label: string;
  nodeType: string;
  riskScore: number;
  color: string;
  val: number; // sphere radius
}

export interface FGLink {
  source: string;
  target: string;
  edgeType: string;
}

export interface ForceGraphData {
  nodes: FGNode[];
  links: FGLink[];
}

export function toForceGraphData(
  graph: KnowledgeGraph,
  showRisk = false,
): ForceGraphData {
  const nodeTypeColors: Record<string, string> = {
    file: '#a1a1aa', function: '#d946ef', class: '#a21caf',
    config: '#d97706', service: '#3b82f6', domain: '#22c55e',
    module: '#8b5cf6', concept: '#06b6d4', document: '#64748b',
    table: '#f97316', endpoint: '#0ea5e9', pipeline: '#ec4899',
    schema: '#84cc16', resource: '#14b8a6', flow: '#6366f1',
    step: '#78716c', article: '#f59e0b', entity: '#10b981',
    topic: '#8b5cf6', claim: '#ef4444', source: '#06b6d4',
  };

  const nodes: FGNode[] = graph.nodes.map((n) => {
    const riskScore = n.risk_score ?? 0;
    const color = showRisk
      ? getRiskColor(riskScore)
      : (nodeTypeColors[n.type] ?? '#71717a');
    return {
      id: n.id,
      label: n.label,
      nodeType: n.type,
      riskScore,
      color,
      val: 1 + riskScore * 3, // sphere size proportional to risk
    };
  });

  const seen = new Set<string>();
  const links: FGLink[] = [];
  for (const e of graph.edges) {
    if (e.source === e.target) continue;
    const key = `${e.source}→${e.target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({ source: e.source, target: e.target, edgeType: e.type });
  }

  return { nodes, links };
}

// ─── D3 hierarchy format for treemap ─────────────────────────────────────────

export interface TreeNode {
  name: string;
  path: string;
  nodeId?: string;
  riskScore?: number;
  lines?: number;
  layer?: string;
  nodeType?: string;
  children?: TreeNode[];
}

export function toHierarchyData(graph: KnowledgeGraph): TreeNode {
  const root: TreeNode = { name: graph.project_name || 'project', path: '', children: [] };
  const folders = new Map<string, TreeNode>([['', root]]);

  const fileNodes = graph.nodes.filter(
    (n) => n.type === 'file' && (n.filePath ?? n.location?.file),
  );

  for (const node of fileNodes) {
    const rawPath = node.filePath ?? node.location?.file ?? '';
    const normalized = rawPath.replace(/\\/g, '/').replace(/^\/+/, '').replace(/^\.\//, '');
    if (!normalized) continue;

    const parts = normalized.split('/');
    let parent = root;
    let currentPath = '';

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i] ?? '';
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const isLeaf = i === parts.length - 1;

      if (isLeaf) {
        const leaf: TreeNode = {
          name: part,
          path: currentPath,
          nodeId: node.id,
          riskScore: node.risk_score ?? 0,
          lines: (node.metadata?.lines as number | undefined) ?? 50,
          layer: node.layer,
          nodeType: node.type,
        };
        parent.children ??= [];
        parent.children.push(leaf);
      } else {
        let folder = folders.get(currentPath);
        if (!folder) {
          folder = { name: part, path: currentPath, children: [] };
          folders.set(currentPath, folder);
          parent.children ??= [];
          parent.children.push(folder);
        }
        parent = folder;
      }
    }
  }

  return root;
}

// ─── Adjacency matrix data ────────────────────────────────────────────────────

export interface MatrixCell {
  row: number;
  col: number;
  weight: number;
  edgeType: string;
}

export interface MatrixData {
  nodes: SprangNode[];
  cells: MatrixCell[];
}

const LAYER_RANK: Record<string, number> = {
  infrastructure: 0, infra: 0,
  config: 1, configuration: 1,
  schema: 2,
  data: 3,
  domain: 4,
  api: 5,
  ui: 6, view: 6, presentation: 6,
};

export function toMatrixData(graph: KnowledgeGraph, maxNodes = 150): MatrixData {
  // Pick file nodes sorted by layer rank then label
  let fileNodes = graph.nodes.filter((n) => n.type === 'file');

  if (fileNodes.length > maxNodes) {
    // Keep highest-degree nodes
    const degreeMap: Record<string, number> = {};
    for (const e of graph.edges) {
      degreeMap[e.source] = (degreeMap[e.source] ?? 0) + 1;
      degreeMap[e.target] = (degreeMap[e.target] ?? 0) + 1;
    }
    fileNodes = fileNodes
      .sort((a, b) => (degreeMap[b.id] ?? 0) - (degreeMap[a.id] ?? 0))
      .slice(0, maxNodes);
  }

  // Sort by layer rank then label
  fileNodes.sort((a, b) => {
    const ra = LAYER_RANK[a.layer ?? ''] ?? 99;
    const rb = LAYER_RANK[b.layer ?? ''] ?? 99;
    if (ra !== rb) return ra - rb;
    return a.label.localeCompare(b.label);
  });

  const idxMap = new Map<string, number>();
  fileNodes.forEach((n, i) => idxMap.set(n.id, i));

  const weightMap = new Map<string, { weight: number; edgeType: string }>();
  for (const e of graph.edges) {
    if (e.type !== 'imports' && e.type !== 'depends_on') continue;
    const r = idxMap.get(e.source);
    const c = idxMap.get(e.target);
    if (r === undefined || c === undefined || r === c) continue;
    const key = `${r},${c}`;
    const existing = weightMap.get(key);
    weightMap.set(key, {
      weight: (existing?.weight ?? 0) + (e.weight ?? 1),
      edgeType: e.type,
    });
  }

  const cells: MatrixCell[] = [];
  for (const [key, { weight, edgeType }] of weightMap) {
    const [r, c] = key.split(',').map(Number);
    cells.push({ row: r!, col: c!, weight, edgeType });
  }

  return { nodes: fileNodes, cells };
}
