/**
 * Dead-code detection and actionable suggestions.
 *
 * Everything in this file turns signals the graph *already carries* into
 * something a human or an agent can act on. Nothing here invents data: if a
 * metric is absent, the corresponding suggestion is simply not emitted. A
 * fabricated recommendation ("ask the owner", "this saves 30% build time")
 * costs far more than a missing one — it teaches the reader to discount every
 * other thing Sprang says.
 */

import type {
  KnowledgeGraph,
  SecurityWarning,
  SmellCategory,
  SprangEdge,
  SprangNode,
  StructuralWarning,
} from '../schema/types.js';

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

/** A symbol that appears to have no callers anywhere in the graph. */
export interface DeadCodeFinding {
  nodeId: string;
  name: string;
  /** Project-relative path the symbol lives in; `''` when the graph omits it. */
  file: string;
  line?: number;
  /**
   * `high` is reserved for findings where every conservative check passed and
   * the containing file is itself reachable. Everything else is `medium`:
   * still worth a look, not worth a blind deletion.
   */
  confidence: 'high' | 'medium';
  reason: string;
}

/** A prioritised, evidence-backed recommendation. */
export interface Suggestion {
  id: string;
  priority: 'critical' | 'high' | 'medium';
  /** Short and imperative — this is a card title, not a sentence. */
  title: string;
  /** One or two sentences of evidence, carrying the real numbers. */
  detail: string;
  /** The concrete next step, naming files or tools. */
  action: string;
  /** What improves, quantified only where the number was actually computed. */
  impact: string;
  /** Up to five example node ids. */
  nodeIds: string[];
}

/**
 * Names that frameworks, runtimes and test harnesses invoke reflectively.
 *
 * A call-graph built from source can never see these invocations, so a symbol
 * named `handler` having no incoming `calls` edge is evidence of nothing at
 * all. Exported as a constant so the list is auditable and testable rather
 * than buried in a closure.
 *
 * Matching is case-insensitive, which deliberately over-exempts (`get` as well
 * as `GET`). For a dead-code report that trade is correct: a false positive
 * tells someone to delete live code, a false negative just stays quiet.
 */
export const FRAMEWORK_INVOKED_NAMES: readonly string[] = [
  // generic entrypoints
  'main',
  'default',
  'handler',
  'run',
  'start',
  'serve',
  'execute',
  'init',
  'setup',
  'teardown',
  'render',
  'constructor',
  // UI / component lifecycle
  'componentDidMount',
  'componentDidUpdate',
  'componentWillUnmount',
  'shouldComponentUpdate',
  'ngOnInit',
  'ngOnDestroy',
  'ngOnChanges',
  'ngAfterViewInit',
  'useEffect',
  'mounted',
  'created',
  'destroyed',
  // Python dunders
  '__init__',
  '__main__',
  '__new__',
  '__del__',
  '__call__',
  '__enter__',
  '__exit__',
  '__aenter__',
  '__aexit__',
  '__repr__',
  '__str__',
  '__eq__',
  '__hash__',
  '__iter__',
  '__next__',
  '__len__',
  '__getitem__',
  '__setitem__',
  '__post_init__',
  // test hooks
  'beforeEach',
  'afterEach',
  'beforeAll',
  'afterAll',
  'setUp',
  'tearDown',
  'setUpClass',
  'tearDownClass',
  'setup_method',
  'teardown_method',
  // HTTP verb handlers (Next.js route handlers, Deno, SvelteKit, ...)
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
  // migration hooks
  'up',
  'down',
  'upgrade',
  'downgrade',
  'forwards',
  'backwards',
];

const EXEMPT_LOOKUP: ReadonlySet<string> = new Set(
  FRAMEWORK_INVOKED_NAMES.map((n) => n.toLowerCase()),
);

/** Path fragments that mark a file as test code rather than shipped code. */
const TEST_PATH_MARKERS: readonly string[] = [
  '__tests__',
  '.test.',
  '.spec.',
  '/tests/',
  '/test/',
  '__mocks__',
];

// ─────────────────────────────────────────────────────────────────────────────
// Small, total metadata accessors
//
// `SprangNode.metadata` is `Record<string, unknown>`: every read has to be
// guarded, so these helpers exist to keep the rules below readable and free of
// casts.
// ─────────────────────────────────────────────────────────────────────────────

type Meta = Record<string, unknown> | undefined;

function numField(meta: Meta, key: string): number | undefined {
  const value = meta?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function strField(meta: Meta, key: string): string | undefined {
  const value = meta?.[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function boolField(meta: Meta, key: string): boolean | undefined {
  const value = meta?.[key];
  return typeof value === 'boolean' ? value : undefined;
}

/**
 * The `behavioral` sub-object written by the behavioural analyser — but only
 * for source files.
 *
 * Behavioural data on a changelog, a lockfile or a .gitignore is real but
 * meaningless: those files are touched by nearly every commit, so they
 * accumulate the highest churn, the most "traps" and the largest bug-fix
 * counts in any repository. Left ungated they crowd out every genuine finding,
 * and a suggestion list whose top entry is "read the change history of
 * CHANGELOG.md" is one nobody reads twice.
 */
function behavioralOf(node: SprangNode): Meta {
  const category = node.metadata?.['fileCategory'];
  if (category !== undefined && category !== 'source') return undefined;
  const value = node.metadata?.['behavioral'];
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
}

function nodeName(node: SprangNode): string {
  return node.name ?? node.label ?? node.id;
}

/** Best-effort project-relative path for any node. */
function pathOf(node: SprangNode): string {
  return node.location?.file ?? node.filePath ?? '';
}

function isTestPath(path: string): boolean {
  if (path.length === 0) return false;
  const normalised = `/${path.replace(/\\/g, '/').replace(/^\/+/, '')}`.toLowerCase();
  return TEST_PATH_MARKERS.some((marker) => normalised.includes(marker));
}

/** A short, stable label for a node used inside suggestion prose. */
function displayOf(node: SprangNode): string {
  const path = pathOf(node);
  return path.length > 0 ? path : nodeName(node);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Human list of at most `n` names, e.g. "a, b and 3 more". */
function sampleList(labels: readonly string[], n = 3): string {
  const head = labels.slice(0, n);
  const rest = labels.length - head.length;
  const joined = head.join(', ');
  return rest > 0 ? `${joined} and ${rest} more` : joined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Graph index
// ─────────────────────────────────────────────────────────────────────────────

interface GraphIndex {
  /** Ids that are the target of at least one `calls` edge. */
  calledIds: ReadonlySet<string>;
  /** File node keyed by every path spelling it answers to, plus its id. */
  fileByPath: ReadonlyMap<string, SprangNode>;
  /** Number of incoming edges per node id (self-edges excluded). */
  inDegree: ReadonlyMap<string, number>;
}

function indexGraph(nodes: readonly SprangNode[], edges: readonly SprangEdge[]): GraphIndex {
  const calledIds = new Set<string>();
  const inDegree = new Map<string, number>();
  for (const edge of edges) {
    if (edge.source === edge.target) continue;
    if (edge.type === 'calls') calledIds.add(edge.target);
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  }

  const fileByPath = new Map<string, SprangNode>();
  for (const node of nodes) {
    if (node.type !== 'file') continue;
    for (const key of [node.id, node.filePath, node.location?.file]) {
      if (typeof key === 'string' && key.length > 0 && !fileByPath.has(key)) {
        fileByPath.set(key, node);
      }
    }
  }

  return { calledIds, fileByPath, inDegree };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Dead code
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Report functions and classes that nothing appears to call.
 *
 * Deliberately recall-conservative. Telling a team to delete code that is
 * actually live is the single most damaging thing a tool like this can do, so
 * every ambiguous case is dropped or downgraded:
 *
 * - only `function` and `class` nodes are considered;
 * - anything with an incoming `calls` edge is live;
 * - anything exported is public API — having no *internal* caller is its normal
 *   state, not a defect;
 * - anything named like a framework hook is exempt (see
 *   {@link FRAMEWORK_INVOKED_NAMES});
 * - non-source files and test paths are skipped entirely.
 *
 * `high` confidence additionally requires the containing file to be an
 * explicitly categorised source file that is itself reachable. An unreachable
 * file is a different, larger finding — reporting each of its symbols as
 * high-confidence dead code would be double counting.
 */
export function detectDeadCode(graph: Pick<KnowledgeGraph, 'nodes' | 'edges'>): DeadCodeFinding[] {
  const nodes = graph.nodes ?? [];
  const edges = graph.edges ?? [];
  if (nodes.length === 0) return [];

  const { calledIds, fileByPath, inDegree } = indexGraph(nodes, edges);
  const findings: DeadCodeFinding[] = [];

  for (const node of nodes) {
    if (node.type !== 'function' && node.type !== 'class') continue;
    if (calledIds.has(node.id)) continue;

    // Public API: no internal caller is expected, so absence proves nothing.
    if (boolField(node.metadata, 'exported') === true) continue;

    const name = nodeName(node);
    if (EXEMPT_LOOKUP.has(name.toLowerCase())) continue;

    const path = pathOf(node);
    if (isTestPath(path)) continue;

    const fileNode = path.length > 0 ? fileByPath.get(path) : undefined;
    if (fileNode !== undefined && isTestPath(pathOf(fileNode))) continue;

    // `fileCategory` may live on the symbol or on its file node. Undefined is
    // treated as source — same convention as the risk scorer — but it is not
    // good enough for high confidence.
    const ownCategory = strField(node.metadata, 'fileCategory');
    const fileCategory = ownCategory ?? strField(fileNode?.metadata, 'fileCategory');
    if (fileCategory !== undefined && fileCategory !== 'source') continue;

    const fileReachable = fileNode !== undefined && (inDegree.get(fileNode.id) ?? 0) > 0;
    const confidence: DeadCodeFinding['confidence'] =
      fileCategory === 'source' && fileReachable ? 'high' : 'medium';

    const reason =
      confidence === 'high'
        ? `No incoming call edges; ${name} is not exported, not a known framework hook, and lives in a reachable source file.`
        : `No incoming call edges and ${name} is not exported, but confidence is reduced because ` +
          (fileCategory !== 'source'
            ? 'the containing file is not marked as source code.'
            : 'the containing file has no incoming edges, so it may be unreachable as a whole.');

    const line = node.location?.start_line ?? node.lineRange?.[0];
    findings.push({
      nodeId: node.id,
      name,
      file: path,
      ...(typeof line === 'number' ? { line } : {}),
      confidence,
      reason,
    });
  }

  return findings;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Suggestions
// ─────────────────────────────────────────────────────────────────────────────

const PRIORITY_RANK: Record<Suggestion['priority'], number> = {
  critical: 0,
  high: 1,
  medium: 2,
};

/** A suggestion plus the evidence count used only for ordering. */
interface RankedSuggestion {
  suggestion: Suggestion;
  /** How many distinct pieces of evidence support it. Higher sorts first. */
  strength: number;
}

/** Maximum number of cards returned. A list of 200 is a list nobody reads. */
export const MAX_SUGGESTIONS = 12;

function collectWarnings(
  nodes: readonly SprangNode[],
  category: SmellCategory,
): { node: SprangNode; warning: StructuralWarning }[] {
  const out: { node: SprangNode; warning: StructuralWarning }[] = [];
  for (const node of nodes) {
    for (const warning of node.structural_warnings ?? []) {
      if (warning?.category === category) out.push({ node, warning });
    }
  }
  return out;
}

function highestSeverity(
  warnings: readonly StructuralWarning[],
): 'low' | 'medium' | 'high' | undefined {
  let best: 'low' | 'medium' | 'high' | undefined;
  for (const w of warnings) {
    if (w.severity === 'high') return 'high';
    if (w.severity === 'medium') best = 'medium';
    else if (best === undefined) best = 'low';
  }
  return best;
}

/**
 * Build the prioritised suggestion list for a graph.
 *
 * Each rule below reads one signal that is already present on the nodes and
 * emits *at most one* card for it, aggregating up to five example node ids.
 * One card per category rather than per node is what makes the output
 * readable; it is also what makes the cap meaningful.
 */
export function generateSuggestions(graph: Pick<KnowledgeGraph, 'nodes' | 'edges'>): Suggestion[] {
  const nodes = graph.nodes ?? [];
  const edges = graph.edges ?? [];
  if (nodes.length === 0) return [];

  const ranked: RankedSuggestion[] = [];
  const push = (strength: number, suggestion: Suggestion): void => {
    ranked.push({ strength, suggestion });
  };

  // ── Circular dependencies ────────────────────────────────────────────────
  // Cycles make a codebase impossible to reason about incrementally: no module
  // in a cycle can be understood, tested or replaced on its own.
  const cycles = collectWarnings(nodes, 'circular_dependency');
  if (cycles.length > 0) {
    const involved = new Set<string>();
    for (const { node, warning } of cycles) {
      involved.add(node.id);
      for (const id of warning.related_node_ids ?? []) involved.add(id);
    }
    const examples = cycles.map(({ node }) => displayOf(node));
    push(cycles.length, {
      id: 'circular-dependencies',
      priority: 'high',
      title: 'Break the circular dependencies',
      detail: `${cycles.length} circular dependency warning${cycles.length === 1 ? '' : 's'} involving ${involved.size} node${involved.size === 1 ? '' : 's'}: ${sampleList(examples)}.`,
      action:
        'Pick the narrowest edge in each cycle and invert it — extract the shared type or interface into its own module, or move the back-reference behind a callback passed in by the caller.',
      impact: `${involved.size} node${involved.size === 1 ? '' : 's'} become independently testable and loadable once the cycle${cycles.length === 1 ? '' : 's'} are cut.`,
      nodeIds: [...involved].slice(0, 5),
    });
  }

  // ── God nodes / over-connected nodes ─────────────────────────────────────
  // A node everything talks to is a change amplifier: every edit ripples.
  const godWarnings = [
    ...collectWarnings(nodes, 'god_node'),
    ...collectWarnings(nodes, 'over_connected'),
  ];
  if (godWarnings.length > 0) {
    const byNode = new Map<string, SprangNode>();
    for (const { node } of godWarnings) byNode.set(node.id, node);
    const severity = highestSeverity(godWarnings.map((w) => w.warning));
    const heuristics = [...new Set(godWarnings.map(({ warning }) => warning.heuristic).filter((h): h is string => typeof h === 'string' && h.length > 0))];
    push(byNode.size, {
      id: 'god-nodes',
      priority: severity === 'high' ? 'high' : 'medium',
      title: 'Split the over-connected nodes',
      detail:
        `${byNode.size} node${byNode.size === 1 ? '' : 's'} flagged as god or over-connected: ${sampleList([...byNode.values()].map(displayOf))}.` +
        (heuristics.length > 0 ? ` Triggered by ${sampleList(heuristics, 2)}.` : ''),
      action:
        'Group the responsibilities of each flagged node and extract the largest coherent group into its own module, updating the importers in the same change.',
      impact:
        'Reduces the blast radius of routine edits: fewer files are pulled into each change once the hub is split.',
      nodeIds: [...byNode.keys()].slice(0, 5),
    });
  }

  // ── Layer violations ─────────────────────────────────────────────────────
  // An architecture that is documented but not enforced decays silently.
  const layerViolations = collectWarnings(nodes, 'layer_violation');
  if (layerViolations.length > 0) {
    const byNode = new Map<string, SprangNode>();
    for (const { node } of layerViolations) byNode.set(node.id, node);
    push(layerViolations.length, {
      id: 'layer-violations',
      priority: 'high',
      title: 'Fix the layering violations',
      detail: `${layerViolations.length} layer violation${layerViolations.length === 1 ? '' : 's'} detected across ${byNode.size} node${byNode.size === 1 ? '' : 's'}: ${sampleList([...byNode.values()].map(displayOf))}.`,
      action:
        'Route each offending dependency through the layer it skipped, or move the shared code down into a layer both sides may legally reach.',
      impact:
        'Restores the layering the rest of the codebase already assumes, so lower layers can be changed without auditing the upper ones.',
      nodeIds: [...byNode.keys()].slice(0, 5),
    });
  }

  // ── Change traps ─────────────────────────────────────────────────────────
  // A file that was reverted or hot-fixed before is the strongest empirical
  // predictor available: this is history, not inference.
  const trapNodes = nodes.filter((node) => {
    const behavioral = behavioralOf(node);
    const traps = numField(behavioral, 'trap_count') ?? 0;
    const reverted = (node.risk_factors ?? []).includes('previously_reverted');
    return traps > 0 || reverted;
  });
  if (trapNodes.length > 0) {
    const totalTraps = trapNodes.reduce(
      (sum, node) => sum + (numField(behavioralOf(node), 'trap_count') ?? 0),
      0,
    );
    const trapsPhrase =
      totalTraps > 0
        ? `${totalTraps} recorded revert or urgent fix${totalTraps === 1 ? '' : 'es'} across ${trapNodes.length} file${trapNodes.length === 1 ? '' : 's'}`
        : `${trapNodes.length} file${trapNodes.length === 1 ? '' : 's'} flagged as previously reverted`;
    push(trapNodes.length, {
      id: 'change-traps',
      priority: 'critical',
      title: 'Read the change history before editing these files',
      detail: `${trapsPhrase}: ${sampleList(trapNodes.map(displayOf))}. A previous change here was undone or corrected in a hurry.`,
      action:
        'Run `sprang_traps` on these files and read the reverting commits before making the next change; add a regression test for the failure mode that caused each revert.',
      impact:
        'Prevents repeating a mistake the repository has already paid for once.',
      nodeIds: trapNodes.slice(0, 5).map((n) => n.id),
    });
  }

  // ── Bus factor of one on high-risk files ─────────────────────────────────
  // Only reported where risk is already high: single ownership of a trivial
  // file is not a problem worth anyone's attention.
  const busFactorNodes = nodes.filter((node) => {
    const behavioral = behavioralOf(node);
    if (numField(behavioral, 'bus_factor') !== 1) return false;
    return (node.risk_score ?? 0) >= 0.6;
  });
  if (busFactorNodes.length > 0) {
    // The main developer is only named when the graph actually recorded one —
    // guessing an owner is exactly the kind of fabrication that destroys trust.
    const named = busFactorNodes
      .map((node) => strField(behavioralOf(node), 'main_developer'))
      .filter((d): d is string => d !== undefined);
    const ownerPhrase =
      named.length > 0 ? ` Recorded main developer${named.length === 1 ? '' : 's'}: ${sampleList([...new Set(named)], 2)}.` : '';
    push(busFactorNodes.length, {
      id: 'bus-factor-one',
      priority: 'high',
      title: 'Spread knowledge of the single-owner high-risk files',
      detail: `${busFactorNodes.length} high-risk file${busFactorNodes.length === 1 ? '' : 's'} (risk >= 0.6) have a bus factor of 1: ${sampleList(busFactorNodes.map(displayOf))}.${ownerPhrase}`,
      action:
        'Pair or walk a second engineer through each file, and record what you learn with `sprang_annotate` so the context survives the next handover.',
      impact:
        'Removes the single point of failure on files that are already the riskiest to change.',
      nodeIds: busFactorNodes.slice(0, 5).map((n) => n.id),
    });
  }

  // ── Hotspots ─────────────────────────────────────────────────────────────
  // Complexity that is also churning — Tornhill's hotspot. Complexity alone is
  // harmless if nobody touches it.
  const hotspotNodes = nodes.filter((node) => (numField(behavioralOf(node), 'hotspot_score') ?? 0) >= 0.5);
  if (hotspotNodes.length > 0) {
    const sorted = [...hotspotNodes].sort(
      (a, b) =>
        (numField(behavioralOf(b), 'hotspot_score') ?? 0) - (numField(behavioralOf(a), 'hotspot_score') ?? 0),
    );
    const top = sorted[0];
    const topScore = top === undefined ? 0 : round2(numField(behavioralOf(top), 'hotspot_score') ?? 0);
    const revisions = top === undefined ? undefined : numField(behavioralOf(top), 'revisions');
    push(hotspotNodes.length, {
      id: 'hotspots',
      priority: 'high',
      title: 'Refactor the hotspots first',
      detail:
        `${hotspotNodes.length} file${hotspotNodes.length === 1 ? '' : 's'} score >= 0.5 on complexity-times-churn: ${sampleList(sorted.map(displayOf))}.` +
        (top !== undefined
          ? ` Highest is ${displayOf(top)} at ${topScore}${revisions !== undefined ? ` over ${revisions} revisions` : ''}.`
          : ''),
      action:
        'Start refactoring here rather than with the most complex file overall: split the largest function in each hotspot and cover it with tests before changing behaviour.',
      impact:
        'Refactoring effort lands where changes actually happen, so it pays back on the next edit instead of never.',
      nodeIds: sorted.slice(0, 5).map((n) => n.id),
    });
  }

  // ── Untested high-risk files ─────────────────────────────────────────────
  const untestedNodes = nodes.filter(
    (node) => (node.risk_factors ?? []).includes('no_test_coverage') && (node.risk_score ?? 0) >= 0.6,
  );
  if (untestedNodes.length > 0) {
    const sorted = [...untestedNodes].sort((a, b) => (b.risk_score ?? 0) - (a.risk_score ?? 0));
    const top = sorted[0];
    push(untestedNodes.length, {
      id: 'untested-high-risk',
      priority: 'high',
      title: 'Add tests to the high-risk untested files',
      detail:
        `${untestedNodes.length} file${untestedNodes.length === 1 ? '' : 's'} have risk >= 0.6 and no detected test coverage: ${sampleList(sorted.map(displayOf))}.` +
        (top !== undefined ? ` Highest risk is ${displayOf(top)} at ${round2(top.risk_score ?? 0)}.` : ''),
      action:
        'Write characterisation tests for the current behaviour of these files before the next change to them, highest risk score first.',
      impact:
        'Turns the riskiest edits in the codebase into ones a test suite can catch.',
      nodeIds: sorted.slice(0, 5).map((n) => n.id),
    });
  }

  // ── Dead code ────────────────────────────────────────────────────────────
  const dead = detectDeadCode({ nodes, edges });
  if (dead.length > 0) {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const highConfidence = dead.filter((d) => d.confidence === 'high');
    // "Removes ~N lines" is only honest when every finding reported a size.
    const sizes = dead.map((d) => numField(byId.get(d.nodeId)?.metadata, 'sizeLines'));
    const allSized = sizes.every((s): s is number => s !== undefined);
    const totalLines = allSized ? sizes.reduce((a, b) => a + b, 0) : undefined;
    push(dead.length, {
      id: 'dead-code',
      priority: 'medium',
      title: 'Remove the unreferenced symbols',
      detail: `${dead.length} function${dead.length === 1 ? '' : 's'} or class${dead.length === 1 ? '' : 'es'} have no incoming call edges (${highConfidence.length} at high confidence): ${sampleList(dead.map((d) => d.name))}. Exported symbols, framework hooks and test files are already excluded.`,
      action:
        'Confirm each symbol is unreachable — grep for dynamic or string-based references first — then delete it in a single reviewable commit.',
      impact:
        totalLines !== undefined
          ? `Removes ~${totalLines} lines of code that nothing calls.`
          : 'Shrinks the surface every reader and every refactor has to consider.',
      nodeIds: [...highConfidence, ...dead].slice(0, 5).map((d) => d.nodeId),
    });
  }

  // ── Security hints ───────────────────────────────────────────────────────
  // These come from a regex scanner with no dataflow, no types and no
  // reachability. They are hints to triage, and the wording says so: calling an
  // unverified regex match a "vulnerability" is how a tool loses its audience.
  const securityNodes: { node: SprangNode; warnings: SecurityWarning[] }[] = [];
  for (const node of nodes) {
    const high = (node.security_warnings ?? []).filter(
      (w): w is SecurityWarning => w?.severity === 'high',
    );
    if (high.length > 0) securityNodes.push({ node, warnings: high });
  }
  if (securityNodes.length > 0) {
    const total = securityNodes.reduce((sum, entry) => sum + entry.warnings.length, 0);
    const categories = [...new Set(securityNodes.flatMap((e) => e.warnings.map((w) => w.category)))];
    push(total, {
      id: 'security-hints',
      priority: 'high',
      title: 'Triage the high-severity security hints',
      detail: `${total} high-severity security hint${total === 1 ? '' : 's'} across ${securityNodes.length} file${securityNodes.length === 1 ? '' : 's'} (${sampleList(categories, 3)}). These are unverified regex matches with no dataflow or reachability analysis behind them, so some will be fixtures, comments or test data.`,
      action:
        'Read each match in context and mark it confirmed or dismissed; run a real analyser such as Semgrep or CodeQL over these files to decide the ones you cannot judge by eye.',
      impact:
        'Separates the unverified matches worth acting on from the noise, before anyone spends time on a false positive.',
      nodeIds: securityNodes.slice(0, 5).map((e) => e.node.id),
    });
  }

  // Sort by priority, then by how much evidence backs each card, then by id so
  // the order is stable across runs.
  ranked.sort((a, b) => {
    const byPriority =
      PRIORITY_RANK[a.suggestion.priority] - PRIORITY_RANK[b.suggestion.priority];
    if (byPriority !== 0) return byPriority;
    if (b.strength !== a.strength) return b.strength - a.strength;
    return a.suggestion.id.localeCompare(b.suggestion.id);
  });

  return ranked.slice(0, MAX_SUGGESTIONS).map((r) => r.suggestion);
}
