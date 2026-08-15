/**
 * Environment-variable artifact extraction.
 *
 * ## Why this exists
 *
 * A code graph answers "what calls what". It cannot answer the question that
 * actually breaks deploys: **"which environment variables does this code path
 * need, and does anything actually declare them?"**
 *
 * Env vars are the classic invisible dependency. They are read deep inside a
 * module (`process.env.STRIPE_WEBHOOK_SECRET`), declared — if at all — in a
 * completely unrelated file (`.env.example`, a Helm chart, a GitHub Actions
 * workflow), and there is no import edge, no call edge and no type between the
 * two. Nothing in a call graph connects them. So the failure mode is always the
 * same: it worked locally because the developer had the value in their untracked
 * `.env`, and it 500s in production because nothing in the repo ever declared it.
 *
 * {@link summarizeEnvVars} exists to surface exactly that: the `undeclared`
 * flag. Everything else in this module is plumbing to make that flag trustworthy
 * across the polyglot reality of a real repo.
 *
 * ## Design notes
 *
 * - Purely lexical. No parsing, no I/O, no language servers. Callers hand us a
 *   path and its contents; we hand back references. That makes it cheap enough
 *   to run over every file in a scan.
 * - Every regex here is anchored and uses character classes with a single
 *   quantifier — no nested quantifiers, no alternation inside a repetition —
 *   so none of them can backtrack catastrophically on adversarial input.
 * - Line comments are masked before matching (see {@link maskComments}) so we
 *   do not report env vars from commented-out code.
 */

// ─── Public types ─────────────────────────────────────────────────────────────

/** A single occurrence of an environment variable being read or declared. */
export interface EnvVarRef {
  /** The variable name, e.g. `STRIPE_WEBHOOK_SECRET`. */
  name: string;
  /** The file the reference was found in, exactly as passed to the extractor. */
  file: string;
  /** 1-based line number. */
  line: number;
  /** `read` = the code consumes it; `declared` = some config file defines it. */
  kind: 'read' | 'declared';
  /**
   * A short, stable token describing *how* it was matched, e.g. `process.env`
   * or `dockerfile-env`. Useful for explaining a finding to a human and for
   * filtering out sources a given consumer does not trust.
   */
  source: string;
}

/** All references to one variable name, rolled up across the repo. */
export interface EnvVarSummary {
  name: string;
  /** Deduped, sorted list of files that read the variable. */
  readBy: string[];
  /** Deduped, sorted list of files that declare the variable. */
  declaredIn: string[];
  /** Declared nowhere but read somewhere — the classic "worked locally" bug. */
  undeclared: boolean;
}

// ─── Source tokens ────────────────────────────────────────────────────────────

/**
 * Stable identifiers for the syntax that produced a reference.
 *
 * `terraform-variable` is deliberately distinct: a `variable "foo" {}` block in
 * Terraform declares an *input variable for the Terraform module*, not an
 * environment variable for a process. It is included because in practice such a
 * variable is very often piped straight into a container's environment (via
 * `TF_VAR_foo` or an `environment` block), so it is a strong hint about where a
 * value comes from — but it must never be conflated with a real process-level
 * declaration. Consumers that want strict semantics should filter it out.
 */
export const ENV_SOURCES = {
  processEnv: 'process.env',
  importMetaEnv: 'import.meta.env',
  denoEnv: 'Deno.env.get',
  osEnviron: 'os.environ',
  osEnvironGet: 'os.environ.get',
  osGetenv: 'os.getenv',
  goGetenv: 'os.Getenv',
  goLookupEnv: 'os.LookupEnv',
  rubyEnvIndex: 'ENV[]',
  rubyEnvFetch: 'ENV.fetch',
  shellExpansion: 'shell-expansion',
  shellAssignment: 'shell-assignment',
  javaGetenv: 'System.getenv',
  dotenv: 'dotenv',
  dockerfile: 'dockerfile-env',
  dockerCompose: 'docker-compose-environment',
  kubernetes: 'kubernetes-env',
  githubActions: 'github-actions-env',
  terraform: 'terraform-variable',
} as const;

// ─── File classification ──────────────────────────────────────────────────────

/** The dialect we will apply to a file, inferred from its path. */
export type EnvFileKind =
  | 'js'
  | 'python'
  | 'go'
  | 'ruby'
  | 'shell'
  | 'java'
  | 'dotenv'
  | 'dockerfile'
  | 'docker-compose'
  | 'kubernetes'
  | 'github-actions'
  | 'terraform'
  | 'unknown';

function basenameOf(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const idx = normalized.lastIndexOf('/');
  return idx === -1 ? normalized : normalized.slice(idx + 1);
}

const JS_EXTENSIONS = new Set(['js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'mts', 'cts', 'svelte', 'vue']);
const SHELL_EXTENSIONS = new Set(['sh', 'bash', 'zsh', 'ksh', 'fish']);
const JAVA_EXTENSIONS = new Set(['java', 'kt', 'kts', 'scala']);

/**
 * Infer which extraction dialect applies to a path.
 *
 * Exported because callers frequently want to pre-filter a scan to files we can
 * actually say something about, rather than running the extractor over binaries.
 */
export function detectEnvFileKind(filePath: string): EnvFileKind {
  const normalized = filePath.replace(/\\/g, '/').toLowerCase();
  const base = basenameOf(normalized);

  // `.env`, `.env.example`, `.env.sample`, `.env.local`, `.env.production`, …
  if (/^\.env(\.[\w.-]+)?$/.test(base)) return 'dotenv';
  if (/^dockerfile(\.[\w.-]+)?$/.test(base) || /\.dockerfile$/.test(base)) return 'dockerfile';
  if (/^(docker-)?compose(\.[\w-]+)?\.ya?ml$/.test(base)) return 'docker-compose';
  if (normalized.includes('.github/workflows/') && /\.ya?ml$/.test(base)) return 'github-actions';
  if (/\.ya?ml$/.test(base)) return 'kubernetes';
  if (/\.tf(vars)?$/.test(base)) return 'terraform';

  const dot = base.lastIndexOf('.');
  const ext = dot === -1 ? '' : base.slice(dot + 1);
  if (JS_EXTENSIONS.has(ext)) return 'js';
  if (ext === 'py' || ext === 'pyi') return 'python';
  if (ext === 'go') return 'go';
  if (ext === 'rb' || ext === 'rake') return 'ruby';
  if (SHELL_EXTENSIONS.has(ext)) return 'shell';
  if (JAVA_EXTENSIONS.has(ext)) return 'java';
  return 'unknown';
}

/** Comment syntax used by each dialect, for cheap comment masking. */
function commentStyleFor(kind: EnvFileKind): { line: string | null; block: boolean } {
  switch (kind) {
    case 'js':
    case 'go':
    case 'java':
      return { line: '//', block: true };
    case 'terraform':
      // HCL supports `#`, `//` and `/* */`; `#` is the idiomatic one and the
      // one that matters for us since we only read `variable` blocks.
      return { line: '#', block: true };
    case 'python':
    case 'ruby':
    case 'shell':
    case 'dotenv':
    case 'dockerfile':
    case 'docker-compose':
    case 'kubernetes':
    case 'github-actions':
      return { line: '#', block: false };
    default:
      return { line: null, block: false };
  }
}

/**
 * Replace comment bodies with spaces, preserving byte offsets and line breaks.
 *
 * Offsets are preserved so that line numbers computed from the masked string
 * are identical to line numbers in the original. String literals are respected
 * so that `"https://example.com"` or `# ` inside a quoted YAML value are not
 * mistaken for comments. This is intentionally a cheap scanner, not a lexer:
 * the instruction is to skip comments *where cheaply detectable*.
 */
function maskComments(content: string, style: { line: string | null; block: boolean }): string {
  if (style.line === null && !style.block) return content;
  const out = content.split('');
  const marker = style.line;
  let i = 0;
  let quote: string | null = null;

  while (i < content.length) {
    const ch = content[i] ?? '';
    if (quote !== null) {
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      // An unterminated single/double quote must not swallow the whole file.
      else if (ch === '\n' && quote !== '`') quote = null;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      i++;
      continue;
    }
    if (style.block && ch === '/' && content[i + 1] === '*') {
      let j = i + 2;
      while (j < content.length && !(content[j] === '*' && content[j + 1] === '/')) j++;
      const end = Math.min(j + 2, content.length);
      for (let k = i; k < end; k++) if (out[k] !== '\n') out[k] = ' ';
      i = end;
      continue;
    }
    if (marker !== null && content.startsWith(marker, i)) {
      let j = i;
      while (j < content.length && content[j] !== '\n') {
        out[j] = ' ';
        j++;
      }
      i = j;
      continue;
    }
    i++;
  }
  return out.join('');
}

// ─── Read patterns ────────────────────────────────────────────────────────────

interface ReadPattern {
  readonly re: RegExp;
  readonly source: string;
}

/**
 * Read patterns per dialect.
 *
 * Each pattern captures the variable name in group 1. Quoted forms use
 * `[^'"\n]+` (a negated class with one quantifier) rather than `.+?`, which
 * keeps them linear-time and stops them running across lines.
 */
const READ_PATTERNS: Readonly<Record<EnvFileKind, readonly ReadPattern[]>> = {
  js: [
    { re: /process\s*\.\s*env\s*\.\s*([A-Za-z_$][A-Za-z0-9_$]*)/g, source: ENV_SOURCES.processEnv },
    { re: /process\s*\.\s*env\s*\[\s*['"]([^'"\n]+)['"]\s*\]/g, source: ENV_SOURCES.processEnv },
    { re: /import\s*\.\s*meta\s*\.\s*env\s*\.\s*([A-Za-z_$][A-Za-z0-9_$]*)/g, source: ENV_SOURCES.importMetaEnv },
    { re: /import\s*\.\s*meta\s*\.\s*env\s*\[\s*['"]([^'"\n]+)['"]\s*\]/g, source: ENV_SOURCES.importMetaEnv },
    { re: /Deno\s*\.\s*env\s*\.\s*get\s*\(\s*['"]([^'"\n]+)['"]/g, source: ENV_SOURCES.denoEnv },
  ],
  python: [
    { re: /os\s*\.\s*environ\s*\[\s*['"]([^'"\n]+)['"]\s*\]/g, source: ENV_SOURCES.osEnviron },
    { re: /(?:os\s*\.\s*)?environ\s*\.\s*get\s*\(\s*['"]([^'"\n]+)['"]/g, source: ENV_SOURCES.osEnvironGet },
    { re: /os\s*\.\s*getenv\s*\(\s*['"]([^'"\n]+)['"]/g, source: ENV_SOURCES.osGetenv },
  ],
  go: [
    { re: /os\s*\.\s*Getenv\s*\(\s*"([^"\n]+)"/g, source: ENV_SOURCES.goGetenv },
    { re: /os\s*\.\s*LookupEnv\s*\(\s*"([^"\n]+)"/g, source: ENV_SOURCES.goLookupEnv },
  ],
  ruby: [
    { re: /\bENV\s*\[\s*['"]([^'"\n]+)['"]\s*\]/g, source: ENV_SOURCES.rubyEnvIndex },
    { re: /\bENV\s*\.\s*fetch\s*\(\s*['"]([^'"\n]+)['"]/g, source: ENV_SOURCES.rubyEnvFetch },
  ],
  java: [{ re: /System\s*\.\s*getenv\s*\(\s*"([^"\n]+)"/g, source: ENV_SOURCES.javaGetenv }],
  shell: [
    // See SHELL_NAME_RULE below for why these are so restrictive.
    { re: /\$\{([A-Z_][A-Z0-9_]+)[:\-#%}]/g, source: ENV_SOURCES.shellExpansion },
    { re: /\$([A-Z_][A-Z0-9_]+)/g, source: ENV_SOURCES.shellExpansion },
  ],
  dotenv: [],
  dockerfile: [],
  'docker-compose': [],
  kubernetes: [],
  'github-actions': [],
  terraform: [],
  unknown: [],
};

/**
 * SHELL_NAME_RULE — why shell reads are restricted to `[A-Z_][A-Z0-9_]+`.
 *
 * In shell there is no syntactic difference between reading an environment
 * variable and reading a local one: `$foo` and `$DATABASE_URL` are the same
 * construct. If we matched every `$name` we would report every loop counter,
 * every `$i`, `$f`, `$tmp` and `$line` in the repo as an environment variable
 * and the `undeclared` signal would be pure noise.
 *
 * So we only accept names that are **all uppercase letters, digits and
 * underscores, and at least two characters long**. That is the near-universal
 * convention for exported/environment variables in shell, and the two-character
 * minimum drops `$A`, `$X`, `$N` style scratch variables. The cost is that a
 * lowercase env var read from shell is missed; that is the right trade, because
 * a false negative here is invisible while a false positive actively poisons
 * the `undeclared` report.
 *
 * Positional params (`$1`), specials (`$@`, `$?`, `$#`) and lowercase locals are
 * all excluded by construction.
 */
export const SHELL_NAME_PATTERN = /^[A-Z_][A-Z0-9_]+$/;

// ─── Declaration patterns ─────────────────────────────────────────────────────

const DOTENV_LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/;
const DOCKERFILE_ENV = /^\s*ENV\s+(\S[^\n]*)$/i;
const DOCKERFILE_PAIR = /(?:^|\s)([A-Za-z_][A-Za-z0-9_]*)=/g;
const DOCKERFILE_BARE = /^([A-Za-z_][A-Za-z0-9_]*)\s+\S/;
const TERRAFORM_VARIABLE = /^\s*variable\s+"([A-Za-z_][A-Za-z0-9_-]*)"\s*\{?/;

const YAML_ENVIRONMENT_KEY = /^(\s*)environment\s*:/;
const YAML_ENV_KEY = /^(\s*)env\s*:/;
const YAML_LIST_ENTRY = /^\s*-\s*(?:['"]?)([A-Za-z_][A-Za-z0-9_]*)(?:['"]?)\s*(?:[=:]|$)/;
const YAML_MAP_ENTRY = /^\s*(?:['"]?)([A-Za-z_][A-Za-z0-9_]*)(?:['"]?)\s*:/;
const YAML_NAME_ENTRY = /^\s*-\s*name\s*:\s*(?:['"]?)([A-Za-z_][A-Za-z0-9_]*)(?:['"]?)\s*$/;

function indentOf(line: string): number {
  const m = /^[ \t]*/.exec(line);
  return m?.[0]?.length ?? 0;
}

function isBlank(line: string): boolean {
  return line.trim().length === 0;
}

// ─── Extraction ───────────────────────────────────────────────────────────────

/**
 * Extract every environment-variable reference from one file.
 *
 * The dialect is inferred from `filePath`, so the caller never has to say what
 * kind of file this is — which matters because the whole point is to run this
 * over an entire heterogeneous repo in one pass.
 *
 * Returns references in file order. Duplicate references to the same name on
 * different lines are all returned; deduplication is {@link summarizeEnvVars}'s
 * job, because line-level detail is what makes a finding actionable.
 */
export function extractEnvRefs(filePath: string, content: string): EnvVarRef[] {
  if (content.length === 0) return [];
  const kind = detectEnvFileKind(filePath);
  const masked = maskComments(content, commentStyleFor(kind));
  const lines = masked.split('\n');

  const refs: EnvVarRef[] = [];
  const push = (name: string, line: number, refKind: EnvVarRef['kind'], source: string): void => {
    refs.push({ name, file: filePath, line, kind: refKind, source });
  };

  // ── Shell-local assignments count as declarations ──
  //
  // `ACTION=deploy` followed by `$ACTION` is a variable the script sets
  // itself, not a missing environment variable. Without this, every
  // well-written shell script reports its own locals as undeclared — which on
  // this repository was most of the 48 false positives.
  if (kind === 'shell') {
    const assignment = /^\s*(?:export\s+|readonly\s+|local\s+|declare\s+(?:-\w+\s+)?)?([A-Z_][A-Z0-9_]*)=/;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      if (/^\s*#/.test(line)) continue;
      const m = assignment.exec(line);
      const name = m?.[1];
      if (name !== undefined && SHELL_NAME_PATTERN.test(name)) {
        push(name, i + 1, 'declared', ENV_SOURCES.shellAssignment);
      }
    }
  }

  // ── Reads ──
  const patterns = READ_PATTERNS[kind];
  for (const { re, source } of patterns) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(line)) !== null) {
        const name = m[1];
        if (name === undefined) continue;
        if (kind === 'shell' && !SHELL_NAME_PATTERN.test(name)) continue;
        push(name, i + 1, 'read', source);
        if (m.index === re.lastIndex) re.lastIndex++;
      }
    }
  }

  // ── Declarations ──
  switch (kind) {
    case 'dotenv':
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? '';
        if (isBlank(line)) continue;
        const m = DOTENV_LINE.exec(line);
        const name = m?.[1];
        if (name !== undefined) push(name, i + 1, 'declared', ENV_SOURCES.dotenv);
      }
      break;

    case 'dockerfile':
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? '';
        const m = DOCKERFILE_ENV.exec(line);
        const rest = m?.[1];
        if (rest === undefined) continue;
        if (rest.includes('=')) {
          // `ENV A=1 B=2` — one declaration per key.
          DOCKERFILE_PAIR.lastIndex = 0;
          let p: RegExpExecArray | null;
          while ((p = DOCKERFILE_PAIR.exec(rest)) !== null) {
            const name = p[1];
            if (name !== undefined) push(name, i + 1, 'declared', ENV_SOURCES.dockerfile);
          }
        } else {
          // Legacy `ENV NAME value` form.
          const bare = DOCKERFILE_BARE.exec(rest.trim());
          const name = bare?.[1];
          if (name !== undefined) push(name, i + 1, 'declared', ENV_SOURCES.dockerfile);
        }
      }
      break;

    case 'docker-compose': {
      let blockIndent: number | null = null;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? '';
        if (isBlank(line)) continue;
        const indent = indentOf(line);
        if (blockIndent !== null && indent <= blockIndent) blockIndent = null;

        const start = YAML_ENVIRONMENT_KEY.exec(line);
        if (start !== null) {
          blockIndent = (start[1] ?? '').length;
          continue;
        }
        if (blockIndent === null) continue;

        // Both `- NAME=value` / `- NAME` list form and `NAME: value` map form.
        const listed = YAML_LIST_ENTRY.exec(line);
        const listedName = listed?.[1];
        if (listedName !== undefined) {
          push(listedName, i + 1, 'declared', ENV_SOURCES.dockerCompose);
          continue;
        }
        const mapped = YAML_MAP_ENTRY.exec(line);
        const mappedName = mapped?.[1];
        if (mappedName !== undefined) push(mappedName, i + 1, 'declared', ENV_SOURCES.dockerCompose);
      }
      break;
    }

    case 'kubernetes': {
      // K8s puts env vars in a list of `{ name, value }` objects. The list items
      // are commonly at the *same* indent as the `env:` key, so the block only
      // ends on a strict dedent or on a non-list line at the key's indent.
      let blockIndent: number | null = null;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? '';
        if (isBlank(line)) continue;
        const indent = indentOf(line);
        const isListItem = /^\s*-\s/.test(line);
        if (blockIndent !== null && (indent < blockIndent || (indent === blockIndent && !isListItem))) {
          blockIndent = null;
        }

        const start = YAML_ENV_KEY.exec(line);
        if (start !== null) {
          blockIndent = (start[1] ?? '').length;
          continue;
        }
        if (blockIndent === null) continue;

        const named = YAML_NAME_ENTRY.exec(line);
        const name = named?.[1];
        if (name !== undefined) push(name, i + 1, 'declared', ENV_SOURCES.kubernetes);
      }
      break;
    }

    case 'github-actions': {
      let blockIndent: number | null = null;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? '';
        if (isBlank(line)) continue;
        const indent = indentOf(line);
        if (blockIndent !== null && indent <= blockIndent) blockIndent = null;

        const start = YAML_ENV_KEY.exec(line);
        if (start !== null) {
          blockIndent = (start[1] ?? '').length;
          continue;
        }
        if (blockIndent === null) continue;

        const mapped = YAML_MAP_ENTRY.exec(line);
        const name = mapped?.[1];
        if (name !== undefined) push(name, i + 1, 'declared', ENV_SOURCES.githubActions);
      }
      break;
    }

    case 'terraform':
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? '';
        const m = TERRAFORM_VARIABLE.exec(line);
        const name = m?.[1];
        // NOTE: a Terraform `variable` is an input to the TF module, not a
        // process environment variable. It is recorded with its own `source`
        // so consumers can treat it as the weaker signal it is.
        if (name !== undefined) push(name, i + 1, 'declared', ENV_SOURCES.terraform);
      }
      break;

    default:
      break;
  }

  refs.sort((a, b) => a.line - b.line);
  return refs;
}

// ─── Summarisation ────────────────────────────────────────────────────────────

/**
 * Roll references up by variable name.
 *
 * This is the payload. `undeclared: true` means *"some code path needs this
 * value and nothing in the repository declares it"* — the single most common
 * production surprise, and one that is structurally invisible to a call graph
 * because there is no edge between the reader and the (missing) declaration.
 *
 * Files are deduped and sorted so the output is deterministic and diffable;
 * the result array is sorted by name for the same reason.
 */
/**
 * Variables the runtime provides, which no repository declares.
 *
 * Without this list almost every read looks undeclared: a scan of this
 * repository reported 48 of 50 variables as missing, including CI, HOME and
 * the editor-provided project directory. A signal that fires on everything is
 * not a signal, and the one genuinely missing variable would be invisible
 * among the noise.
 */
export const RUNTIME_PROVIDED_ENV_VARS: ReadonlySet<string> = new Set([
  // POSIX and shell
  'HOME', 'PATH', 'PWD', 'OLDPWD', 'SHELL', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'TERM',
  'TMPDIR', 'TEMP', 'TMP', 'HOSTNAME', 'EDITOR', 'PAGER', 'SHLVL', 'IFS', 'PS1', 'RANDOM',
  // Bash builtins the shell maintains itself
  'SECONDS', 'LINENO', 'BASH', 'BASH_SOURCE', 'BASH_VERSION', 'BASHPID', 'FUNCNAME',
  'PIPESTATUS', 'REPLY', 'OPTARG', 'OPTIND', 'PPID', 'UID', 'EUID', 'GROUPS', 'COLUMNS',
  // Node and package managers
  'NODE_ENV', 'NODE_OPTIONS', 'NODE_PATH', 'npm_config_registry', 'npm_lifecycle_event',
  'npm_package_version', 'PNPM_HOME', 'INIT_CWD', 'FORCE_COLOR', 'NO_COLOR', 'DEBUG',
  // CI providers
  'CI', 'GITHUB_ACTIONS', 'GITHUB_TOKEN', 'GITHUB_WORKSPACE', 'GITHUB_REPOSITORY',
  'GITHUB_SHA', 'GITHUB_REF', 'GITHUB_ENV', 'GITHUB_OUTPUT', 'GITHUB_EVENT_NAME',
  'RUNNER_OS', 'RUNNER_TEMP', 'GITLAB_CI', 'CIRCLECI', 'JENKINS_URL', 'BUILDKITE',
  // Agent runtimes
  'CLAUDE_PROJECT_DIR', 'CLAUDE_PLUGIN_ROOT', 'CLAUDE_PLUGIN_DATA', 'CLAUDE_ENV_FILE',
  'DEVIN_PROJECT_DIR', 'CURSOR_PROJECT_DIR', 'ACP_BACKEND', 'WINDSURF_API_KEY',
]);

export function summarizeEnvVars(refs: EnvVarRef[]): EnvVarSummary[] {
  const reads = new Map<string, Set<string>>();
  const declarations = new Map<string, Set<string>>();

  for (const ref of refs) {
    const bucket = ref.kind === 'read' ? reads : declarations;
    let files = bucket.get(ref.name);
    if (files === undefined) {
      files = new Set<string>();
      bucket.set(ref.name, files);
    }
    files.add(ref.file);
  }

  const names = new Set<string>([...reads.keys(), ...declarations.keys()]);
  const summaries: EnvVarSummary[] = [];
  for (const name of names) {
    const readBy = [...(reads.get(name) ?? [])].sort();
    const declaredIn = [...(declarations.get(name) ?? [])].sort();
    summaries.push({
      name,
      readBy,
      declaredIn,
      // A variable the runtime supplies is not missing just because the
      // repository does not declare it. See RUNTIME_PROVIDED_ENV_VARS.
      undeclared:
        readBy.length > 0 && declaredIn.length === 0 && !RUNTIME_PROVIDED_ENV_VARS.has(name),
    });
  }

  summaries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return summaries;
}
