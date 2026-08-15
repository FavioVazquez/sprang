/**
 * Declarative architecture rules — dependency constraints a team writes down
 * once and CI enforces on every commit.
 *
 * ## Why this exists
 *
 * Sprang already *reports* layer violations. Reporting is advice: it shows up
 * in a health score, someone reads it, and the violation survives to the next
 * release anyway. A rule is different in kind. It is a contract the team
 * agreed to, checked mechanically, that fails a build when broken. The
 * difference between "core imports the dashboard, that seems wrong" and
 * "core must never import the dashboard, and this commit does" is the
 * difference between an observer and a guard.
 *
 * The design goals, in priority order:
 *
 * 1. **No silent passes.** A rule whose `from` selector matches nothing is
 *    almost always a typo (a renamed directory, a `packges/` slip). Passing
 *    quietly is the single worst outcome, because the team believes it is
 *    protected when it is not. Such rules are reported in
 *    {@link RuleCheckResult.unmatchedRules}.
 * 2. **No new dependencies.** The glob matcher and the rules-file parser are
 *    written here by hand. A rule file is a security-relevant input; it should
 *    not pull in a YAML parser.
 * 3. **Literal means literal.** Glob conversion escapes every regex
 *    metacharacter, so a path containing `.` or `+` (e.g. `vendor/lib.v1+2/`)
 *    matches only itself and never acts as a wildcard.
 * 4. **Deterministic.** Same graph plus same rules always yields the same
 *    violations in the same order — rules in declaration order, edges in graph
 *    order. CI diffs are meaningless otherwise.
 */

import type { KnowledgeGraph, SprangNode } from '../schema/types.js';

// ─── Types ────────────────────────────────────────────────────────────

export interface ArchitectureRule {
  name: string;
  /** Glob-ish matcher for the source side, e.g. "packages/core/**" or "layer:api". */
  from: string;
  /** What it must not (or must only) depend on. */
  to: string;
  type: 'forbidden' | 'allowed-only';
  severity?: 'error' | 'warning';
  comment?: string;
}

export interface RuleViolation {
  rule: string;
  severity: 'error' | 'warning';
  /** Node id of the depending (source) node. */
  from: string;
  /** Node id of the depended-upon (target) node. */
  to: string;
  edgeType: string;
  comment?: string;
}

export interface RuleCheckResult {
  violations: RuleViolation[];
  errorCount: number;
  warningCount: number;
  rulesEvaluated: number;
  /**
   * Names of rules whose `from` selector matched no node in the graph.
   * These are reported separately rather than counted as passes: a rule that
   * matches nothing enforces nothing.
   */
  unmatchedRules: string[];
}

// ─── Selector matching ────────────────────────────────────────────────

/** Characters that must be escaped so glob literals stay literal. */
const REGEX_META = /[.*+?^${}()|[\]\\]/g;

function escapeRegex(literal: string): string {
  return literal.replace(REGEX_META, '\\$&');
}

/**
 * Convert a glob to an anchored regular expression.
 *
 * Semantics (deliberately the smallest set that is useful, and the one people
 * already expect from `.gitignore`-style tooling):
 *
 * - `*`      matches any run of characters **within one path segment**
 *            (never crosses `/`).
 * - `**`     matches across segments. `a/**` matches `a` itself and anything
 *            below it; `a/**\/b` matches `a/b` as well as `a/x/y/b`.
 * - `?`      matches exactly one non-`/` character.
 * - Anything else is a literal, with regex metacharacters escaped — so
 *   `lib.v1+2/x.ts` matches that exact path and nothing else.
 *
 * The result is anchored at both ends: a selector describes a whole path.
 */
function globToRegExp(glob: string): RegExp {
  let source = '';
  let i = 0;

  while (i < glob.length) {
    const char = glob[i] as string;

    if (char === '*') {
      // Consume the whole run of asterisks so `***` degrades to `**`.
      let end = i;
      while (glob[end] === '*') end += 1;
      const isDoubleStar = end - i >= 2;

      if (!isDoubleStar) {
        source += '[^/]*';
        i = end;
        continue;
      }

      const precededBySlash = i > 0 && glob[i - 1] === '/';
      const followedBySlash = glob[end] === '/';

      if (precededBySlash && followedBySlash) {
        // ".../**/..." — zero or more intermediate segments.
        source = source.slice(0, -1) + '(?:/.*)?/';
        i = end + 1;
      } else if (precededBySlash && end === glob.length) {
        // Trailing ".../**" — the prefix itself, or anything under it.
        source = source.slice(0, -1) + '(?:/.*)?';
        i = end;
      } else {
        source += '.*';
        i = end;
      }
      continue;
    }

    if (char === '?') {
      source += '[^/]';
      i += 1;
      continue;
    }

    source += escapeRegex(char);
    i += 1;
  }

  return new RegExp(`^${source}$`);
}

/** Small memo so a rule set checked against a large graph compiles each glob once. */
const globCache = new Map<string, RegExp>();

function compileGlob(glob: string): RegExp {
  const cached = globCache.get(glob);
  if (cached) return cached;
  const compiled = globToRegExp(glob);
  globCache.set(glob, compiled);
  return compiled;
}

/** Path used for glob matching. Nodes without any location never match a glob. */
function nodePath(node: SprangNode): string | undefined {
  return node.filePath ?? node.location?.file;
}

/**
 * Does `node` fall on the given side of a rule?
 *
 * Two selector forms:
 * - `layer:<id>` — the node's own `layer` field equals `<id>`, or the graph's
 *   layer with that id lists the node. Both are checked because layer
 *   membership is recorded in either place depending on which pipeline stage
 *   produced the graph.
 * - anything else — a glob over the node's file path (see {@link globToRegExp}).
 *
 * A node with no location cannot match a path glob; it is simply not covered
 * by that rule rather than being an error.
 */
export function matchesSelector(selector: string, node: SprangNode, graph: KnowledgeGraph): boolean {
  const trimmed = selector.trim();
  if (trimmed.length === 0) return false;

  if (trimmed.startsWith('layer:')) {
    const layerId = trimmed.slice('layer:'.length).trim();
    if (layerId.length === 0) return false;
    if (node.layer === layerId) return true;
    const layer = graph.layers.find((candidate) => candidate.id === layerId);
    return layer ? layer.node_ids.includes(node.id) : false;
  }

  const path = nodePath(node);
  if (path === undefined) return false;
  return compileGlob(trimmed).test(path);
}

// ─── Checking ─────────────────────────────────────────────────────────

/**
 * Evaluate every rule against every dependency edge in the graph.
 *
 * `forbidden`: any edge from a `from` node to a `to` node is a violation.
 *
 * `allowed-only`: an edge out of a `from` node is a violation unless its
 * target matches `to` **or** matches `from`. Allowing the `from` group to
 * depend on itself is the pragmatic reading — "the API layer may only depend
 * on the domain layer" is never meant to forbid one API file importing
 * another — and saying so explicitly is better than making every user
 * discover it.
 *
 * Edges whose endpoints are not in the graph are skipped, not reported: a
 * dangling edge is a graph-integrity problem for the health check to raise,
 * and turning it into a rule violation would blame the wrong thing.
 */
export function checkRules(graph: KnowledgeGraph, rules: ArchitectureRule[]): RuleCheckResult {
  const violations: RuleViolation[] = [];
  const unmatchedRules: string[] = [];

  const byId = new Map<string, SprangNode>();
  for (const node of graph.nodes) byId.set(node.id, node);

  for (const rule of rules) {
    const severity = rule.severity ?? 'error';

    // Precompute side membership once per rule — O(nodes) instead of O(edges).
    const fromIds = new Set<string>();
    const toIds = new Set<string>();
    for (const node of graph.nodes) {
      if (matchesSelector(rule.from, node, graph)) fromIds.add(node.id);
      if (matchesSelector(rule.to, node, graph)) toIds.add(node.id);
    }

    if (fromIds.size === 0) {
      unmatchedRules.push(rule.name);
      continue;
    }

    const seen = new Set<string>();
    for (const edge of graph.edges) {
      if (!fromIds.has(edge.source)) continue;
      if (!byId.has(edge.target)) continue; // dangling edge — not this rule's problem
      if (edge.source === edge.target) continue; // self-edge is never a dependency violation

      const targetAllowed = toIds.has(edge.target) || fromIds.has(edge.target);
      const isViolation = rule.type === 'forbidden' ? toIds.has(edge.target) : !targetAllowed;
      if (!isViolation) continue;

      const key = `${edge.source}\u0000${edge.target}\u0000${edge.type}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const violation: RuleViolation = {
        rule: rule.name,
        severity,
        from: edge.source,
        to: edge.target,
        edgeType: edge.type,
      };
      if (rule.comment !== undefined) violation.comment = rule.comment;
      violations.push(violation);
    }
  }

  let errorCount = 0;
  let warningCount = 0;
  for (const violation of violations) {
    if (violation.severity === 'error') errorCount += 1;
    else warningCount += 1;
  }

  return {
    violations,
    errorCount,
    warningCount,
    rulesEvaluated: rules.length,
    unmatchedRules,
  };
}

// ─── Parsing ──────────────────────────────────────────────────────────

const DIRECTIVES: Record<string, { type: ArchitectureRule['type']; severity: 'error' | 'warning' }> = {
  forbid: { type: 'forbidden', severity: 'error' },
  'forbid-warn': { type: 'forbidden', severity: 'warning' },
  'allow-only': { type: 'allowed-only', severity: 'error' },
  'allow-only-warn': { type: 'allowed-only', severity: 'warning' },
};

/**
 * Parse a `.sprang/architecture-rules` file.
 *
 * The format is one rule per line and intentionally not YAML — a rules file
 * should be readable in a diff and parseable without a dependency:
 *
 * ```text
 * # comments start with '#', blank lines are ignored
 * forbid      packages/core/** -> packages/dashboard/**   # core must not depend on the UI
 * forbid-warn layer:api        -> layer:infrastructure    # same, but does not fail the build
 * allow-only  layer:api        -> layer:domain
 * ```
 *
 * - Directive is one of `forbid`, `forbid-warn`, `allow-only`,
 *   `allow-only-warn`. The `-warn` variants produce warnings instead of errors.
 * - The two selectors are separated by `->`.
 * - Everything after an unescaped `#` is a comment; if it sits on a rule line
 *   it becomes that rule's `comment`, which is echoed back on every violation
 *   so the failure message explains *why* the rule exists.
 * - Rule names are generated as `<directive> <from> -> <to>`, which is stable,
 *   unique enough to reference, and needs no extra syntax.
 *
 * Never throws. Malformed lines are reported in `errors` as
 * `line <n>: <reason>` and skipped, so one bad line does not discard the rest
 * of the file — a parser that gives up on the first error is a parser that
 * gets its rules file deleted.
 */
export function parseRulesFile(content: string): { rules: ArchitectureRule[]; errors: string[] } {
  const rules: ArchitectureRule[] = [];
  const errors: string[] = [];
  const seenNames = new Set<string>();

  const lines = content.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index] ?? '';
    const lineNumber = index + 1;

    const hashAt = raw.indexOf('#');
    const body = (hashAt === -1 ? raw : raw.slice(0, hashAt)).trim();
    const comment = hashAt === -1 ? undefined : raw.slice(hashAt + 1).trim();

    if (body.length === 0) continue; // blank line or whole-line comment

    const arrowCount = body.split('->').length - 1;
    if (arrowCount === 0) {
      errors.push(`line ${lineNumber}: missing '->' separator (expected "<directive> <from> -> <to>")`);
      continue;
    }
    if (arrowCount > 1) {
      errors.push(`line ${lineNumber}: more than one '->' separator`);
      continue;
    }

    const arrowAt = body.indexOf('->');
    const left = body.slice(0, arrowAt).trim();
    const to = body.slice(arrowAt + 2).trim();

    const spaceAt = left.search(/\s/);
    if (spaceAt === -1) {
      errors.push(`line ${lineNumber}: missing source selector after directive "${left}"`);
      continue;
    }

    const directive = left.slice(0, spaceAt).trim().toLowerCase();
    const from = left.slice(spaceAt + 1).trim();

    const spec = DIRECTIVES[directive];
    if (!spec) {
      errors.push(
        `line ${lineNumber}: unknown directive "${directive}" (expected one of ${Object.keys(DIRECTIVES).join(', ')})`,
      );
      continue;
    }
    if (from.length === 0) {
      errors.push(`line ${lineNumber}: empty source selector`);
      continue;
    }
    if (to.length === 0) {
      errors.push(`line ${lineNumber}: empty target selector`);
      continue;
    }
    if (/\s/.test(from) || /\s/.test(to)) {
      errors.push(`line ${lineNumber}: selectors may not contain whitespace ("${from}" -> "${to}")`);
      continue;
    }

    const name = `${directive} ${from} -> ${to}`;
    if (seenNames.has(name)) {
      errors.push(`line ${lineNumber}: duplicate rule "${name}"`);
      continue;
    }
    seenNames.add(name);

    const rule: ArchitectureRule = { name, from, to, type: spec.type, severity: spec.severity };
    if (comment !== undefined && comment.length > 0) rule.comment = comment;
    rules.push(rule);
  }

  return { rules, errors };
}

/**
 * A documented starter file. Every line is either a comment or a rule that
 * parses cleanly, so a user can copy it to `.sprang/architecture-rules`,
 * delete what does not apply, and be enforcing something in a minute.
 */
export const EXAMPLE_RULES_FILE = `# Sprang architecture rules
#
# One rule per line:
#
#   <directive>  <from-selector>  ->  <to-selector>   # optional comment
#
# Directives
#   forbid            <from> may never depend on <to>          (fails the build)
#   forbid-warn       same, reported as a warning
#   allow-only        <from> may depend only on <to> (and on itself)
#   allow-only-warn   same, reported as a warning
#
# Selectors
#   layer:<id>        every node in that architectural layer
#   <glob>            a file path glob:
#                       *   matches within one path segment
#                       **  matches across segments
#                       ?   matches one character
#                     everything else is literal, so a '.' is a real dot.
#
# The comment after '#' is echoed on every violation, so write the reason —
# a failure that explains itself is a failure that gets fixed instead of muted.
#
# A rule whose <from> selector matches no node is reported as "unmatched".
# That is a typo, not a pass.

# --- Keep the core independent of anything that renders ------------------
forbid packages/core/** -> packages/dashboard/**   # core is headless; the UI depends on it, never the reverse
forbid packages/core/** -> packages/cli/**         # the CLI is a shell around core, not a library for it

# --- Layering ------------------------------------------------------------
allow-only layer:api -> layer:domain               # controllers talk to the domain, never straight to storage
forbid layer:domain -> layer:infrastructure        # keep business rules free of database and network detail

# --- Test code stays in test code ---------------------------------------
forbid src/** -> tests/**                          # production code must not import fixtures

# --- Soft rules: surface them, do not block the build --------------------
forbid-warn packages/*/src/**/*.ts -> **/node_modules/**  # vendored imports should go through package exports
`;
