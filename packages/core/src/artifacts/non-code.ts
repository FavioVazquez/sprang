/**
 * First-class graph nodes for the non-code files a repository actually runs on.
 *
 * ## Why this exists
 *
 * A code graph answers "what calls what". It cannot answer any of the questions
 * that make a new engineer — or an agent — lose an afternoon:
 *
 * - *"How does this thing get built and deployed?"* → the CI workflow and its
 *   job dependency order.
 * - *"What does this service run as, and on which port?"* → the Dockerfile
 *   stages, `EXPOSE` and `CMD`.
 * - *"What infrastructure does this repo own?"* → Terraform addresses and
 *   Kubernetes resources.
 * - *"Does this migration drop a column something else still reads?"* → the
 *   single highest-value finding in this file. A destructive migration is the
 *   classic agent catastrophe: the SQL is three lines, it applies cleanly, and
 *   the code that read the column fails in production an hour later.
 * - *"Which endpoints does this service expose?"* → the OpenAPI paths.
 * - *"How do I run this?"* → `package.json` scripts.
 *
 * Today Sprang stores these as opaque `file` nodes with no internal structure
 * and no edges. This module turns each one into real nodes and real edges that
 * hang off the owning `file:<path>` node, so the graph can be queried for them.
 *
 * ## Design notes / known limitations — read before extending
 *
 * **There is deliberately no YAML, HCL, Dockerfile or XML dependency here.**
 * Every parser below is a focused, line-oriented reader that understands the
 * subset of each format that appears in practice: two-space block maps, block
 * sequences, inline flow sequences (`[a, b]`), block scalars (`|`, `>`) and
 * `#` comments. It does not implement anchors, aliases, merge keys, multi-line
 * flow collections, tags or explicit typing.
 *
 * That is a conscious trade. The failure mode of this parser is a *missed
 * field* — a node that lacks a piece of metadata, or a workflow whose exotic
 * syntax yields nothing. The failure mode of a new runtime dependency is
 * carried by every consumer of `@sprang/core` forever. A missed field is
 * acceptable; a dependency is not. If you find a real-world file that is parsed
 * wrongly, add a targeted case and a test — do not reach for a YAML library.
 *
 * Consequences worth stating out loud:
 * - Values are returned as strings. Nothing is coerced to number or boolean.
 * - Tabs used for indentation are counted as single columns; YAML forbids them
 *   anyway, and such a file simply yields fewer nodes.
 * - Every extractor is total: malformed input produces `{nodes: [], edges: []}`
 *   rather than throwing. Callers run this over whole repositories, and one bad
 *   file must never fail a scan.
 * - Output is sorted and deduplicated, so two runs over identical bytes produce
 *   byte-identical output and graph diffs stay meaningful.
 */

// ─── Public types ─────────────────────────────────────────────────────────────

/** Node types this module can emit. A subset of the graph's `NodeType` union. */
export type ArtifactNodeType =
  | 'config'
  | 'service'
  | 'table'
  | 'endpoint'
  | 'pipeline'
  | 'schema'
  | 'resource';

/** Edge types this module can emit. A subset of the graph's `EdgeType` union. */
export type ArtifactEdgeType =
  | 'contains'
  | 'configures'
  | 'deploys'
  | 'triggers'
  | 'migrates'
  | 'routes'
  | 'defines_schema';

/** A single structural element discovered inside a non-code file. */
export interface ArtifactNode {
  /** Stable, human-readable id, e.g. `pipeline:.github/workflows/ci.yml:build`. */
  id: string;
  type: ArtifactNodeType;
  label: string;
  /** Owning file, exactly as passed to {@link extractArtifacts}. */
  file: string;
  /** 1-based line the element was declared on, when known. */
  line?: number;
  metadata?: Record<string, unknown>;
}

/** A relationship between two artifact nodes, or from the owning file node. */
export interface ArtifactEdge {
  source: string;
  target: string;
  type: ArtifactEdgeType;
}

/** Everything one file contributed to the graph. */
export interface ArtifactExtraction {
  nodes: ArtifactNode[];
  edges: ArtifactEdge[];
}

/** The artifact formats understood by this module. */
export type ArtifactKind =
  | 'github-actions'
  | 'dockerfile'
  | 'docker-compose'
  | 'kubernetes'
  | 'terraform'
  | 'sql-migration'
  | 'openapi'
  | 'package-json';

/** Fresh empty result — never share a mutable object across callers. */
function empty(): ArtifactExtraction {
  return { nodes: [], edges: [] };
}

/** Id of the `file` node that owns everything we extract from a given path. */
export function fileNodeId(filePath: string): string {
  return `file:${normalizePath(filePath)}`;
}

// ─── File classification ──────────────────────────────────────────────────────

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\.\//, '');
}

function baseName(filePath: string): string {
  const parts = normalizePath(filePath).split('/');
  return parts[parts.length - 1] ?? '';
}

/**
 * Classify a file by path alone.
 *
 * Returns `null` for formats that cannot be told apart without looking at the
 * bytes — a bare `deploy.yaml` could be a Kubernetes manifest, an OpenAPI spec
 * or a CircleCI config. {@link extractArtifacts} falls back to content sniffing
 * ({@link sniffArtifactKind}) for exactly those cases, so callers that only
 * have a path get a conservative answer and callers that have the content get
 * the right one.
 */
export function detectArtifactKind(filePath: string): ArtifactKind | null {
  const path = normalizePath(filePath);
  const base = baseName(path);
  const lower = base.toLowerCase();

  if (lower === 'package.json') return 'package-json';

  if (/(^|\/)\.github\/workflows\/[^/]+\.ya?ml$/.test(path)) return 'github-actions';

  if (lower === 'dockerfile' || lower.startsWith('dockerfile.') || lower.endsWith('.dockerfile')) {
    return 'dockerfile';
  }

  if (/^(docker-)?compose([.-][\w.-]+)?\.ya?ml$/.test(lower)) return 'docker-compose';

  if (lower.endsWith('.tf')) return 'terraform';

  if (lower.endsWith('.sql') && /(^|\/|_|-|\.)migrations?(\/|_|-|\.|$)/.test(path.toLowerCase())) {
    return 'sql-migration';
  }

  if (/^(openapi|swagger)([.-][\w.-]+)?\.(ya?ml|json)$/.test(lower)) return 'openapi';

  return null;
}

/**
 * Classify an ambiguous YAML/JSON file by peeking at its content.
 *
 * Only called when {@link detectArtifactKind} returns `null`, and only for
 * `.yml` / `.yaml` / `.json` files.
 */
export function sniffArtifactKind(filePath: string, content: string): ArtifactKind | null {
  const lower = normalizePath(filePath).toLowerCase();
  if (!/\.(ya?ml|json)$/.test(lower)) return null;
  if (!content) return null;

  const head = content.slice(0, 200_000);

  if (/^\s*["']?(openapi|swagger)["']?\s*:/m.test(head)) return 'openapi';
  if (/^\s*kind\s*:/m.test(head) && /^\s*apiVersion\s*:/m.test(head)) return 'kubernetes';
  if (/^services\s*:/m.test(head) && /^\s+(image|build)\s*:/m.test(head)) return 'docker-compose';

  return null;
}

// ─── Minimal YAML-subset reader ───────────────────────────────────────────────
//
// See the module header for what this intentionally does not support.

interface YNode {
  /** Map key, absent for sequence items and bare scalars. */
  key?: string;
  /** Inline scalar value, absent for nodes with children. */
  value?: string;
  /** 1-based line. */
  line: number;
  /** `true` when this node came from a `- ` sequence entry. */
  isItem: boolean;
  children: YNode[];
}

/** Matches `key:` and `key: value`, including quoted keys. Not greedy. */
const KEY_RE = /^("[^"]*"|'[^']*'|[^:#]+?)\s*:(?:\s+([^\n]*))?$/;
const BLOCK_SCALAR_RE = /^[|>][-+]?\d*$/;

function unquote(raw: string): string {
  const s = raw.trim();
  if (s.length >= 2) {
    const first = s[0];
    const last = s[s.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return s.slice(1, -1);
    }
  }
  return s;
}

/** Strip a trailing ` # comment` that is not inside quotes. */
function stripInlineComment(raw: string): string {
  let quote: string | null = null;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '#' && (i === 0 || raw[i - 1] === ' ' || raw[i - 1] === '\t')) {
      return raw.slice(0, i);
    }
  }
  return raw;
}

function cleanValue(raw: string): string {
  return unquote(stripInlineComment(raw).trim());
}

function indentOf(line: string): number {
  let i = 0;
  while (i < line.length && (line[i] === ' ' || line[i] === '\t')) i++;
  return i;
}

/**
 * Parse a YAML subset into a tree. Returns a synthetic root whose `children`
 * are the document's top-level entries. Never throws.
 */
function parseYamlish(content: string, lineOffset = 0): YNode {
  const root: YNode = { line: lineOffset, isItem: false, children: [] };
  const stack: Array<{ indent: number; node: YNode }> = [{ indent: -1, node: root }];
  const lines = content.split(/\r?\n/);

  // Active block scalar (`key: |`) being accumulated.
  let block: { node: YNode; ownerIndent: number; lines: string[] } | null = null;

  const closeBlock = (): void => {
    if (!block) return;
    // Trim trailing blank lines, then dedent uniformly.
    const buf = [...block.lines];
    while (buf.length > 0 && (buf[buf.length - 1] ?? '').trim() === '') buf.pop();
    let min = Infinity;
    for (const l of buf) {
      if (l.trim() === '') continue;
      min = Math.min(min, indentOf(l));
    }
    const pad = Number.isFinite(min) ? min : 0;
    block.node.value = buf.map((l) => l.slice(pad)).join('\n');
    block = null;
  };

  const push = (indent: number, node: YNode): void => {
    let top = stack[stack.length - 1];
    while (stack.length > 1 && top && top.indent >= indent) {
      stack.pop();
      top = stack[stack.length - 1];
    }
    (top ?? { node: root }).node.children.push(node);
    stack.push({ indent, node });
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? '';
    const lineNo = lineOffset + i + 1;

    if (block) {
      if (raw.trim() === '' || indentOf(raw) > block.ownerIndent) {
        block.lines.push(raw);
        continue;
      }
      closeBlock();
    }

    if (raw.trim() === '' || raw.trim().startsWith('#')) continue;

    let indent = indentOf(raw);
    let rest = raw.slice(indent).trimEnd();

    if (rest === '-' || rest.startsWith('- ')) {
      const after = rest.replace(/^-\s*/, '');
      const dashLen = rest.length - after.length;
      const item: YNode = { line: lineNo, isItem: true, children: [] };
      push(indent, item);
      if (after === '') continue;
      if (!KEY_RE.test(after)) {
        item.value = cleanValue(after);
        continue;
      }
      indent = indent + dashLen;
      rest = after;
    }

    const m = KEY_RE.exec(rest);
    if (!m) {
      push(indent, { line: lineNo, isItem: false, children: [], value: cleanValue(rest) });
      continue;
    }

    const key = unquote(m[1] ?? '');
    const rawValue = (m[2] ?? '').trim();
    const node: YNode = { key, line: lineNo, isItem: false, children: [] };
    push(indent, node);

    if (rawValue === '') continue;
    if (BLOCK_SCALAR_RE.test(rawValue)) {
      block = { node, ownerIndent: indent, lines: [] };
      continue;
    }
    node.value = cleanValue(rawValue);
  }

  closeBlock();
  return root;
}

function child(node: YNode | undefined, key: string): YNode | undefined {
  if (!node) return undefined;
  return node.children.find((c) => c.key === key);
}

function childValue(node: YNode | undefined, key: string): string | undefined {
  const c = child(node, key);
  const v = c?.value;
  return v === undefined || v === '' ? undefined : v;
}

/** Map children that are `key: ...` entries, in document order. */
function mapEntries(node: YNode | undefined): YNode[] {
  if (!node) return [];
  return node.children.filter((c) => c.key !== undefined);
}

/** Sequence items, in document order. */
function seqItems(node: YNode | undefined): YNode[] {
  if (!node) return [];
  return node.children.filter((c) => c.isItem);
}

function splitFlowSeq(value: string): string[] {
  const inner = value.trim().replace(/^\[/, '').replace(/\]$/, '');
  return inner
    .split(',')
    .map((s) => unquote(s.trim()))
    .filter((s) => s !== '');
}

/**
 * Read a value that may be a scalar, an inline flow sequence, a block sequence
 * or a block map (in which case the keys are returned — this is how `on:` and
 * `depends_on:` appear in the wild).
 */
function toStringList(node: YNode | undefined): string[] {
  if (!node) return [];
  if (node.value !== undefined && node.value !== '') {
    const v = node.value;
    if (v.startsWith('[')) return splitFlowSeq(v);
    return [v];
  }
  const out: string[] = [];
  for (const c of node.children) {
    if (c.isItem) {
      if (c.value !== undefined && c.value !== '') out.push(c.value);
      else {
        const first = c.children[0];
        if (first?.key !== undefined) out.push(first.key);
      }
    } else if (c.key !== undefined) {
      out.push(c.key);
    } else if (c.value !== undefined && c.value !== '') {
      out.push(c.value);
    }
  }
  return out;
}

/** Depth-first collection of every value stored under `key`, in file order. */
function collectValues(node: YNode, key: string, out: string[] = []): string[] {
  for (const c of node.children) {
    if (c.key === key && c.value !== undefined && c.value !== '') out.push(c.value);
    collectValues(c, key, out);
  }
  return out;
}

// ─── Result assembly ──────────────────────────────────────────────────────────

class Builder {
  private readonly nodeById = new Map<string, ArtifactNode>();
  private readonly edgeSet = new Set<string>();
  private readonly edges: ArtifactEdge[] = [];

  constructor(readonly file: string) {}

  node(n: ArtifactNode): ArtifactNode {
    const existing = this.nodeById.get(n.id);
    if (existing) return existing;
    this.nodeById.set(n.id, n);
    return n;
  }

  has(id: string): boolean {
    return this.nodeById.has(id);
  }

  edge(source: string, target: string, type: ArtifactEdgeType): void {
    if (source === target) return;
    const key = `${source}\u0000${type}\u0000${target}`;
    if (this.edgeSet.has(key)) return;
    this.edgeSet.add(key);
    this.edges.push({ source, target, type });
  }

  /** Sorted, deduplicated output — identical bytes in, identical bytes out. */
  build(): ArtifactExtraction {
    const nodes = [...this.nodeById.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const edges = [...this.edges].sort((a, b) => {
      const ka = `${a.source}\u0000${a.type}\u0000${a.target}`;
      const kb = `${b.source}\u0000${b.type}\u0000${b.target}`;
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
    return { nodes, edges };
  }
}

// ─── GitHub Actions ───────────────────────────────────────────────────────────

/**
 * Extract one `pipeline` node per workflow job.
 *
 * Makes answerable: *"how is this repo built and released?"*, *"what runs
 * before what?"* (via `needs:` → `triggers` edges, so the graph knows that
 * deleting the `build` job breaks `publish`), *"which third-party actions does
 * CI trust?"* (each step's `uses:`) and *"what makes CI run at all?"* (`on:`).
 */
function extractGithubActions(file: string, content: string): ArtifactExtraction {
  const b = new Builder(file);
  const root = parseYamlish(content);
  const jobs = child(root, 'jobs');
  if (!jobs) return empty();

  const workflowName = childValue(root, 'name');
  const onNode = child(root, 'on') ?? child(root, 'true'); // `on:` is YAML 1.1 true
  const triggers = toStringList(onNode);

  const jobIds: string[] = [];
  for (const job of mapEntries(jobs)) {
    const jobId = job.key;
    if (!jobId) continue;
    jobIds.push(jobId);

    const needs = toStringList(child(job, 'needs'));
    const steps = seqItems(child(job, 'steps')).map((step) => {
      const entry: Record<string, unknown> = {};
      const name = childValue(step, 'name');
      const uses = childValue(step, 'uses');
      const run = childValue(step, 'run');
      if (name !== undefined) entry['name'] = name;
      if (uses !== undefined) entry['uses'] = uses;
      if (run !== undefined) entry['run'] = run.split('\n')[0] ?? run;
      return entry;
    });

    const uses = steps
      .map((s) => s['uses'])
      .filter((u): u is string => typeof u === 'string')
      .sort();

    const metadata: Record<string, unknown> = {
      jobId,
      needs,
      steps,
      uses: [...new Set(uses)],
      stepCount: steps.length,
      triggers,
    };
    const name = childValue(job, 'name');
    const runsOn = toStringList(child(job, 'runs-on'));
    if (name !== undefined) metadata['name'] = name;
    if (runsOn.length === 1) metadata['runsOn'] = runsOn[0];
    else if (runsOn.length > 1) metadata['runsOn'] = runsOn;
    if (workflowName !== undefined) metadata['workflow'] = workflowName;
    const ifCond = childValue(job, 'if');
    if (ifCond !== undefined) metadata['if'] = ifCond;

    const id = `pipeline:${file}:${jobId}`;
    b.node({ id, type: 'pipeline', label: name ?? jobId, file, line: job.line, metadata });
    b.edge(fileNodeId(file), id, 'contains');
  }

  if (jobIds.length === 0) return empty();

  // `needs` edges, emitted only between jobs that exist: a typo'd dependency
  // must not invent a node.
  for (const job of mapEntries(jobs)) {
    const jobId = job.key;
    if (!jobId) continue;
    for (const need of toStringList(child(job, 'needs'))) {
      if (!jobIds.includes(need)) continue;
      b.edge(`pipeline:${file}:${need}`, `pipeline:${file}:${jobId}`, 'triggers');
    }
  }

  return b.build();
}

// ─── Dockerfile ───────────────────────────────────────────────────────────────

/**
 * Extract one `service` node per build stage.
 *
 * Makes answerable: *"what does this image actually run, and on what port?"* —
 * the base image (is it pinned? is it `latest`?), the `EXPOSE`d ports and the
 * `CMD`/`ENTRYPOINT` that is the true entry point of the deployed service, and
 * which is almost never the file a reader would guess from the source tree.
 */
function extractDockerfile(file: string, content: string): ArtifactExtraction {
  const b = new Builder(file);

  // Join `\`-continued lines so a multi-line CMD is read as one instruction.
  const rawLines = content.split(/\r?\n/);
  const logical: Array<{ text: string; line: number }> = [];
  let buffer = '';
  let start = 0;
  for (let i = 0; i < rawLines.length; i++) {
    const raw = (rawLines[i] ?? '').trim();
    if (raw === '' && buffer === '') continue;
    if (raw.startsWith('#') && buffer === '') continue;
    if (buffer === '') start = i + 1;
    if (raw.endsWith('\\')) {
      buffer += `${raw.slice(0, -1).trim()} `;
      continue;
    }
    logical.push({ text: (buffer + raw).trim(), line: start });
    buffer = '';
  }
  if (buffer.trim() !== '') logical.push({ text: buffer.trim(), line: start });

  interface Stage {
    id: string;
    name: string;
    baseImage: string;
    line: number;
    index: number;
    ports: string[];
    cmd?: string;
    entrypoint?: string;
    workdir?: string;
    user?: string;
    copyFrom: string[];
  }
  const stages: Stage[] = [];

  for (const { text, line } of logical) {
    const from = /^FROM\s+(\S+)(?:\s+AS\s+([A-Za-z0-9_.-]+))?\s*$/i.exec(text);
    if (from) {
      const baseImage = from[1] ?? '';
      const index = stages.length;
      const name = from[2] ?? `stage${index}`;
      stages.push({
        id: `service:${file}:${name}`,
        name,
        baseImage,
        line,
        index,
        ports: [],
        copyFrom: [],
      });
      continue;
    }

    const current = stages[stages.length - 1];
    if (!current) continue;

    const expose = /^EXPOSE\s+(.+)$/i.exec(text);
    if (expose) {
      for (const p of (expose[1] ?? '').split(/\s+/)) {
        const port = p.trim();
        if (port !== '' && !current.ports.includes(port)) current.ports.push(port);
      }
      continue;
    }

    const cmd = /^CMD\s+(.+)$/i.exec(text);
    if (cmd) {
      current.cmd = normalizeExec(cmd[1] ?? '');
      continue;
    }

    const entry = /^ENTRYPOINT\s+(.+)$/i.exec(text);
    if (entry) {
      current.entrypoint = normalizeExec(entry[1] ?? '');
      continue;
    }

    const workdir = /^WORKDIR\s+(.+)$/i.exec(text);
    if (workdir) {
      current.workdir = (workdir[1] ?? '').trim();
      continue;
    }

    const user = /^USER\s+(.+)$/i.exec(text);
    if (user) {
      current.user = (user[1] ?? '').trim();
      continue;
    }

    const copyFrom = /^COPY\s+--from=([A-Za-z0-9_.-]+)\s/i.exec(text);
    if (copyFrom) {
      const src = copyFrom[1] ?? '';
      if (src !== '' && !current.copyFrom.includes(src)) current.copyFrom.push(src);
    }
  }

  if (stages.length === 0) return empty();

  for (const stage of stages) {
    const metadata: Record<string, unknown> = {
      stage: stage.name,
      stageIndex: stage.index,
      baseImage: stage.baseImage,
      ports: stage.ports,
      final: stage.index === stages.length - 1,
    };
    if (stage.cmd !== undefined) metadata['cmd'] = stage.cmd;
    if (stage.entrypoint !== undefined) metadata['entrypoint'] = stage.entrypoint;
    if (stage.workdir !== undefined) metadata['workdir'] = stage.workdir;
    if (stage.user !== undefined) metadata['user'] = stage.user;

    b.node({ id: stage.id, type: 'service', label: stage.name, file, line: stage.line, metadata });
    b.edge(fileNodeId(file), stage.id, 'contains');
  }

  // `COPY --from=builder` is a real build-order dependency between stages.
  for (const stage of stages) {
    for (const src of stage.copyFrom) {
      const target = `service:${file}:${src}`;
      if (b.has(target)) b.edge(target, stage.id, 'triggers');
    }
  }

  return b.build();
}

/** Normalize `["node", "server.js"]` and `node server.js` to one readable form. */
function normalizeExec(raw: string): string {
  const text = raw.trim();
  if (!text.startsWith('[')) return text;
  const parts = splitFlowSeq(text);
  return parts.length > 0 ? parts.join(' ') : text;
}

// ─── docker-compose ───────────────────────────────────────────────────────────

/**
 * Extract one `service` node per compose service.
 *
 * Makes answerable: *"what does `docker compose up` actually start, in what
 * order, and which images does it pull?"* — `depends_on` becomes `triggers`
 * edges and the image becomes a `resource` node with a `deploys` edge, so a
 * change to an image tag has a visible blast radius.
 */
function extractDockerCompose(file: string, content: string): ArtifactExtraction {
  const b = new Builder(file);
  const root = parseYamlish(content);
  const services = child(root, 'services');
  if (!services) return empty();

  const serviceIds = new Map<string, string>();
  const entries = mapEntries(services);
  if (entries.length === 0) return empty();

  for (const svc of entries) {
    const name = svc.key;
    if (!name) continue;
    const id = `service:${file}:${name}`;
    serviceIds.set(name, id);

    const image = childValue(svc, 'image');
    const ports = toStringList(child(svc, 'ports'));
    const dependsOn = toStringList(child(svc, 'depends_on'));
    const metadata: Record<string, unknown> = {
      service: name,
      ports,
      dependsOn,
    };
    if (image !== undefined) metadata['image'] = image;
    const buildNode = child(svc, 'build');
    if (buildNode) {
      metadata['build'] = buildNode.value ?? childValue(buildNode, 'context') ?? '.';
      const dockerfile = childValue(buildNode, 'dockerfile');
      if (dockerfile !== undefined) metadata['dockerfile'] = dockerfile;
    }
    const command = childValue(svc, 'command');
    if (command !== undefined) metadata['command'] = command;
    const environment = toStringList(child(svc, 'environment')).map((e) => e.split('=')[0] ?? e);
    if (environment.length > 0) metadata['environment'] = environment;

    b.node({ id, type: 'service', label: name, file, line: svc.line, metadata });
    b.edge(fileNodeId(file), id, 'contains');

    if (image !== undefined) {
      const imageId = `resource:${file}:image/${image}`;
      b.node({
        id: imageId,
        type: 'resource',
        label: image,
        file,
        line: child(svc, 'image')?.line,
        metadata: { kind: 'image', image },
      });
      b.edge(id, imageId, 'deploys');
    }
  }

  for (const svc of entries) {
    const name = svc.key;
    if (!name) continue;
    const target = serviceIds.get(name);
    if (!target) continue;
    for (const dep of toStringList(child(svc, 'depends_on'))) {
      const source = serviceIds.get(dep);
      if (source) b.edge(source, target, 'triggers');
    }
  }

  return b.build();
}

// ─── Kubernetes ───────────────────────────────────────────────────────────────

const K8S_WORKLOAD_KINDS = new Set([
  'Pod',
  'Deployment',
  'StatefulSet',
  'DaemonSet',
  'ReplicaSet',
  'Job',
  'CronJob',
]);

/**
 * Extract one `resource` node per YAML document in a manifest.
 *
 * Makes answerable: *"what does this repo deploy, and with what image?"* —
 * multi-document files (the norm: Deployment + Service + Ingress in one file)
 * are split on `^---`, each document becomes `resource:<file>:<Kind>/<name>`,
 * container images become their own `resource` nodes with `deploys` edges, and
 * an Ingress gets `routes` edges to the Services it names in the same file.
 */
function extractKubernetes(file: string, content: string): ArtifactExtraction {
  const b = new Builder(file);
  const docs = splitYamlDocuments(content);
  let found = 0;

  interface Doc {
    kind: string;
    name: string;
    id: string;
    root: YNode;
  }
  const parsed: Doc[] = [];

  for (const doc of docs) {
    const root = parseYamlish(doc.text, doc.offset);
    const kind = childValue(root, 'kind');
    const apiVersion = childValue(root, 'apiVersion');
    if (kind === undefined || apiVersion === undefined) continue;
    const meta = child(root, 'metadata');
    const name = childValue(meta, 'name') ?? '(unnamed)';
    const id = `resource:${file}:${kind}/${name}`;
    found++;

    const metadata: Record<string, unknown> = { kind, apiVersion, name };
    const namespace = childValue(meta, 'namespace');
    if (namespace !== undefined) metadata['namespace'] = namespace;
    const spec = child(root, 'spec');
    const replicas = childValue(spec, 'replicas');
    if (replicas !== undefined) metadata['replicas'] = replicas;
    const images = [...new Set(collectValues(root, 'image'))];
    if (images.length > 0) metadata['images'] = images;

    b.node({
      id,
      type: 'resource',
      label: `${kind}/${name}`,
      file,
      line: child(root, 'kind')?.line ?? doc.offset + 1,
      metadata,
    });
    b.edge(fileNodeId(file), id, 'contains');

    if (K8S_WORKLOAD_KINDS.has(kind)) {
      for (const image of images) {
        const imageId = `resource:${file}:image/${image}`;
        b.node({
          id: imageId,
          type: 'resource',
          label: image,
          file,
          metadata: { kind: 'image', image },
        });
        b.edge(id, imageId, 'deploys');
      }
    }

    parsed.push({ kind, name, id, root });
  }

  if (found === 0) return empty();

  // Ingress → Service routing, but only for Services declared in this file. An
  // edge to a node that does not exist is worse than no edge.
  for (const doc of parsed) {
    if (doc.kind !== 'Ingress') continue;
    for (const svcName of collectValues(doc.root, 'name')) {
      const target = `resource:${file}:Service/${svcName}`;
      if (b.has(target)) b.edge(doc.id, target, 'routes');
    }
  }

  return b.build();
}

/** Split on `^---` document separators, tracking each document's line offset. */
function splitYamlDocuments(content: string): Array<{ text: string; offset: number }> {
  const lines = content.split(/\r?\n/);
  const docs: Array<{ text: string; offset: number }> = [];
  let buf: string[] = [];
  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? '';
    if (/^---\s*$/.test(raw) || /^---\s+\S/.test(raw)) {
      if (buf.length > 0) docs.push({ text: buf.join('\n'), offset });
      buf = [];
      offset = i + 1;
      continue;
    }
    if (/^\.\.\.\s*$/.test(raw)) continue;
    buf.push(raw);
  }
  if (buf.length > 0) docs.push({ text: buf.join('\n'), offset });
  return docs;
}

// ─── Terraform ────────────────────────────────────────────────────────────────

const TF_BLOCK_RE = /^\s*(resource|data|module)\s+"([^"]+)"(?:\s+"([^"]+)")?\s*\{/;

/**
 * Extract one `resource` node per Terraform `resource` / `data` / `module`
 * block, keyed by its canonical Terraform address.
 *
 * Makes answerable: *"what infrastructure does this repo own, and what is the
 * address I would `terraform state rm`?"* Using the address (`aws_s3_bucket.logs`,
 * `data.aws_ami.ubuntu`, `module.vpc`) rather than the file position means the
 * node id matches what appears in a plan output.
 */
function extractTerraform(file: string, content: string): ArtifactExtraction {
  const b = new Builder(file);
  const lines = content.split(/\r?\n/);
  let found = 0;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? '';
    if (/^\s*(#|\/\/)/.test(raw)) continue;
    const m = TF_BLOCK_RE.exec(raw);
    if (!m) continue;

    const blockType = m[1] ?? '';
    const first = m[2] ?? '';
    const second = m[3];

    let address: string;
    const metadata: Record<string, unknown> = { blockType };
    if (blockType === 'module') {
      address = `module.${first}`;
      metadata['name'] = first;
    } else if (second === undefined || second === '') {
      // `resource "x" {` with no name is invalid HCL; skip rather than guess.
      continue;
    } else if (blockType === 'data') {
      address = `data.${first}.${second}`;
      metadata['resourceType'] = first;
      metadata['name'] = second;
    } else {
      address = `${first}.${second}`;
      metadata['resourceType'] = first;
      metadata['name'] = second;
    }
    metadata['address'] = address;

    const source = /^\s*source\s*=\s*"([^"]+)"/.exec(lines[i + 1] ?? '');
    if (blockType === 'module' && source) metadata['source'] = source[1] ?? '';

    found++;
    const id = `resource:${file}:${address}`;
    b.node({ id, type: 'resource', label: address, file, line: i + 1, metadata });
    b.edge(fileNodeId(file), id, 'contains');
  }

  if (found === 0) return empty();
  return b.build();
}

// ─── SQL migrations ───────────────────────────────────────────────────────────

/**
 * Extract one `table` node per table this migration touches.
 *
 * Makes answerable the highest-value question in this file: **"does this
 * migration drop a column something still reads?"**
 *
 * A destructive migration is the classic agent catastrophe. `DROP TABLE`,
 * `DROP COLUMN`, `ALTER ... DROP` and `TRUNCATE` are three lines of SQL, they
 * apply cleanly, and the code that read the data fails an hour later in
 * production. Marking `metadata.destructive = true` and carrying the exact
 * statement means a reviewer — human or agent — can be told *before* the change
 * lands, and can cross-reference the table against everything else in the graph
 * that reads it.
 */
function extractSqlMigration(file: string, content: string): ArtifactExtraction {
  const b = new Builder(file);

  interface TableInfo {
    name: string;
    line: number;
    created: boolean;
    operations: string[];
    destructiveStatements: string[];
  }
  const tables = new Map<string, TableInfo>();
  const order: string[] = [];

  const get = (rawName: string, line: number): TableInfo | undefined => {
    const name = normalizeSqlIdentifier(rawName);
    if (name === '') return undefined;
    let info = tables.get(name);
    if (!info) {
      info = { name, line, created: false, operations: [], destructiveStatements: [] };
      tables.set(name, info);
      order.push(name);
    }
    return info;
  };

  for (const stmt of splitSqlStatements(content)) {
    const text = stmt.text;
    const oneLine = text.replace(/\s+/g, ' ').trim();
    if (oneLine === '') continue;

    const create = /\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:TEMP(?:ORARY)?\s+|UNLOGGED\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z0-9_."`[\]]+)/i.exec(oneLine);
    if (create) {
      const info = get(create[1] ?? '', stmt.line);
      if (info) {
        info.created = true;
        info.line = stmt.line;
        if (!info.operations.includes('create_table')) info.operations.push('create_table');
      }
      continue;
    }

    const drop = /\bDROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([A-Za-z0-9_."`[\]]+)/i.exec(oneLine);
    if (drop) {
      const info = get(drop[1] ?? '', stmt.line);
      if (info) {
        if (!info.operations.includes('drop_table')) info.operations.push('drop_table');
        info.destructiveStatements.push(oneLine);
      }
      continue;
    }

    const truncate = /\bTRUNCATE\s+(?:TABLE\s+)?([A-Za-z0-9_."`[\]]+)/i.exec(oneLine);
    if (truncate) {
      const info = get(truncate[1] ?? '', stmt.line);
      if (info) {
        if (!info.operations.includes('truncate')) info.operations.push('truncate');
        info.destructiveStatements.push(oneLine);
      }
      continue;
    }

    const alter = /\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?([A-Za-z0-9_."`[\]]+)\s+([\s\S]+)$/i.exec(oneLine);
    if (alter) {
      const info = get(alter[1] ?? '', stmt.line);
      if (info) {
        const body = alter[2] ?? '';
        // `DROP COLUMN x`, `DROP x`, `DROP CONSTRAINT x` — every ALTER ... DROP
        // removes something that other code may depend on.
        if (/\bDROP\s+/i.test(body)) {
          const op = /\bDROP\s+COLUMN\b/i.test(body) ? 'drop_column' : 'alter_drop';
          if (!info.operations.includes(op)) info.operations.push(op);
          info.destructiveStatements.push(oneLine);
        } else if (/\bADD\s+/i.test(body)) {
          if (!info.operations.includes('add_column')) info.operations.push('add_column');
        } else if (/\bRENAME\b/i.test(body)) {
          if (!info.operations.includes('rename')) info.operations.push('rename');
        } else {
          if (!info.operations.includes('alter_table')) info.operations.push('alter_table');
        }
      }
      continue;
    }

    const index = /\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?[A-Za-z0-9_."`[\]]+\s+ON\s+([A-Za-z0-9_."`[\]]+)/i.exec(oneLine);
    if (index) {
      const info = get(index[1] ?? '', stmt.line);
      if (info && !info.operations.includes('create_index')) info.operations.push('create_index');
      continue;
    }
  }

  if (order.length === 0) return empty();

  for (const name of order) {
    const info = tables.get(name);
    if (!info) continue;
    const destructive = info.destructiveStatements.length > 0;
    const metadata: Record<string, unknown> = {
      table: info.name,
      operations: info.operations,
      created: info.created,
      migration: file,
    };
    if (destructive) {
      metadata['destructive'] = true;
      metadata['destructiveStatements'] = info.destructiveStatements;
    }

    const id = `table:${file}:${info.name}`;
    b.node({ id, type: 'table', label: info.name, file, line: info.line, metadata });
    // `contains` = this file defines the table. `migrates` = this file changes it.
    if (info.created) b.edge(fileNodeId(file), id, 'contains');
    b.edge(fileNodeId(file), id, 'migrates');
  }

  return b.build();
}

function normalizeSqlIdentifier(raw: string): string {
  return raw
    .trim()
    .replace(/[`"[\]]/g, '')
    .replace(/;$/, '')
    .toLowerCase();
}

/** Split SQL into statements, stripping comments, tracking start lines. */
function splitSqlStatements(content: string): Array<{ text: string; line: number }> {
  const out: Array<{ text: string; line: number }> = [];
  let buf = '';
  let startLine = 1;
  let line = 1;
  let inLineComment = false;
  let inBlockComment = false;
  let quote: string | null = null;

  for (let i = 0; i < content.length; i++) {
    const ch = content[i] ?? '';
    const next = content[i + 1] ?? '';
    if (ch === '\n') line++;

    if (inLineComment) {
      if (ch === '\n') {
        inLineComment = false;
        buf += ch;
      }
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (quote) {
      buf += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '-' && next === '-') {
      inLineComment = true;
      i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i++;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      buf += ch;
      continue;
    }
    if (ch === ';') {
      if (buf.trim() !== '') out.push({ text: buf.trim(), line: startLine });
      buf = '';
      startLine = line;
      continue;
    }
    if (buf.trim() === '' && ch.trim() === '') {
      if (ch === '\n') startLine = line;
      continue;
    }
    buf += ch;
  }
  if (buf.trim() !== '') out.push({ text: buf.trim(), line: startLine });
  return out;
}

// ─── OpenAPI ──────────────────────────────────────────────────────────────────

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

/**
 * Extract one `endpoint` node per path + method, and one `schema` node per
 * component schema.
 *
 * Makes answerable: *"which endpoints does this service expose?"* — the single
 * most common onboarding question, and one a code graph answers badly because
 * routes are assembled at runtime from decorators, routers and mounts. The spec
 * states them declaratively. `operationId` is carried in metadata because it is
 * the name generated clients use, so it is the string a caller will search for.
 */
function extractOpenApi(file: string, content: string): ArtifactExtraction {
  const b = new Builder(file);

  const doc = parseOpenApiDoc(file, content);
  if (!doc) return empty();

  for (const op of doc.operations) {
    const id = `endpoint:${file}:${op.method} ${op.path}`;
    const metadata: Record<string, unknown> = { method: op.method, path: op.path };
    if (op.operationId !== undefined) metadata['operationId'] = op.operationId;
    if (op.summary !== undefined) metadata['summary'] = op.summary;
    if (op.tags && op.tags.length > 0) metadata['tags'] = op.tags;
    if (doc.title !== undefined) metadata['api'] = doc.title;
    if (doc.version !== undefined) metadata['specVersion'] = doc.version;

    b.node({
      id,
      type: 'endpoint',
      label: `${op.method} ${op.path}`,
      file,
      line: op.line,
      metadata,
    });
    b.edge(fileNodeId(file), id, 'contains');
    b.edge(fileNodeId(file), id, 'routes');
  }

  for (const schema of doc.schemas) {
    const id = `schema:${file}:${schema.name}`;
    b.node({
      id,
      type: 'schema',
      label: schema.name,
      file,
      line: schema.line,
      metadata: { schema: schema.name },
    });
    b.edge(fileNodeId(file), id, 'defines_schema');
  }

  if (doc.operations.length === 0 && doc.schemas.length === 0) return empty();
  return b.build();
}

interface OpenApiOperation {
  path: string;
  method: string;
  operationId?: string;
  summary?: string;
  tags?: string[];
  line?: number;
}

interface OpenApiDoc {
  title?: string;
  version?: string;
  operations: OpenApiOperation[];
  schemas: Array<{ name: string; line?: number }>;
}

function parseOpenApiDoc(file: string, content: string): OpenApiDoc | null {
  if (file.toLowerCase().endsWith('.json')) return parseOpenApiJson(content);

  const root = parseYamlish(content);
  const version = childValue(root, 'openapi') ?? childValue(root, 'swagger');
  const title = childValue(child(root, 'info'), 'title');
  const operations: OpenApiOperation[] = [];
  const schemas: Array<{ name: string; line?: number }> = [];

  for (const pathNode of mapEntries(child(root, 'paths'))) {
    const path = pathNode.key;
    if (!path || !path.startsWith('/')) continue;
    for (const methodNode of mapEntries(pathNode)) {
      const method = (methodNode.key ?? '').toLowerCase();
      if (!HTTP_METHODS.includes(method)) continue;
      const op: OpenApiOperation = {
        path,
        method: method.toUpperCase(),
        line: methodNode.line,
      };
      const operationId = childValue(methodNode, 'operationId');
      const summary = childValue(methodNode, 'summary');
      const tags = toStringList(child(methodNode, 'tags'));
      if (operationId !== undefined) op.operationId = operationId;
      if (summary !== undefined) op.summary = summary;
      if (tags.length > 0) op.tags = tags;
      operations.push(op);
    }
  }

  const componentSchemas = child(child(root, 'components'), 'schemas') ?? child(root, 'definitions');
  for (const s of mapEntries(componentSchemas)) {
    if (s.key) schemas.push({ name: s.key, line: s.line });
  }

  const result: OpenApiDoc = { operations, schemas };
  if (title !== undefined) result.title = title;
  if (version !== undefined) result.version = version;
  return result;
}

function parseOpenApiJson(content: string): OpenApiDoc | null {
  const parsed = safeJsonParse(content);
  if (!isRecord(parsed)) return null;
  const version = asString(parsed['openapi']) ?? asString(parsed['swagger']);
  const info = isRecord(parsed['info']) ? parsed['info'] : undefined;
  const title = info ? asString(info['title']) : undefined;

  const operations: OpenApiOperation[] = [];
  const paths = isRecord(parsed['paths']) ? parsed['paths'] : undefined;
  if (paths) {
    for (const [path, item] of Object.entries(paths)) {
      if (!path.startsWith('/') || !isRecord(item)) continue;
      for (const [method, opValue] of Object.entries(item)) {
        if (!HTTP_METHODS.includes(method.toLowerCase())) continue;
        const op: OpenApiOperation = { path, method: method.toUpperCase() };
        if (isRecord(opValue)) {
          const operationId = asString(opValue['operationId']);
          const summary = asString(opValue['summary']);
          const tags = asStringArray(opValue['tags']);
          if (operationId !== undefined) op.operationId = operationId;
          if (summary !== undefined) op.summary = summary;
          if (tags.length > 0) op.tags = tags;
        }
        operations.push(op);
      }
    }
  }

  const schemas: Array<{ name: string; line?: number }> = [];
  const components = isRecord(parsed['components']) ? parsed['components'] : undefined;
  const schemaMap = components && isRecord(components['schemas'])
    ? components['schemas']
    : isRecord(parsed['definitions'])
      ? parsed['definitions']
      : undefined;
  if (schemaMap) for (const name of Object.keys(schemaMap)) schemas.push({ name });

  const result: OpenApiDoc = { operations, schemas };
  if (title !== undefined) result.title = title;
  if (version !== undefined) result.version = version;
  return result;
}

// ─── package.json ─────────────────────────────────────────────────────────────

/**
 * Extract a single `config` node for a `package.json`.
 *
 * Makes answerable: *"how do I run this?"* The `scripts` block is the literal
 * answer to build / test / lint / start, and an agent that reads it stops
 * guessing at `npm run dev`. Workspace globs are captured too, because in a
 * monorepo they define what "the project" even is.
 */
function extractPackageJson(file: string, content: string): ArtifactExtraction {
  const b = new Builder(file);
  const parsed = safeJsonParse(content);
  if (!isRecord(parsed)) return empty();

  const name = asString(parsed['name']);
  const scriptsRecord = isRecord(parsed['scripts']) ? parsed['scripts'] : {};
  const scripts = Object.keys(scriptsRecord).sort();
  const scriptCommands: Record<string, string> = {};
  for (const key of scripts) {
    const cmd = asString(scriptsRecord[key]);
    if (cmd !== undefined) scriptCommands[key] = cmd;
  }

  const metadata: Record<string, unknown> = {
    scripts,
    scriptCommands,
    dependencies: isRecord(parsed['dependencies']) ? Object.keys(parsed['dependencies']).sort() : [],
    devDependencies: isRecord(parsed['devDependencies'])
      ? Object.keys(parsed['devDependencies']).sort()
      : [],
  };
  if (name !== undefined) metadata['name'] = name;
  const version = asString(parsed['version']);
  if (version !== undefined) metadata['version'] = version;
  const packageManager = asString(parsed['packageManager']);
  if (packageManager !== undefined) metadata['packageManager'] = packageManager;
  const workspaces = asStringArray(parsed['workspaces']);
  if (workspaces.length > 0) metadata['workspaces'] = workspaces;
  if (parsed['private'] === true) metadata['private'] = true;

  const id = `config:${file}`;
  b.node({ id, type: 'config', label: name ?? baseName(file), file, line: 1, metadata });
  b.edge(fileNodeId(file), id, 'contains');
  b.edge(id, fileNodeId(file), 'configures');
  return b.build();
}

// ─── Small typed JSON helpers (no `any`) ──────────────────────────────────────

function safeJsonParse(content: string): unknown {
  try {
    return JSON.parse(content) as unknown;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string');
}

// ─── Entry point ──────────────────────────────────────────────────────────────

/**
 * Turn one non-code file into graph nodes and edges.
 *
 * Returns `{nodes: [], edges: []}` for files this module does not understand
 * and for files it understands but cannot parse. It never throws: this runs
 * over every file in a repository, and a single malformed manifest must not
 * fail a scan.
 *
 * Output is sorted by node id and by `(source, type, target)`, and duplicate
 * edges are collapsed, so re-running over unchanged bytes produces an identical
 * result and graph diffs stay meaningful.
 */
export function extractArtifacts(filePath: string, content: string): ArtifactExtraction {
  const file = normalizePath(filePath);
  if (typeof content !== 'string' || content === '') return empty();

  const kind = detectArtifactKind(file) ?? sniffArtifactKind(file, content);
  if (kind === null) return empty();

  try {
    switch (kind) {
      case 'github-actions':
        return extractGithubActions(file, content);
      case 'dockerfile':
        return extractDockerfile(file, content);
      case 'docker-compose':
        return extractDockerCompose(file, content);
      case 'kubernetes':
        return extractKubernetes(file, content);
      case 'terraform':
        return extractTerraform(file, content);
      case 'sql-migration':
        return extractSqlMigration(file, content);
      case 'openapi':
        return extractOpenApi(file, content);
      case 'package-json':
        return extractPackageJson(file, content);
      default:
        return empty();
    }
  } catch {
    // A parser bug or pathological input must degrade to "no information",
    // never to a failed scan.
    return empty();
  }
}
