import { readFile } from 'node:fs/promises';
import { join, basename, relative } from 'node:path';
import { ensureDir } from '../utils/fs.js';
import type {
  KnowledgeGraph,
  ScanResult,
  SprangNode,
  SprangEdge,
  FileAnalysis,
  FunctionRecord,
  ClassRecord,
} from '../schema/types.js';
import { BaseAgent } from './base.js';
import type { AgentContext, AgentResult } from './base.js';
import { writeFileAtomic } from '../utils/fs.js';

// Regex patterns for extracting code symbols
const FUNCTION_DECL_RE =
  /^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/gm;
const ARROW_FN_RE =
  /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(([^)]*)\)\s*(?::\s*[^=>{]+)?\s*=>/gm;
// Arrow with single param (no parens): export const foo = async x =>
const ARROW_FN_SINGLE_RE =
  /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(\w+)\s*=>/gm;
const CLASS_RE =
  /^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+(\w+)/gm;
const METHOD_RE =
  /^\s+(?:(?:public|private|protected|static|async|override)\s+)*(\w+)\s*\([^)]*\)\s*(?::\s*[^{]+)?\s*\{/gm;

function countLines(source: string): number {
  return source.split('\n').length;
}

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

      // Output directory for per-file analysis
      const analysisDir = join(ctx.intermediateDir, 'file-analysis');
      await ensureDir(analysisDir);

      const tsJsFiles = scanResult.files.filter((f) => {
        const lang = f.language;
        return lang === 'typescript' || lang === 'javascript';
      });

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

        const fnMatches = findFunctions(source);
        const classMatches = findClasses(source);

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

      // Also add import edges from importMap
      for (const [fromRelPath, importPaths] of Object.entries(scanResult.importMap)) {
        const fromNodeId = `file:${fromRelPath}`;
        for (const importPath of importPaths) {
          // Only create edges for relative imports
          if (!importPath.startsWith('.')) continue;
          // Resolve the import path relative to the importing file
          // Strip .js extension and try to match an existing node
          const normalized = importPath.replace(/\.js$/, '');
          // Try to find a matching file node
          const candidatePaths = [
            normalized + '.ts',
            normalized + '.tsx',
            normalized + '.js',
            normalized + '/index.ts',
            normalized + '/index.js',
          ];

          const fromDir = fromRelPath.split('/').slice(0, -1).join('/');
          for (const candidate of candidatePaths) {
            const relCandidate = fromDir
              ? fromDir + '/' + candidate.replace(/^\.\//, '')
              : candidate.replace(/^\.\//, '');
            // Clean up any ../
            const parts = relCandidate.split('/');
            const resolved: string[] = [];
            for (const part of parts) {
              if (part === '..') {
                resolved.pop();
              } else if (part !== '.') {
                resolved.push(part);
              }
            }
            const resolvedPath = resolved.join('/');
            const targetNodeId = `file:${resolvedPath}`;
            // Check if target exists in graph or in the new nodes
            const existsInGraph = graph.nodes.some((n) => n.id === targetNodeId);
            const existsInNew = newNodes.some((n) => n.id === targetNodeId);
            if (existsInGraph || existsInNew) {
              // Check for duplicate edge
              const alreadyExists = newEdges.some(
                (e) => e.source === fromNodeId && e.target === targetNodeId && e.type === 'imports'
              );
              if (!alreadyExists) {
                newEdges.push({
                  source: fromNodeId,
                  target: targetNodeId,
                  type: 'imports',
                });
              }
              break;
            }
          }
        }
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
