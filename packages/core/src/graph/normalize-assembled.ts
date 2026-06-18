/**
 * normalizeAssembledGraph — coerce an agent-assembled knowledge graph into the
 * canonical shape required by `knowledgeGraphSchema`.
 *
 * This is the TypeScript twin of `skills/sprang-analyze/scripts/merge.py`'s
 * normalisation. Over a long multi-phase `/sprang-analyze` run the agent drifts
 * from the JSON templates (domains using `name` not `label`, flat domains with
 * no `flows`/`steps`, tour steps using `title`/`description`, `risk_factors`
 * outside the enum, `structural_warnings` as bare strings, partial
 * `decision_context`). Both `sprang merge` (this module) and `merge.py` run this
 * normalisation so the written graph always validates — whichever path assembled it.
 *
 * Keep this in sync with merge.py (`packages/cli/tests/merge-normalize.test.ts`
 * and `packages/core/tests/graph/normalize-assembled.test.ts` guard both).
 */

const SMELL_CATEGORIES = new Set([
  'duplicate_logic', 'unclear_coupling', 'low_cohesion', 'god_node',
  'unstable_interface', 'orphan_node', 'circular_dependency', 'over_connected',
  'name_duplicate', 'layer_violation',
]);
const SECURITY_CATEGORIES = new Set([
  'hardcoded_secret', 'sql_injection', 'xss_risk', 'unsafe_eval',
  'unsafe_exec', 'unsafe_deserialization', 'path_traversal', 'weak_crypto',
]);
const RISK_FACTORS = new Set([
  'high_coupling', 'no_test_coverage', 'frequent_changes', 'large_blast_radius',
  'critical_path', 'single_author', 'recent_churn', 'has_structural_warnings',
]);
const SEVERITIES = new Set(['low', 'medium', 'high']);
const COMPLEXITY = new Set(['simple', 'moderate', 'complex']);

type Dict = Record<string, unknown>;
const isObj = (v: unknown): v is Dict => typeof v === 'object' && v !== null && !Array.isArray(v);

function asArray(v: unknown): unknown[] {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  if (isObj(v)) return Object.values(v);
  return [];
}
function str(v: unknown, dflt = ''): string {
  return typeof v === 'string' ? v : v == null ? dflt : String(v);
}
function strList(v: unknown): string[] {
  return asArray(v).filter((x) => x != null).map((x) => str(x));
}
function slug(s: string, fallback: string): string {
  const out = s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return out || fallback;
}
function toInt(v: unknown, dflt = 0): number {
  const n = typeof v === 'number' ? v : parseFloat(str(v));
  return Number.isFinite(n) ? Math.trunc(n) : dflt;
}
function clamp01(v: unknown, dflt = 0.5): number {
  const n = typeof v === 'number' ? v : parseFloat(str(v));
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : dflt;
}

function normalizeCommit(c: unknown): Dict | null {
  if (!isObj(c) || !c['sha']) return null;
  const out: Dict = { sha: str(c['sha']), date: str(c['date']), message: str(c['message']), author: str(c['author']) };
  if (c['diff_summary']) out['diff_summary'] = str(c['diff_summary']);
  return out;
}
function normalizeDecisionContext(dc: unknown): Dict | null {
  if (!isObj(dc)) return null;
  return {
    commits: asArray(dc['commits']).map(normalizeCommit).filter(Boolean),
    primary_authors: strList(dc['primary_authors']),
    last_changed: str(dc['last_changed']),
    change_frequency: toInt(dc['change_frequency'], 0),
    rationale_snippets: strList(dc['rationale_snippets']),
    pr_references: strList(dc['pr_references']),
    changelog_entries: strList(dc['changelog_entries']),
  };
}
function normalizeStructuralWarning(w: unknown): Dict | null {
  if (!isObj(w) || !SMELL_CATEGORIES.has(str(w['category']))) return null;
  return {
    category: str(w['category']),
    severity: SEVERITIES.has(str(w['severity'])) ? str(w['severity']) : 'medium',
    description: str(w['description']),
    related_node_ids: strList(w['related_node_ids']),
    heuristic: str(w['heuristic']),
  };
}
function normalizeSecurityWarning(w: unknown): Dict | null {
  if (!isObj(w) || !SECURITY_CATEGORIES.has(str(w['category']))) return null;
  const out: Dict = {
    category: str(w['category']),
    severity: SEVERITIES.has(str(w['severity'])) ? str(w['severity']) : 'medium',
    description: str(w['description']),
    pattern: str(w['pattern']),
  };
  if (typeof w['line'] === 'number') out['line'] = w['line'];
  if (w['snippet']) out['snippet'] = str(w['snippet']);
  return out;
}

function normalizeNode(n: unknown): Dict | null {
  if (!isObj(n) || !n['id']) return null;
  const node: Dict = { ...n };
  if (!node['label']) node['label'] = node['name'] ?? str(node['id']).split(':').pop() ?? str(node['id']);
  if (!COMPLEXITY.has(str(node['complexity']))) delete node['complexity'];

  if ('decision_context' in node) {
    const dc = normalizeDecisionContext(node['decision_context']);
    if (dc) node['decision_context'] = dc; else delete node['decision_context'];
  }
  if ('structural_warnings' in node) {
    const ws = asArray(node['structural_warnings']).map(normalizeStructuralWarning).filter(Boolean);
    if (ws.length) node['structural_warnings'] = ws; else delete node['structural_warnings'];
  }
  if ('security_warnings' in node) {
    const sw = asArray(node['security_warnings']).map(normalizeSecurityWarning).filter(Boolean);
    if (sw.length) node['security_warnings'] = sw; else delete node['security_warnings'];
  }
  if ('risk_factors' in node) {
    const rf = asArray(node['risk_factors']).filter((f) => RISK_FACTORS.has(str(f))).map((f) => str(f));
    if (rf.length) node['risk_factors'] = rf; else delete node['risk_factors'];
  }
  if ('risk_score' in node) {
    if (typeof node['risk_score'] === 'number') node['risk_score'] = Math.max(0, Math.min(1, node['risk_score']));
    else delete node['risk_score'];
  }
  return node;
}

function normalizeLayer(l: unknown, idx: number): Dict | null {
  if (typeof l === 'string') return { id: slug(l, `layer-${idx}`), name: l, node_ids: [] };
  if (!isObj(l)) return null;
  const name = str(l['name'] || l['label'] || l['id'] || `Layer ${idx}`);
  const out: Dict = { id: str(l['id'] || slug(name, `layer-${idx}`)), name, node_ids: strList(l['node_ids']) };
  if (l['description']) out['description'] = str(l['description']);
  return out;
}

function normalizeTourStep(st: unknown): Dict | null {
  if (!isObj(st)) return null;
  const title = st['step_title'] || st['title'] || st['label'];
  const expl = st['explanation'] || st['description'] || st['summary'];
  if (!(title || expl || st['node_id'] || st['node_ids'])) return null;
  const out: Dict = { step_title: str(title) || 'Step', explanation: str(expl) };
  if (st['node_id']) out['node_id'] = str(st['node_id']);
  if (st['node_ids']) out['node_ids'] = strList(st['node_ids']);
  if (st['language_lesson']) out['language_lesson'] = str(st['language_lesson']);
  if (typeof st['highlight'] === 'boolean') out['highlight'] = st['highlight'];
  return out;
}
function normalizeTour(t: unknown, idx: number): Dict | null {
  if (!isObj(t)) return null;
  const steps = asArray(t['steps']).map(normalizeTourStep).filter(Boolean).slice(0, 15);
  if (!steps.length) return null;
  const out: Dict = {
    id: str(t['id'] || `tour-${idx}`),
    title: str(t['title'] || t['name'] || 'Architecture Tour'),
    description: str(t['description'] || t['summary'] || 'Guided walkthrough of the codebase'),
    steps,
  };
  if (t['entry_point']) out['entry_point'] = str(t['entry_point']);
  return out;
}

function normalizeDomainStep(st: unknown, fid: string, idx: number): Dict | null {
  if (!isObj(st)) return st ? { id: `${fid}-step-${idx}`, label: str(st), node_ids: [], weight: 0.5 } : null;
  const sid = str(st['id'] || `${fid}-step-${idx}`);
  const out: Dict = { id: sid, label: str(st['label'] || st['name'] || sid), node_ids: strList(st['node_ids']), weight: clamp01(st['weight'], 0.5) };
  if (st['summary']) out['summary'] = str(st['summary']);
  return out;
}
function normalizeDomainFlow(fl: unknown, did: string, idx: number): Dict | null {
  if (!isObj(fl)) return null;
  const fid = str(fl['id'] || `${did}-flow-${idx}`);
  const label = str(fl['label'] || fl['name'] || fid);
  let steps = asArray(fl['steps']).map((s, i) => normalizeDomainStep(s, fid, i)).filter(Boolean) as Dict[];
  if (!steps.length) steps = [{ id: `${fid}-step`, label, node_ids: strList(fl['node_ids']), weight: 1.0 }];
  const out: Dict = { id: fid, label, steps };
  if (fl['summary']) out['summary'] = str(fl['summary']);
  if (fl['entry_points']) out['entry_points'] = strList(fl['entry_points']);
  if (fl['business_rules']) out['business_rules'] = strList(fl['business_rules']);
  return out;
}
function normalizeDomain(d: unknown, idx: number): Dict | null {
  if (!isObj(d)) return null;
  const label = str(d['label'] || d['name'] || `Domain ${idx}`);
  const did = str(d['id'] || slug(label, `domain-${idx}`));
  let flows = asArray(d['flows']).map((f, i) => normalizeDomainFlow(f, did, i)).filter(Boolean) as Dict[];
  if (!flows.length) {
    flows = [{ id: `${did}-flow`, label, steps: [{ id: `${did}-step`, label, node_ids: strList(d['node_ids']), weight: 1.0 }] }];
  }
  const out: Dict = { id: did, label, flows };
  if (d['summary'] || d['description']) out['summary'] = str(d['summary'] || d['description']);
  if (d['entities']) out['entities'] = strList(d['entities']);
  return out;
}

export interface NormalizedAssembly {
  nodes: Dict[];
  layers: Dict[];
  tours: Dict[];
  domains: Dict[];
  smell_summary: Record<string, number>;
  security_summary: { total: number; by_severity: { high: number; medium: number; low: number }; by_category: Record<string, number> } | undefined;
  risk_summary: { high: number; medium: number; low: number };
}

/**
 * Normalise the agent-assembled pieces into schema-valid structures and recompute
 * the derived summaries. Returns normalised arrays + summaries to drop into the
 * graph envelope. `metaSmellSummary` is a fallback used only if no node warnings exist.
 */
export function normalizeAssembledGraph(input: {
  nodes: unknown[];
  layers: unknown[];
  tours: unknown[];
  domains: unknown[];
  metaSmellSummary?: unknown;
}): NormalizedAssembly {
  const nodes = input.nodes.map(normalizeNode).filter(Boolean) as Dict[];
  const layers = input.layers.map((l, i) => normalizeLayer(l, i)).filter(Boolean) as Dict[];

  // Wrap a flat step array into a single Tour object before normalising.
  let rawTours = [...input.tours];
  if (rawTours.length && isObj(rawTours[0]) && !('steps' in (rawTours[0] as Dict))) {
    const entry = (rawTours[0] as Dict)['node_ids'];
    rawTours = [{
      id: 'tour-main', title: 'Architecture Tour',
      description: 'Guided walkthrough from entry point through all layers',
      entry_point: Array.isArray(entry) ? entry[0] : undefined,
      steps: rawTours,
    }];
  }
  const tours = rawTours.map((t, i) => normalizeTour(t, i)).filter(Boolean) as Dict[];
  const domains = input.domains.map((d, i) => normalizeDomain(d, i)).filter(Boolean) as Dict[];

  // Recompute summaries from normalised node warnings.
  const smell_summary: Record<string, number> = {};
  const secBySev = { high: 0, medium: 0, low: 0 };
  const secByCat: Record<string, number> = {};
  let secTotal = 0;
  const risk_summary = { high: 0, medium: 0, low: 0 };
  for (const n of nodes) {
    for (const w of asArray(n['structural_warnings'])) {
      const cat = str((w as Dict)['category']);
      smell_summary[cat] = (smell_summary[cat] ?? 0) + 1;
    }
    for (const w of asArray(n['security_warnings'])) {
      secTotal++;
      const sev = str((w as Dict)['severity']) as 'high' | 'medium' | 'low';
      const cat = str((w as Dict)['category']);
      if (sev in secBySev) secBySev[sev]++;
      secByCat[cat] = (secByCat[cat] ?? 0) + 1;
    }
    const r = typeof n['risk_score'] === 'number' ? n['risk_score'] : 0;
    if (r >= 0.7) risk_summary.high++; else if (r >= 0.4) risk_summary.medium++; else risk_summary.low++;
  }
  if (Object.keys(smell_summary).length === 0 && isObj(input.metaSmellSummary)) {
    for (const [k, v] of Object.entries(input.metaSmellSummary)) {
      if (SMELL_CATEGORIES.has(k) && typeof v === 'number') smell_summary[k] = Math.trunc(v);
    }
  }
  const security_summary = secTotal ? { total: secTotal, by_severity: secBySev, by_category: secByCat } : undefined;

  return { nodes, layers, tours, domains, smell_summary, security_summary, risk_summary };
}
