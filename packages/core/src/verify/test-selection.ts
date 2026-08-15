import type { KnowledgeGraph, SprangNode } from '../schema/types.js';

/**
 * Test selection — "which tests actually exercise this change?"
 *
 * An agent that has just edited a file has two useful questions and one
 * dangerous assumption. The useful questions are "what should I run?" and "how
 * long will it take?". The dangerous assumption is that *some* test covers the
 * change. Very often nothing does, and the agent reports success because the
 * suite it happened to run was green — a suite that never touched the edited
 * code.
 *
 * This module answers the first question by walking the knowledge graph
 * backwards (who depends on me?) and answers the dangerous assumption head-on
 * via {@link TestSelection.unverifiable}.
 *
 * Everything here is *reachability*, not coverage. A test that imports a module
 * is evidence the module can be reached, not evidence its behaviour is
 * asserted. See `coverage.ts` for the same caveat stated about execution.
 */

/** One test file selected for a change, with why it was picked. */
export interface SelectedTest {
  /** Repo-relative path of the test file. */
  path: string;
  /** Human-readable explanation of the dependency chain that reached it. */
  reason: string;
  /** Hops from the changed file to this test over reverse import/call edges. */
  distance: number;
}

/** The full answer to "what do I run after this change?". */
export interface TestSelection {
  /** The input, normalised, echoed back so callers can log a single object. */
  changedFiles: string[];
  /** Selected tests, nearest first, then alphabetical for determinism. */
  tests: SelectedTest[];
  /** A ready-to-paste command, when the runner can be inferred. */
  command: string | null;
  /** True when no test reaches the change at all — the important case. */
  unverifiable: boolean;
  /** Plain-language guidance, including what to do when unverifiable. */
  guidance: string;
}

export interface SelectTestsOptions {
  /** Maximum reverse hops to search. Default 3. */
  maxDistance?: number;
  /** Force a runner instead of inferring one (e.g. `'vitest'`). */
  runner?: string;
}

/** Default reverse-reachability depth. Beyond ~3 hops the signal is noise. */
const DEFAULT_MAX_DISTANCE = 3;

/** Edge types that mean "the source depends on the target at runtime". */
const DEPENDENCY_EDGES: ReadonlySet<string> = new Set(['imports', 'calls']);

/**
 * Normalise a path for matching: backslashes to forward slashes, and drop a
 * leading `./`. Graphs built on Windows and on CI must compare equal.
 */
function normalisePath(path: string): string {
  const forward = path.replace(/\\/g, '/');
  return forward.startsWith('./') ? forward.slice(2) : forward;
}

/**
 * Is this path a test file?
 *
 * Deliberately broad and purely lexical: it covers the JS/TS, Python, Go, Java
 * and Ruby conventions in one pass. Being lexical means it can misfire on a
 * source file called `testing-utils.ts` — the cost of a false positive here is
 * one extra file in a command, which is far cheaper than missing the only test
 * that covers a change.
 */
export function isTestPath(path: string): boolean {
  const p = normalisePath(path);
  const base = p.slice(p.lastIndexOf('/') + 1);

  if (p.includes('.test.') || p.includes('.spec.')) return true;
  if (p.includes('_test.')) return true;
  if (base.startsWith('test_')) return true;
  if (p.includes('/tests/') || p.startsWith('tests/')) return true;
  if (p.includes('/test/') || p.startsWith('test/')) return true;
  if (p.includes('__tests__')) return true;
  if (base.endsWith('Test.java')) return true;
  if (/_spec\.rb$/.test(base)) return true;
  return false;
}

/** The file a node lives in, or null for nodes with no location at all. */
function nodeFile(node: SprangNode): string | null {
  const raw = node.filePath ?? node.location?.file;
  if (raw !== undefined && raw !== '') return normalisePath(raw);
  // `file:<path>` and `function:<path>:<name>` ids carry the path themselves.
  if (node.id.startsWith('file:')) return normalisePath(node.id.slice(5));
  if (node.id.startsWith('function:')) {
    const rest = node.id.slice('function:'.length);
    const lastColon = rest.lastIndexOf(':');
    if (lastColon > 0) return normalisePath(rest.slice(0, lastColon));
  }
  return null;
}

interface GraphIndex {
  byId: Map<string, SprangNode>;
  /** node id -> ids of nodes that depend on it (reverse imports/calls). */
  dependents: Map<string, string[]>;
  /** file path -> ids of every node located in that file. */
  nodesByFile: Map<string, string[]>;
  /** node id -> its file path. */
  fileOf: Map<string, string>;
  /** file path -> number of distinct files importing/calling into it. */
  inDegreeByFile: Map<string, number>;
}

function indexGraph(graph: KnowledgeGraph): GraphIndex {
  const byId = new Map<string, SprangNode>();
  const nodesByFile = new Map<string, string[]>();
  const fileOf = new Map<string, string>();

  for (const node of graph.nodes) {
    byId.set(node.id, node);
    const file = nodeFile(node);
    if (file === null) continue;
    fileOf.set(node.id, file);
    const bucket = nodesByFile.get(file);
    if (bucket === undefined) nodesByFile.set(file, [node.id]);
    else bucket.push(node.id);
  }

  const dependents = new Map<string, string[]>();
  const inDegreeFiles = new Map<string, Set<string>>();

  for (const edge of graph.edges) {
    if (!DEPENDENCY_EDGES.has(edge.type)) continue;
    const bucket = dependents.get(edge.target);
    if (bucket === undefined) dependents.set(edge.target, [edge.source]);
    else bucket.push(edge.source);

    const targetFile = fileOf.get(edge.target);
    const sourceFile = fileOf.get(edge.source);
    if (targetFile !== undefined && sourceFile !== undefined && targetFile !== sourceFile) {
      const set = inDegreeFiles.get(targetFile);
      if (set === undefined) inDegreeFiles.set(targetFile, new Set([sourceFile]));
      else set.add(sourceFile);
    }
  }

  const inDegreeByFile = new Map<string, number>();
  for (const [file, set] of inDegreeFiles) inDegreeByFile.set(file, set.size);

  return { byId, dependents, nodesByFile, fileOf, inDegreeByFile };
}

/**
 * `contains` edges let a change to a file reach tests that only depend on one
 * of its functions, and vice versa. Expanding the frontier by containment
 * within the same file costs no hops — it is the same code.
 */
function seedIds(index: GraphIndex, file: string): string[] {
  return index.nodesByFile.get(file) ?? [];
}

/**
 * Which test files can reach `changedFiles`?
 *
 * BFS over *incoming* `imports`/`calls` edges: the natural direction of "who
 * would break if I change this". Distance is the number of hops; a test that
 * imports the changed file directly is distance 1.
 */
export function selectTests(
  graph: KnowledgeGraph,
  changedFiles: string[],
  opts: SelectTestsOptions = {},
): TestSelection {
  const maxDistance = opts.maxDistance ?? DEFAULT_MAX_DISTANCE;
  const changed = changedFiles.map(normalisePath);
  const index = indexGraph(graph);

  /** test file path -> smallest distance found, plus the chain that found it. */
  const found = new Map<string, { distance: number; from: string; via: string }>();

  for (const file of changed) {
    const seeds = seedIds(index, file);
    // A changed file that is itself a test is trivially its own test.
    if (isTestPath(file)) {
      const existing = found.get(file);
      if (existing === undefined || existing.distance > 0) {
        found.set(file, { distance: 0, from: file, via: file });
      }
    }
    if (seeds.length === 0) continue;

    const seen = new Set<string>(seeds);
    let frontier: string[] = seeds;

    for (let distance = 1; distance <= maxDistance && frontier.length > 0; distance++) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const dependentId of index.dependents.get(id) ?? []) {
          if (seen.has(dependentId)) continue;
          seen.add(dependentId);
          next.push(dependentId);

          const depFile = index.fileOf.get(dependentId);
          if (depFile === undefined || depFile === file) continue;
          if (!isTestPath(depFile)) continue;
          const existing = found.get(depFile);
          if (existing === undefined || existing.distance > distance) {
            found.set(depFile, { distance, from: file, via: dependentId });
          }
        }
      }
      frontier = next;
    }
  }

  const tests: SelectedTest[] = [...found.entries()]
    .map(([path, info]) => ({
      path,
      distance: info.distance,
      reason:
        info.distance === 0
          ? `${path} is itself a changed test file`
          : info.distance === 1
            ? `directly depends on ${info.from}`
            : `depends on ${info.from} through ${info.distance} hops (via ${info.via})`,
    }))
    .sort((a, b) => (a.distance - b.distance) || a.path.localeCompare(b.path));

  const runner = opts.runner ?? inferRunner(graph);
  const command = buildCommand(runner, tests.map((t) => t.path));
  const unverifiable = tests.length === 0 && changed.length > 0;

  return {
    changedFiles: changed,
    tests,
    command,
    unverifiable,
    guidance: buildGuidance({ changed, tests, runner, command, unverifiable, index }),
  };
}

/**
 * Guess the test runner from the files present in the graph.
 *
 * Returns null whenever the evidence is ambiguous or absent. A wrong command is
 * strictly worse than no command: the agent runs it, it fails on an unrelated
 * error, and the agent now debugs its own tooling instead of its change.
 */
export function inferRunner(graph: KnowledgeGraph): string | null {
  const files = new Set<string>();
  for (const node of graph.nodes) {
    const file = nodeFile(node);
    if (file !== null) files.add(file);
  }
  const has = (predicate: (f: string) => boolean): boolean => {
    for (const f of files) if (predicate(f)) return true;
    return false;
  };
  const base = (f: string): string => f.slice(f.lastIndexOf('/') + 1);

  if (has((f) => base(f).startsWith('vitest.config'))) return 'vitest';
  if (has((f) => base(f).startsWith('jest.config'))) return 'jest';
  if (has((f) => base(f) === 'pytest.ini' || base(f) === 'conftest.py')) return 'pytest';
  if (has((f) => base(f) === 'go.mod')) return 'go test';
  if (has((f) => base(f) === 'Cargo.toml')) return 'cargo test';
  // package.json alone is weak evidence, so it is checked last: a JS project
  // with no config file still most likely runs vitest in this ecosystem.
  if (has((f) => base(f) === 'package.json')) return 'vitest';
  return null;
}

/**
 * Build the runner-specific invocation.
 *
 * Null when the runner is unknown or nothing was selected — see
 * {@link inferRunner} for why silence beats a guess.
 */
function buildCommand(runner: string | null, paths: string[]): string | null {
  if (runner === null || paths.length === 0) return null;
  const joined = paths.join(' ');
  switch (runner) {
    case 'vitest':
      return `pnpm vitest run ${joined}`;
    case 'jest':
      return `pnpm jest ${joined}`;
    case 'pytest':
      return `pytest ${joined}`;
    case 'go test':
      return `go test ${[...new Set(paths.map(dirOf))].join(' ')}`;
    case 'cargo test':
      // Cargo selects by test target name, not path; the whole suite is the
      // only honest invocation.
      return 'cargo test';
    default:
      return null;
  }
}

function dirOf(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx === -1 ? './' : `./${path.slice(0, idx)}`;
}

interface GuidanceInput {
  changed: string[];
  tests: SelectedTest[];
  runner: string | null;
  command: string | null;
  unverifiable: boolean;
  index: GraphIndex;
}

/**
 * The nearest place a new test could be attached: the most-depended-on file
 * that (transitively, within 3 hops) sits above the change. If nothing depends
 * on the change, the change itself is the seam.
 */
function nearestSeam(index: GraphIndex, changed: string[]): string | null {
  let best: { file: string; degree: number } | null = null;
  for (const file of changed) {
    for (const id of seedIds(index, file)) {
      for (const dependentId of index.dependents.get(id) ?? []) {
        const depFile = index.fileOf.get(dependentId);
        if (depFile === undefined || depFile === file) continue;
        const degree = index.inDegreeByFile.get(depFile) ?? 0;
        if (best === null || degree > best.degree || (degree === best.degree && depFile < best.file)) {
          best = { file: depFile, degree };
        }
      }
    }
  }
  return best?.file ?? null;
}

function buildGuidance(input: GuidanceInput): string {
  const { changed, tests, runner, command, unverifiable, index } = input;

  if (changed.length === 0) {
    return 'No changed files were supplied, so no tests were selected.';
  }

  if (unverifiable) {
    const seam = nearestSeam(index, changed);
    const list = changed.join(', ');
    const seamLine =
      seam === null
        ? `Nothing in the graph depends on ${list} either, so a new test must call into it directly.`
        : `The nearest seam is ${seam}, the most-depended-on caller of the change — a new test there would reach it.`;
    return (
      `This change cannot be verified by the existing test suite: no test file reaches ${list} ` +
      `over import or call edges. Running the suite will prove nothing about it. ${seamLine}`
    );
  }

  const runnerLine =
    command !== null
      ? `Run: ${command}`
      : runner === null
        ? 'The test runner could not be inferred from the graph, so no command is offered — run these files with whatever the project uses.'
        : `Runner ${runner} was inferred but no command could be built.`;

  return (
    `${tests.length} test file${tests.length === 1 ? '' : 's'} reach the change ` +
    `(nearest at ${tests[0]?.distance ?? 0} hop${tests[0]?.distance === 1 ? '' : 's'}). ` +
    `Reachability means these tests can execute the changed code; it does not mean they assert anything about it. ${runnerLine}`
  );
}
