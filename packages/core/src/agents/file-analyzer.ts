import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ensureDir } from '../utils/fs.js';
import type {
  KnowledgeGraph,
  ScanResult,
  SprangNode,
  SprangEdge,
  FileAnalysis,
  FunctionRecord,
  ClassRecord,
  DetectedPattern,
} from '../schema/types.js';
import { BaseAgent } from './base.js';
import type { AgentContext, AgentResult } from './base.js';
import { writeFileAtomic } from '../utils/fs.js';
import { resolveLanguageImport } from './project-scanner.js';
import { parseSymbols } from './language-parsers/index.js';

function complexityFromLoc(loc: number): 'simple' | 'moderate' | 'complex' {
  if (loc < 20) return 'simple';
  if (loc < 80) return 'moderate';
  return 'complex';
}

interface SymbolMatch {
  name: string;
  startLine: number;
}

function findFunctions(source: string): Array<SymbolMatch & { exported: boolean; isAsync: boolean }> {
  const lines = source.split('\n');
  const results: Array<SymbolMatch & { exported: boolean; isAsync: boolean }> = [];
  const seen = new Set<string>();

  // Named function declarations
  {
    const re = /^(export\s+)?(async\s+)?function\s+(\w+)\s*\(/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) {
      const name = m[3];
      if (!name || seen.has(name)) continue;
      seen.add(name);
      // Count line number from offset
      const linesBefore = source.slice(0, m.index).split('\n').length - 1;
      results.push({
        name,
        startLine: linesBefore + 1,
        exported: m[1] !== undefined,
        isAsync: m[2] !== undefined,
      });
    }
  }

  // Arrow functions (with parens)
  {
    const re = /^(export\s+)?(const|let|var)\s+(\w+)\s*=\s*(async\s+)?\(([^)]*)\)\s*(?::\s*[^=>{]+?)?\s*=>/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) {
      const name = m[3];
      if (!name || seen.has(name)) continue;
      seen.add(name);
      const linesBefore = source.slice(0, m.index).split('\n').length - 1;
      results.push({
        name,
        startLine: linesBefore + 1,
        exported: m[1] !== undefined,
        isAsync: m[4] !== undefined,
      });
    }
  }

  return results;
}

function findClasses(source: string): Array<SymbolMatch & { exported: boolean }> {
  const results: Array<SymbolMatch & { exported: boolean }> = [];
  const seen = new Set<string>();
  const re = /(export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+(\w+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const name = m[2];
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const linesBefore = source.slice(0, m.index).split('\n').length - 1;
    results.push({
      name,
      startLine: linesBefore + 1,
      exported: m[1] !== undefined,
    });
  }
  return results;
}

function detectPatterns(source: string): DetectedPattern[] {
  const patterns: DetectedPattern[] = [];

  // Singleton: private constructor + static instance field
  if (/private\s+(?:static\s+)?(?:readonly\s+)?instance\s*[:=]/i.test(source) ||
      (/private\s+constructor\s*\(/.test(source) && /static\s+\w*instance\w*/i.test(source))) {
    patterns.push('singleton');
  }

  // Factory: function/method named create* or make* returning an object type
  if (/(?:function|static)\s+(?:create|make|build)\w*\s*\(/i.test(source)) {
    patterns.push('factory');
  }

  // Observer/EventEmitter: subscribe/unsubscribe/emit patterns
  if (/(?:addEventListener|\.on\(|\.subscribe\(|\.emit\(|EventEmitter)/i.test(source)) {
    patterns.push('observer');
  }

  // React hook: exported function starting with use + hook usage
  if (/export\s+(?:function|const)\s+use[A-Z]\w+/.test(source) &&
      /use(?:State|Effect|Ref|Memo|Callback|Context|Reducer)\s*\(/.test(source)) {
    patterns.push('react_hook');
  }

  // Strategy: interface/abstract class with multiple implementations
  if (/(?:implements\s+\w+Strategy|interface\s+\w+Strategy)/i.test(source)) {
    patterns.push('strategy');
  }

  // Dependency injection: constructor with multiple typed parameters (common DI pattern)
  if (/constructor\s*\(\s*(?:private|readonly|public)\s+\w+\s*:\s*\w+[^)]*,\s*(?:private|readonly|public)/.test(source)) {
    patterns.push('dependency_injection');
  }

  // React Context Provider: createContext + a <Something.Provider> or .Provider usage
  if (/createContext\s*[(<]/.test(source) &&
      /\.\s*Provider\b/.test(source)) {
    patterns.push('context_provider');
  }

  // Decorator: a capitalized decorator applied on its own line above a class/method
  // (e.g. @Injectable, @Component, @Module) — distinct from emails or JSDoc @param.
  if (/(?:^|\n)\s*@[A-Z]\w*(?:\([^)]*\))?\s*(?:\n|$)/.test(source)) {
    patterns.push('decorator');
  }

  // EventEmitter: extending or instantiating an emitter class
  if (/(?:extends\s+\w*EventEmitter|new\s+\w*EventEmitter\s*\(|extends\s+\w+Emitter\b)/.test(source)) {
    patterns.push('event_emitter');
  }

  return [...new Set(patterns)];
}

// ─── Function call-graph extraction ───────────────────────────────────

/** JS/TS keywords and globals that look like calls but are not user functions. */
const CALL_STOPWORDS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'super',
  'typeof', 'instanceof', 'new', 'await', 'yield', 'void', 'delete', 'in', 'of',
  'console', 'require', 'import', 'parseInt', 'parseFloat', 'String', 'Number',
  'Boolean', 'Array', 'Object', 'JSON', 'Math', 'Date', 'Promise', 'Set', 'Map',
  'Symbol', 'RegExp', 'Error', 'isNaN', 'isFinite', 'setTimeout', 'setInterval',
]);

/**
 * Extract the names of functions invoked inside a body of source.
 * Matches `name(` and `obj.method(` call sites, filtering out keywords.
 * Returns a frequency map of callee name → call count.
 */
function extractCallSites(body: string): Map<string, number> {
  const calls = new Map<string, number>();
  // Strip line + block comments and string literals so we don't match inside them.
  const cleaned = body
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/`(?:\\.|[^`\\])*`/g, '``')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""');
  // Bare calls: identifier immediately followed by '('
  const re = /(?:\.\s*)?\b([A-Za-z_$][\w$]*)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned)) !== null) {
    const name = m[1];
    if (!name || CALL_STOPWORDS.has(name)) continue;
    calls.set(name, (calls.get(name) ?? 0) + 1);
  }
  return calls;
}

/**
 * Estimate the end line of a symbol by scanning forward from startLine
 * to find a matching closing brace at the same indentation level.
 */
function estimateEndLine(lines: string[], startLine: number): number {
  let depth = 0;
  let foundOpen = false;
  for (let i = startLine - 1; i < lines.length; i++) {
    const line = lines[i] ?? '';
    for (const ch of line) {
      if (ch === '{') {
        depth++;
        foundOpen = true;
      } else if (ch === '}') {
        depth--;
        if (foundOpen && depth === 0) {
          return i + 1; // 1-based
        }
      }
    }
  }
  // fallback: return start + 5
  return Math.min(startLine + 5, lines.length);
}

function countMethodsInClass(source: string, startLine: number, endLine: number): number {
  const lines = source.split('\n');
  const classSource = lines.slice(startLine - 1, endLine).join('\n');
  const methodRe =
    /(?:^|\n)\s+(?:(?:public|private|protected|static|async|override|readonly)\s+)*(\w+)\s*\([^)]*\)\s*(?::\s*[^{]+)?\s*\{/g;
  let count = 0;
  let m: RegExpExecArray | null;
  while ((m = methodRe.exec(classSource)) !== null) {
    // Skip constructor if desired; count all
    count++;
  }
  return count;
}

export class FileAnalyzerAgent extends BaseAgent {
  readonly id = 'file-analyzer';
  readonly phase = 1 as const;

  async run(ctx: AgentContext): Promise<AgentResult> {
    try {
      const scanResult = await this.readIntermediate<ScanResult>(ctx, 'scan-result.json');
      if (!scanResult) {
        return this.failure(ctx, 'scan-result.json not found in intermediate dir');
      }

      const graph = ctx.graph;
      const newNodes: SprangNode[] = [];
      const newEdges: SprangEdge[] = [];

      // Call-graph collection: function registry + bodies for a resolution pass
      interface FnEntry { nodeId: string; name: string; filePath: string; body: string; exported: boolean; }
      const fnEntries: FnEntry[] = [];
      const fnsByFile = new Map<string, FnEntry[]>();
      // filePath → set of resolved imported file paths (populated in the import-edge pass)
      const resolvedImportsByFile = new Map<string, Set<string>>();

      // Output directory for per-file analysis
      const analysisDir = join(ctx.intermediateDir, 'file-analysis');
      await ensureDir(analysisDir);

      const SUPPORTED_LANGS = new Set([
        'typescript', 'javascript', 'python', 'go', 'rust',
        'java', 'kotlin', 'ruby', 'php', 'c', 'cpp', 'csharp',
      ]);
      const tsJsFiles = scanResult.files.filter((f) => SUPPORTED_LANGS.has(f.language));

      for (const fileRecord of tsJsFiles) {
        let source: string;
        try {
          source = await readFile(fileRecord.absolutePath, 'utf-8');
        } catch {
          continue;
        }

        const lines = source.split('\n');
        const totalLines = lines.length;
        const fileNodeId = `file:${fileRecord.path}`;

        const lang = fileRecord.language;
        const isNative = lang === 'typescript' || lang === 'javascript';
        const fnMatches = isNative ? findFunctions(source) : parseSymbols(lang, source).functions;
        const classMatches = isNative ? findClasses(source) : parseSymbols(lang, source).classes;

        const functions: FunctionRecord[] = [];
        const classes: ClassRecord[] = [];
        const topLevelExports: string[] = [];

        // Process functions
        for (const fn of fnMatches) {
          const endLine = estimateEndLine(lines, fn.startLine);
          const loc = endLine - fn.startLine + 1;

          // Only include if at least 1 line (include everything for analysis)
          const rec: FunctionRecord = {
            name: fn.name,
            start_line: fn.startLine,
            end_line: endLine,
            param_count: 0, // We don't parse params in detail here
            cyclomatic_complexity: 1, // baseline
            exported: fn.exported,
          };
          functions.push(rec);

          if (fn.exported) topLevelExports.push(fn.name);

          // Create node (any function)
          const nodeId = `function:${fileRecord.path}:${fn.name}`;
          const complexity = complexityFromLoc(loc);
          newNodes.push({
            id: nodeId,
            type: 'function',
            label: fn.name,
            location: {
              file: fileRecord.path,
              start_line: fn.startLine,
              end_line: endLine,
            },
            complexity,
            metadata: {
              exported: fn.exported,
              isAsync: fn.isAsync,
              loc,
            },
          });

          // contains edge
          newEdges.push({
            source: fileNodeId,
            target: nodeId,
            type: 'contains',
          });

          // Register for call-graph resolution (capture the body slice)
          const body = lines.slice(fn.startLine - 1, endLine).join('\n');
          const entry: FnEntry = { nodeId, name: fn.name, filePath: fileRecord.path, body, exported: fn.exported };
          fnEntries.push(entry);
          const bucket = fnsByFile.get(fileRecord.path) ?? [];
          bucket.push(entry);
          fnsByFile.set(fileRecord.path, bucket);
        }

        // Process classes
        for (const cls of classMatches) {
          const endLine = estimateEndLine(lines, cls.startLine);
          const loc = endLine - cls.startLine + 1;
          const methodCount = countMethodsInClass(source, cls.startLine, endLine);

          const rec: ClassRecord = {
            name: cls.name,
            start_line: cls.startLine,
            end_line: endLine,
            method_count: methodCount,
            exported: cls.exported,
          };
          classes.push(rec);

          if (cls.exported) topLevelExports.push(cls.name);

          const nodeId = `class:${fileRecord.path}:${cls.name}`;
          const complexity = complexityFromLoc(loc);
          newNodes.push({
            id: nodeId,
            type: 'class',
            label: cls.name,
            location: {
              file: fileRecord.path,
              start_line: cls.startLine,
              end_line: endLine,
            },
            complexity,
            metadata: {
              exported: cls.exported,
              methodCount,
              loc,
            },
          });

          // contains edge
          newEdges.push({
            source: fileNodeId,
            target: nodeId,
            type: 'contains',
          });
        }

        // Detect and attach patterns to the existing file node in graph
        const filePatterns = detectPatterns(source);
        if (filePatterns.length > 0) {
          const existingFileNode = graph.nodes.find(n => n.id === fileNodeId);
          if (existingFileNode) {
            existingFileNode.detected_patterns = filePatterns;
          }
        }

        // Write per-file analysis
        const analysis: FileAnalysis = {
          path: fileRecord.path,
          functions,
          classes,
          topLevelExports,
          complexity: complexityFromLoc(totalLines),
          tags: [],
        };

        const safeFilename = fileRecord.path.replace(/[\\/]/g, '__') + '.json';
        await writeFileAtomic(
          join(analysisDir, safeFilename),
          JSON.stringify(analysis, null, 2)
        );
      }

      // Add import edges from importMap using language-aware resolver
      const allRelPaths = new Set(scanResult.files.map((f) => f.path));
      const langByPath = new Map(scanResult.files.map((f) => [f.path, f.language]));
      for (const [fromRelPath, importPaths] of Object.entries(scanResult.importMap)) {
        const fromNodeId = `file:${fromRelPath}`;
        const lang = langByPath.get(fromRelPath) ?? 'unknown';
        for (const importPath of importPaths) {
          const resolvedPath = resolveLanguageImport(lang, importPath, fromRelPath, allRelPaths);
          if (!resolvedPath) continue;
          // Track resolved imports per file for cross-file call resolution
          const set = resolvedImportsByFile.get(fromRelPath) ?? new Set<string>();
          set.add(resolvedPath);
          resolvedImportsByFile.set(fromRelPath, set);
          const targetNodeId = `file:${resolvedPath}`;
          const existsInGraph = graph.nodes.some((n) => n.id === targetNodeId);
          const existsInNew = newNodes.some((n) => n.id === targetNodeId);
          if (existsInGraph || existsInNew) {
            const alreadyExists = newEdges.some(
              (e) => e.source === fromNodeId && e.target === targetNodeId && e.type === 'imports'
            );
            if (!alreadyExists) {
              newEdges.push({ source: fromNodeId, target: targetNodeId, type: 'imports' });
            }
          }
        }
      }

      // ─── Call-graph resolution pass ───────────────────────────────────
      // Resolve function-to-function calls into `calls` edges. Internal calls
      // (same file) resolve precisely; external calls resolve against exported
      // functions in files the caller's file directly imports.
      const callMeta = new Map<string, { internal: number; external: number; callers: Set<string> }>();
      const ensureMeta = (id: string) => {
        let m = callMeta.get(id);
        if (!m) { m = { internal: 0, external: 0, callers: new Set() }; callMeta.set(id, m); }
        return m;
      };
      // Index exported functions by name within each file for external lookup
      const exportedByFile = new Map<string, Map<string, FnEntry>>();
      for (const [fp, entries] of fnsByFile) {
        const idx = new Map<string, FnEntry>();
        for (const e of entries) if (e.exported) idx.set(e.name, e);
        exportedByFile.set(fp, idx);
      }
      const seenCallEdges = new Set<string>();
      for (const caller of fnEntries) {
        const sites = extractCallSites(caller.body);
        const sameFile = fnsByFile.get(caller.filePath) ?? [];
        const sameFileByName = new Map(sameFile.map((e) => [e.name, e]));
        const importedFiles = resolvedImportsByFile.get(caller.filePath) ?? new Set<string>();
        for (const [calleeName, count] of sites) {
          if (calleeName === caller.name) continue; // ignore self-recursion edges
          // Internal call — same file
          const internal = sameFileByName.get(calleeName);
          if (internal) {
            const key = `${caller.nodeId}→${internal.nodeId}`;
            ensureMeta(caller.nodeId).internal += count;
            ensureMeta(internal.nodeId).callers.add(caller.nodeId);
            if (!seenCallEdges.has(key)) {
              seenCallEdges.add(key);
              newEdges.push({ source: caller.nodeId, target: internal.nodeId, type: 'calls', weight: count });
            }
            continue;
          }
          // External call — exported function in a directly-imported file
          for (const impFile of importedFiles) {
            const target = exportedByFile.get(impFile)?.get(calleeName);
            if (target) {
              const key = `${caller.nodeId}→${target.nodeId}`;
              ensureMeta(caller.nodeId).external += count;
              ensureMeta(target.nodeId).callers.add(caller.nodeId);
              if (!seenCallEdges.has(key)) {
                seenCallEdges.add(key);
                newEdges.push({ source: caller.nodeId, target: target.nodeId, type: 'calls', weight: count });
              }
              break;
            }
          }
        }
      }
      // Stamp call metadata onto function nodes
      for (const node of newNodes) {
        const m = callMeta.get(node.id);
        if (!m) continue;
        node.metadata = {
          ...node.metadata,
          internalCalls: m.internal,
          externalCalls: m.external,
          callerCount: m.callers.size,
          isUnused: m.callers.size === 0 && node.metadata?.['exported'] !== true,
        };
      }

      const updatedGraph: KnowledgeGraph = {
        ...graph,
        nodes: [...graph.nodes, ...newNodes],
        edges: [...graph.edges, ...newEdges],
      };

      return this.success(ctx, updatedGraph);
    } catch (err) {
      return this.failure(
        ctx,
        err instanceof Error ? err.message : String(err)
      );
    }
  }
}
