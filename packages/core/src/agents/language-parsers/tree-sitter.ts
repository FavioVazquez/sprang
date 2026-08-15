import { createRequire } from 'node:module';
import type { ParsedSymbols } from './index.js';

/**
 * AST-based symbol extraction, as an optional upgrade over the regex parsers.
 *
 * The regex parsers are the floor and stay the floor: they work on a bare
 * `git clone` with no toolchain, no build and no language server, which is a
 * property worth protecting. But they are line-oriented, so they miss anything
 * spanning lines, they match inside strings and comments, and they cannot see
 * nesting. Both comparable tools in this space use tree-sitter, and every
 * downstream metric — call edges, blast radius, coupling, dead code — is capped
 * by the quality of the parse beneath it.
 *
 * So: try tree-sitter, fall back to regex, and record which one ran in the
 * node's `parser` field. An explicit fallback is fine; a silent one is not.
 *
 * Loading is lazy and failure is non-fatal. A missing WASM file, an
 * incompatible ABI or a platform without WebAssembly all degrade to regex
 * rather than failing the scan.
 */

/** Grammar file names in `tree-sitter-wasms/out`, keyed by Sprang's language id. */
const GRAMMARS: Record<string, string> = {
  typescript: 'tree-sitter-typescript',
  javascript: 'tree-sitter-javascript',
  python: 'tree-sitter-python',
  go: 'tree-sitter-go',
  rust: 'tree-sitter-rust',
  java: 'tree-sitter-java',
  kotlin: 'tree-sitter-kotlin',
  ruby: 'tree-sitter-ruby',
  php: 'tree-sitter-php',
  c: 'tree-sitter-c',
  cpp: 'tree-sitter-cpp',
  csharp: 'tree-sitter-c_sharp',
  bash: 'tree-sitter-bash',
};

/**
 * Node types that declare a function, per grammar.
 *
 * Kept as data rather than per-language code because the shape of the work is
 * identical for every language: find declaration nodes, read their name field.
 */
const FUNCTION_NODES: Record<string, string[]> = {
  typescript: ['function_declaration', 'method_definition', 'generator_function_declaration'],
  javascript: ['function_declaration', 'method_definition', 'generator_function_declaration'],
  python: ['function_definition'],
  go: ['function_declaration', 'method_declaration'],
  // `function_signature_item` is a method declared in a trait with no body —
  // the interface of the trait, and exactly what callers depend on.
  rust: ['function_item', 'function_signature_item'],
  java: ['method_declaration', 'constructor_declaration'],
  kotlin: ['function_declaration'],
  ruby: ['method', 'singleton_method'],
  php: ['function_definition', 'method_declaration'],
  c: ['function_definition'],
  cpp: ['function_definition'],
  csharp: ['method_declaration', 'constructor_declaration', 'local_function_statement'],
  bash: ['function_definition'],
};

const CLASS_NODES: Record<string, string[]> = {
  typescript: ['class_declaration', 'interface_declaration', 'enum_declaration', 'type_alias_declaration'],
  javascript: ['class_declaration'],
  python: ['class_definition'],
  go: ['type_declaration'],
  // `impl_item` is deliberately absent: an impl block is not a type
  // declaration, and including it emits a duplicate node for the struct it
  // implements.
  rust: ['struct_item', 'enum_item', 'trait_item', 'union_item'],
  java: ['class_declaration', 'interface_declaration', 'enum_declaration', 'record_declaration'],
  kotlin: ['class_declaration', 'object_declaration'],
  ruby: ['class', 'module'],
  php: ['class_declaration', 'interface_declaration', 'trait_declaration'],
  c: ['struct_specifier', 'union_specifier'],
  cpp: ['class_specifier', 'struct_specifier'],
  csharp: ['class_declaration', 'interface_declaration', 'record_declaration', 'struct_declaration'],
  bash: [],
};

interface TSNode {
  type: string;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  text: string;
  namedChildCount: number;
  namedChild(i: number): TSNode | null;
  childForFieldName(name: string): TSNode | null;
}

interface TSTree {
  rootNode: TSNode;
  delete?: () => void;
}

interface TSParser {
  setLanguage(lang: unknown): void;
  parse(source: string): TSTree | null;
  delete?: () => void;
}

let initPromise: Promise<boolean> | null = null;
let ParserCtor: (new () => TSParser) & {
  init(): Promise<void>;
  Language: { load(path: string): Promise<unknown> };
} | null = null;

const languageCache = new Map<string, unknown>();
/** Languages that failed to load; never retried, so one bad grammar is cheap. */
const failed = new Set<string>();

/** Is tree-sitter usable in this process? Resolved once, cached forever. */
export async function treeSitterAvailable(): Promise<boolean> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    try {
      const mod = (await import('web-tree-sitter')) as unknown as Record<string, unknown>;
      const candidate = (mod['Parser'] ?? mod['default'] ?? mod) as typeof ParserCtor;
      if (!candidate || typeof candidate.init !== 'function') return false;
      await candidate.init();
      ParserCtor = candidate;
      return true;
    } catch {
      return false;
    }
  })();
  return initPromise;
}

async function loadLanguage(lang: string): Promise<unknown | null> {
  if (failed.has(lang)) return null;
  const cached = languageCache.get(lang);
  if (cached) return cached;

  const grammar = GRAMMARS[lang];
  if (!grammar || !ParserCtor) {
    failed.add(lang);
    return null;
  }
  try {
    const require = createRequire(import.meta.url);
    const wasmPath = require.resolve(`tree-sitter-wasms/out/${grammar}.wasm`);
    const language = await ParserCtor.Language.load(wasmPath);
    languageCache.set(lang, language);
    return language;
  } catch {
    failed.add(lang);
    return null;
  }
}

/** Walk named nodes, calling `visit` on each. Iterative: deep files overflow a
 *  recursive walk, and minified or generated files are very deep. */
function walk(root: TSNode, visit: (node: TSNode) => void): void {
  const stack: TSNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    visit(node);
    for (let i = node.namedChildCount - 1; i >= 0; i--) {
      const child = node.namedChild(i);
      if (child) stack.push(child);
    }
  }
}

/** Best-effort name for a declaration node. */
function nameOf(node: TSNode): string | null {
  const named = node.childForFieldName('name');
  if (named?.text) return named.text;

  // C and C++ nest the identifier inside a declarator, sometimes several deep
  // for pointer returns: `char *greet(void)` is declarator(declarator(ident)).
  let declarator = node.childForFieldName('declarator');
  for (let depth = 0; declarator && depth < 5; depth++) {
    const inner = declarator.childForFieldName('declarator');
    const inlineName = declarator.childForFieldName('name');
    if (inlineName?.text) return inlineName.text;
    if (!inner) break;
    if (inner.type === 'identifier' || inner.type === 'field_identifier') return inner.text;
    declarator = inner;
  }
  if (declarator?.type === 'identifier') return declarator.text;
  // Rust `impl` blocks and C struct specifiers put the name in `type`.
  const typeField = node.childForFieldName('type');
  if (typeField?.text) return typeField.text;
  // Go groups declarations: `type ( A struct{}; B struct{} )`.
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (child?.type === 'type_spec') {
      const n = child.childForFieldName('name');
      if (n?.text) return n.text;
    }
  }
  return null;
}

/**
 * Parse with tree-sitter, or return null so the caller falls back to regex.
 *
 * Returning null rather than an empty result is deliberate: an empty
 * `ParsedSymbols` is indistinguishable from "this file genuinely has no
 * symbols", and silently reporting a parse failure as an empty file is how a
 * language ends up looking supported while producing nothing.
 */
export async function parseWithTreeSitter(
  lang: string,
  source: string,
): Promise<ParsedSymbols | null> {
  if (!GRAMMARS[lang]) return null;
  if (!(await treeSitterAvailable())) return null;

  const language = await loadLanguage(lang);
  if (!language || !ParserCtor) return null;

  let parser: TSParser | null = null;
  let tree: TSTree | null = null;
  try {
    parser = new ParserCtor();
    parser.setLanguage(language);
    tree = parser.parse(source);
    if (!tree) return null;

    const fnTypes = new Set(FUNCTION_NODES[lang] ?? []);
    const clsTypes = new Set(CLASS_NODES[lang] ?? []);
    const functions: ParsedSymbols['functions'] = [];
    const classes: ParsedSymbols['classes'] = [];

    walk(tree.rootNode, (node) => {
      if (fnTypes.has(node.type)) {
        const name = nameOf(node);
        if (!name) return;
        const text = node.text.slice(0, 200);
        functions.push({
          name,
          startLine: node.startPosition.row + 1,
          // No universal notion of "exported"; approximate per family. Private
          // by convention (leading underscore) is the widest signal there is.
          exported: !name.startsWith('_') && !/\bprivate\b/.test(text),
          isAsync: /\basync\b|\bsuspend\b/.test(text),
        });
        return;
      }
      if (clsTypes.has(node.type)) {
        const name = nameOf(node);
        if (!name) return;
        classes.push({
          name,
          startLine: node.startPosition.row + 1,
          exported: !name.startsWith('_'),
        });
      }
    });

    return { functions, classes };
  } catch {
    return null;
  } finally {
    try {
      tree?.delete?.();
      parser?.delete?.();
    } catch {
      /* freeing WASM memory is best-effort */
    }
  }
}

/** Languages this backend can handle, for the provenance registry. */
export function treeSitterLanguages(): string[] {
  return Object.keys(GRAMMARS);
}
