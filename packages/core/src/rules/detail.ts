/**
 * Progressive disclosure — return the smallest node shape that answers the
 * question, and let the caller ask for more.
 *
 * ## The token argument
 *
 * Every MCP tool in Sprang currently returns everything it knows about a node:
 * summaries, risk factors, full structural-warning prose, behavioural history,
 * security findings, decision context. For a single lookup that is fine. For a
 * query that returns forty nodes it is how a context window fills with
 * material the agent never needed.
 *
 * The cost is not only money. Model accuracy degrades as context grows *well
 * inside* the nominal limit: retrieval of a fact placed in the middle of a
 * long prompt falls off sharply relative to the same fact in a short one, and
 * every irrelevant token is another distractor competing with the relevant
 * ones. Returning less is therefore not merely cheaper — it measurably
 * improves the answer. That is the whole justification for this module.
 *
 * The workflow it enables: list at `ids` or `summary`, let the agent pick, then
 * fetch that one node at `full`. Two round trips at a few hundred tokens beat
 * one round trip at twenty thousand.
 *
 * {@link estimateSavings} exists so a caller can show the trade rather than
 * assert it — "40 nodes: 61,240 chars full, 4,110 at summary (7%)".
 */

import type { SprangNode, StructuralWarning } from '../schema/types.js';

/**
 * How much of a node to reveal.
 *
 * - `ids`      — `{ id }` only. For "which nodes are involved?" answers, and
 *                for handing the agent a menu it can drill into.
 * - `summary`  — identity, one-line purpose and risk. The default: enough to
 *                decide whether a node is worth reading.
 * - `skeleton` — summary plus the *shape* of the problems (warning categories
 *                and severities, behavioural counters, contained symbols) but
 *                not their prose.
 * - `full`     — the node exactly as stored.
 */
export type DetailLevel = 'ids' | 'summary' | 'skeleton' | 'full';

/**
 * Default for tools that return lists.
 *
 * `summary`, not `full`: the default should be the level that is right for the
 * common case, because defaults are what actually get used.
 */
export const DEFAULT_DETAIL: DetailLevel = 'summary';

/** Ordered cheapest → most expensive. Useful for callers offering an escalation path. */
export const DETAIL_LEVELS: readonly DetailLevel[] = ['ids', 'summary', 'skeleton', 'full'] as const;

// ─── Projected shapes ─────────────────────────────────────────────────

interface IdProjection {
  id: string;
}

interface SummaryProjection extends IdProjection {
  type?: string;
  label?: string;
  path?: string;
  summary?: string;
  risk_score?: number;
  risk_factors?: string[];
}

/** Category and severity only — the shape of the problem, not the essay about it. */
interface WarningOutline {
  category: StructuralWarning['category'];
  severity: StructuralWarning['severity'];
}

/** The four behavioural signals that actually change a decision. */
interface BehavioralOutline {
  revisions?: number;
  bug_fixes?: number;
  bus_factor?: number;
  hotspot_score?: number;
}

interface SkeletonProjection extends SummaryProjection {
  structural_warnings?: WarningOutline[];
  behavioral?: BehavioralOutline;
  symbols?: string[];
}

// ─── Helpers ──────────────────────────────────────────────────────────

/**
 * Assign only when the value is present.
 *
 * Absent fields are omitted rather than emitted as `null`. A `null` costs
 * tokens and, worse, reads as an assertion ("this node has no summary")
 * where absence is merely absence.
 */
function put<T extends object, K extends keyof T>(target: T, key: K, value: T[K] | undefined): void {
  if (value !== undefined) target[key] = value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Behavioural history lives in free-form metadata; read it defensively. */
function projectBehavioral(metadata: Record<string, unknown> | undefined): BehavioralOutline | undefined {
  if (!metadata) return undefined;
  const behavioral = metadata['behavioral'];
  if (!isRecord(behavioral)) return undefined;

  const outline: BehavioralOutline = {};
  put(outline, 'revisions', numberOrUndefined(behavioral['revisions']));
  put(outline, 'bug_fixes', numberOrUndefined(behavioral['bug_fixes']));
  put(outline, 'bus_factor', numberOrUndefined(behavioral['bus_factor']));
  put(outline, 'hotspot_score', numberOrUndefined(behavioral['hotspot_score']));

  return Object.keys(outline).length > 0 ? outline : undefined;
}

/**
 * Names of symbols contained by this node, if metadata carries them.
 *
 * Accepts the three shapes the pipeline has produced over time: a `symbols`
 * array, and `functions` / `classes` arrays — each holding either plain
 * strings or objects with a `name`. Order is preserved and duplicates are
 * dropped, so output is deterministic.
 */
function projectSymbols(metadata: Record<string, unknown> | undefined): string[] | undefined {
  if (!metadata) return undefined;

  const names: string[] = [];
  const seen = new Set<string>();

  for (const key of ['symbols', 'functions', 'classes'] as const) {
    const entries = metadata[key];
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      let name: string | undefined;
      if (typeof entry === 'string') name = entry;
      else if (isRecord(entry) && typeof entry['name'] === 'string') name = entry['name'];
      if (name === undefined || name.length === 0 || seen.has(name)) continue;
      seen.add(name);
      names.push(name);
    }
  }

  return names.length > 0 ? names : undefined;
}

/** Best available path for a node; `undefined` for nodes with no location at all. */
function nodePath(node: SprangNode): string | undefined {
  return node.filePath ?? node.location?.file;
}

function projectSummary(node: SprangNode): SummaryProjection {
  const out: SummaryProjection = { id: node.id };
  put(out, 'type', node.type);
  put(out, 'label', node.label);
  put(out, 'path', nodePath(node));
  put(out, 'summary', node.summary);
  put(out, 'risk_score', node.risk_score);
  put(out, 'risk_factors', node.risk_factors ? [...node.risk_factors] : undefined);
  return out;
}

// ─── Public API ───────────────────────────────────────────────────────

/**
 * Reduce a node to the requested level of detail.
 *
 * Pure and deterministic: the same node and level always produce the same
 * object, with keys in a fixed order (so serialised output is diffable). At
 * `full` the node is returned by reference and unchanged — callers that want
 * everything should pay nothing for the privilege.
 */
export function projectNode(node: SprangNode, level: DetailLevel): unknown {
  switch (level) {
    case 'ids': {
      const out: IdProjection = { id: node.id };
      return out;
    }

    case 'summary':
      return projectSummary(node);

    case 'skeleton': {
      const out: SkeletonProjection = projectSummary(node);
      if (node.structural_warnings && node.structural_warnings.length > 0) {
        out.structural_warnings = node.structural_warnings.map((warning) => ({
          category: warning.category,
          severity: warning.severity,
        }));
      }
      put(out, 'behavioral', projectBehavioral(node.metadata));
      put(out, 'symbols', projectSymbols(node.metadata));
      return out;
    }

    case 'full':
    default:
      return node;
  }
}

/** {@link projectNode} over a list, preserving order. */
export function projectNodes(nodes: SprangNode[], level: DetailLevel): unknown[] {
  return nodes.map((node) => projectNode(node, level));
}

/**
 * Measure what a detail level actually saves, in serialised characters.
 *
 * Characters, not tokens: tokenisation is model-specific, and a character
 * count is exact, dependency-free and monotonically related to token count.
 * Divide by ~4 for a rough English/code token estimate.
 *
 * `ratio` is projected / full, so lower is better; it is `1` for `full` and
 * for an empty input (nothing saved, nothing lost — never `NaN`).
 */
export function estimateSavings(
  nodes: SprangNode[],
  level: DetailLevel,
): { fullChars: number; projectedChars: number; ratio: number } {
  const fullChars = JSON.stringify(nodes).length;
  const projectedChars = JSON.stringify(projectNodes(nodes, level)).length;
  const ratio = fullChars === 0 ? 1 : projectedChars / fullChars;
  return { fullChars, projectedChars, ratio };
}
