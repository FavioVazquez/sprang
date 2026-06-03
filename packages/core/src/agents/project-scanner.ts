import { readFile, stat } from 'node:fs/promises';
import { join, basename, extname, relative } from 'node:path';
import fg from 'fast-glob';
import type { KnowledgeGraph, ScanResult, FileRecord, SprangNode } from '../schema/types.js';
import { EXTENSION_TO_LANGUAGE, DEFAULT_EXCLUDES, FRAMEWORK_MARKERS } from '../schema/constants.js';
import { BaseAgent } from './base.js';
import type { AgentContext, AgentResult } from './base.js';
import { fileExists } from '../utils/fs.js';

// ─── TS/JS import extraction ─────────────────────────────────────────────────

const IMPORT_FROM_RE =
  /(?:import|require)\s*(?:type\s+)?(?:\{[^}]*\}|[\w*$]+(?:\s*,\s*(?:\{[^}]*\}|[\w*$]+))?)?\s*from\s*['"]([^'"]+)['"]/g;
const DYNAMIC_IMPORT_RE = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

function extractTsJsImports(source: string): string[] {
  const imports = new Set<string>();
  let m: RegExpExecArray | null;
  IMPORT_FROM_RE.lastIndex = 0;
  while ((m = IMPORT_FROM_RE.exec(source)) !== null) {
    const p = m[1];
    if (p !== undefined) imports.add(p);
  }
  DYNAMIC_IMPORT_RE.lastIndex = 0;
  while ((m = DYNAMIC_IMPORT_RE.exec(source)) !== null) {
    const p = m[1];
    if (p !== undefined) imports.add(p);
  }
  return Array.from(imports);
}

// ─── Python import extraction ────────────────────────────────────────────────

function extractPythonImports(source: string): string[] {
  const imports = new Set<string>();
  // from .module import X  or  from package.sub import X
  const fromRe = /^from\s+(\.+[\w.]*|[\w][\w.]*)\s+import\s+/gm;
  // import module  or  import package.sub (stop at newline or #)
  const importRe = /^import\s+([\w][\w., \t]*)/gm;
  let m: RegExpExecArray | null;
  while ((m = fromRe.exec(source)) !== null) {
    const raw = m[1];
    if (raw !== undefined) imports.add(raw);
  }
  while ((m = importRe.exec(source)) !== null) {
    const raw = m[1];
    if (raw !== undefined) {
      for (const part of raw.split(',')) {
        const trimmed = part.trim().split(/\s+/)[0];
        if (trimmed) imports.add(trimmed);
      }
    }
  }
  return Array.from(imports);
}

// ─── Go import extraction ────────────────────────────────────────────────────

function extractGoImports(source: string): string[] {
  const imports = new Set<string>();
  // import "path"  or  import alias "path"
  const singleRe = /^\s*import\s+(?:\w+\s+)?["']([^"']+)["']/gm;
  // import ( "path" \n alias "path" )
  const blockRe = /["']([^"']+)["']/g;
  const blockSectionRe = /import\s*\(([^)]+)\)/gs;
  let m: RegExpExecArray | null;
  while ((m = singleRe.exec(source)) !== null) {
    const p = m[1];
    if (p !== undefined) imports.add(p);
  }
  let blockM: RegExpExecArray | null;
  while ((blockM = blockSectionRe.exec(source)) !== null) {
    const block = blockM[1] ?? '';
    blockRe.lastIndex = 0;
    while ((m = blockRe.exec(block)) !== null) {
      const p = m[1];
      if (p !== undefined) imports.add(p);
    }
  }
  return Array.from(imports);
}

// ─── Rust import extraction ───────────────────────────────────────────────────

function extractRustImports(source: string): string[] {
  const imports = new Set<string>();
  // use crate::x::y  |  use super::x  |  use self::x
  const useRe = /^\s*use\s+((?:crate|super|self)(?:::\w+)+)/gm;
  // mod x;  (sibling module declaration)
  const modRe = /^\s*(?:pub\s+)?mod\s+(\w+)\s*;/gm;
  let m: RegExpExecArray | null;
  while ((m = useRe.exec(source)) !== null) {
    const p = m[1];
    if (p !== undefined) imports.add(p);
  }
  while ((m = modRe.exec(source)) !== null) {
    const p = m[1];
    if (p !== undefined) imports.add('mod:' + p);
  }
  return Array.from(imports);
}

// ─── Java / Kotlin import extraction ─────────────────────────────────────────

function extractJavaImports(source: string): string[] {
  const imports = new Set<string>();
  // Java requires semicolons; Kotlin does not
  const re = /^\s*import\s+(?:static\s+)?([\w.]+)(?:\.\*)?;?/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const p = m[1];
    if (p !== undefined) imports.add(p);
  }
  return Array.from(imports);
}

// ─── Ruby import extraction ───────────────────────────────────────────────────

function extractRubyImports(source: string): string[] {
  const imports = new Set<string>();
  // require_relative 'path'
  const relRe = /^\s*require_relative\s+['"]([^'"]+)['"]/gm;
  // require 'path' — capture all; resolver will filter to local only
  const reqRe = /^\s*require\s+['"]([^'"]+)['"]/gm;
  let m: RegExpExecArray | null;
  while ((m = relRe.exec(source)) !== null) {
    const p = m[1];
    if (p !== undefined) imports.add('./' + p);
  }
  while ((m = reqRe.exec(source)) !== null) {
    const p = m[1];
    if (p !== undefined) imports.add(p);
  }
  return Array.from(imports);
}

// ─── PHP import extraction ────────────────────────────────────────────────────

function extractPhpImports(source: string): string[] {
  const imports = new Set<string>();
  // require/include with literal string
  const litRe = /(?:require|include)(?:_once)?\s*\(?['"]([^'"]+)['"]\)?/g;
  // use Namespace\Class
  const useRe = /^\s*use\s+([\w\\]+)/gm;
  let m: RegExpExecArray | null;
  while ((m = litRe.exec(source)) !== null) {
    const p = m[1];
    if (p !== undefined) imports.add(p);
  }
  while ((m = useRe.exec(source)) !== null) {
    const p = m[1];
    if (p !== undefined) imports.add(p);
  }
  return Array.from(imports);
}

// ─── C / C++ import extraction ────────────────────────────────────────────────

function extractCImports(source: string): string[] {
  const imports = new Set<string>();
  // Only quoted includes (local) — skip <system> headers
  const re = /^\s*#include\s+"([^"]+)"/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const p = m[1];
    if (p !== undefined) imports.add(p);
  }
  return Array.from(imports);
}

// ─── C# import extraction ─────────────────────────────────────────────────────

function extractCSharpImports(source: string): string[] {
  const imports = new Set<string>();
  const re = /^\s*using\s+(?:static\s+)?([\w.]+)\s*;/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const p = m[1];
    if (p !== undefined) imports.add(p);
  }
  return Array.from(imports);
}

// ─── Dispatcher ───────────────────────────────────────────────────────────────

const SOURCE_LANGUAGES = new Set([
  'typescript', 'javascript', 'python', 'go', 'rust',
  'java', 'kotlin', 'ruby', 'php', 'c', 'cpp', 'csharp',
  'swift', 'bash',
]);

export function extractImportsForLanguage(lang: string, source: string): string[] {
  switch (lang) {
    case 'typescript':
    case 'javascript':
      return extractTsJsImports(source);
    case 'python':
      return extractPythonImports(source);
    case 'go':
      return extractGoImports(source);
    case 'rust':
      return extractRustImports(source);
    case 'java':
    case 'kotlin':
      return extractJavaImports(source);
    case 'ruby':
      return extractRubyImports(source);
    case 'php':
      return extractPhpImports(source);
    case 'c':
    case 'cpp':
      return extractCImports(source);
    case 'csharp':
      return extractCSharpImports(source);
    default:
      return [];
  }
}

// ─── Language-aware import path resolver ─────────────────────────────────────

export function resolveLanguageImport(
  lang: string,
  rawImport: string,
  fromRelPath: string,
  allRelPaths: Set<string>,
): string | null {
  const fromDir = fromRelPath.includes('/')
    ? fromRelPath.split('/').slice(0, -1).join('/')
    : '';

  function joinAndNormalize(base: string, rel: string): string {
    const parts = (base ? base + '/' + rel : rel).split('/');
    const resolved: string[] = [];
    for (const p of parts) {
      if (p === '..') resolved.pop();
      else if (p !== '.') resolved.push(p);
    }
    return resolved.join('/');
  }

  function tryPaths(candidates: string[]): string | null {
    for (const c of candidates) {
      if (allRelPaths.has(c)) return c;
    }
    return null;
  }

  if (lang === 'typescript' || lang === 'javascript') {
    if (!rawImport.startsWith('.')) return null;
    const normalized = rawImport.replace(/\.js$/, '');
    return tryPaths([
      joinAndNormalize(fromDir, normalized + '.ts'),
      joinAndNormalize(fromDir, normalized + '.tsx'),
      joinAndNormalize(fromDir, normalized + '.js'),
      joinAndNormalize(fromDir, normalized + '/index.ts'),
      joinAndNormalize(fromDir, normalized + '/index.js'),
    ]);
  }

  if (lang === 'python') {
    // Relative: leading dots — one dot = current package (fromDir), two dots = parent, etc.
    if (rawImport.startsWith('.')) {
      const dots = rawImport.match(/^\.+/)?.[0].length ?? 1;
      const rest = rawImport.replace(/^\.+/, '').replace(/\./g, '/');
      // Start from fromDir, go up (dots-1) levels for extra dots
      let base = fromDir;
      for (let i = 1; i < dots; i++) {
        base = base.split('/').slice(0, -1).join('/');
      }
      // If rest is empty, we're importing the package itself
      const modPath = rest ? joinAndNormalize(base, rest) : base;
      return tryPaths([modPath + '.py', modPath + '/__init__.py', base + '/' + rest + '.py'].filter(Boolean));
    }
    // Absolute: map package.sub.mod -> package/sub/mod.py
    const modPath = rawImport.replace(/\./g, '/');
    return tryPaths([modPath + '.py', modPath + '/__init__.py']);
  }

  if (lang === 'go') {
    // Go import paths are module-relative; match last path segment dirs
    const parts = rawImport.split('/');
    const tail = parts[parts.length - 1] ?? '';
    // Try to find a directory that ends with the import tail
    for (const p of allRelPaths) {
      const dir = p.split('/').slice(0, -1).join('/');
      if (dir.endsWith(tail) || dir.endsWith(rawImport)) return p;
    }
    return null;
  }

  if (lang === 'rust') {
    if (rawImport.startsWith('mod:')) {
      const modName = rawImport.slice(4);
      return tryPaths([
        joinAndNormalize(fromDir, modName + '.rs'),
        joinAndNormalize(fromDir, modName + '/mod.rs'),
      ]);
    }
    // crate::a::b -> src/a/b.rs
    const crateRelative = rawImport.replace(/^crate::/, 'src/').replace(/::/g, '/');
    const superRelative = rawImport.replace(/^super::/, fromDir.split('/').slice(0, -1).join('/') + '/').replace(/::/g, '/');
    return tryPaths([crateRelative + '.rs', superRelative + '.rs']);
  }

  if (lang === 'java' || lang === 'kotlin') {
    // com.example.Class -> com/example/Class.java or .kt
    const filePath = rawImport.replace(/\./g, '/');
    const ext = lang === 'kotlin' ? '.kt' : '.java';
    return tryPaths([filePath + ext, filePath.split('/').slice(0, -1).join('/') + ext]);
  }

  if (lang === 'ruby') {
    const path = rawImport.startsWith('./') ? rawImport.slice(2) : rawImport;
    return tryPaths([
      joinAndNormalize(fromDir, path + '.rb'),
      joinAndNormalize(fromDir, path),
    ]);
  }

  if (lang === 'php') {
    if (rawImport.includes('\\')) {
      const filePath = rawImport.replace(/\\/g, '/');
      return tryPaths([filePath + '.php', filePath]);
    }
    return tryPaths([
      joinAndNormalize(fromDir, rawImport),
      joinAndNormalize(fromDir, rawImport + '.php'),
    ]);
  }

  if (lang === 'c' || lang === 'cpp') {
    return tryPaths([
      joinAndNormalize(fromDir, rawImport),
      rawImport,
    ]);
  }

  if (lang === 'csharp') {
    const filePath = rawImport.replace(/\./g, '/');
    return tryPaths([filePath + '.cs', filePath.split('/').slice(0, -1).join('/') + '.cs']);
  }

  return null;
}

async function detectProjectName(projectRoot: string): Promise<string> {
  const pkgPath = join(projectRoot, 'package.json');
  if (await fileExists(pkgPath)) {
    try {
      const raw = await readFile(pkgPath, 'utf-8');
      const pkg = JSON.parse(raw) as Record<string, unknown>;
      if (typeof pkg['name'] === 'string' && pkg['name'].length > 0) {
        return pkg['name'];
      }
    } catch {
      // fall through
    }
  }
  const cargoPath = join(projectRoot, 'Cargo.toml');
  if (await fileExists(cargoPath)) {
    const raw = await readFile(cargoPath, 'utf-8');
    const m = /^name\s*=\s*"([^"]+)"/m.exec(raw);
    if (m?.[1]) return m[1];
  }
  const goModPath = join(projectRoot, 'go.mod');
  if (await fileExists(goModPath)) {
    const raw = await readFile(goModPath, 'utf-8');
    const m = /^module\s+(\S+)/m.exec(raw);
    if (m?.[1]) return m[1];
  }
  return basename(projectRoot);
}

async function detectFrameworks(projectRoot: string): Promise<string[]> {
  const frameworks: string[] = [];
  for (const marker of FRAMEWORK_MARKERS) {
    const markerPath = join(projectRoot, marker.file);
    if (await fileExists(markerPath)) {
      if (!frameworks.includes(marker.framework)) {
        frameworks.push(marker.framework);
      }
    }
  }
  // Also check package.json dependencies for frontend frameworks
  const pkgPath = join(projectRoot, 'package.json');
  if (await fileExists(pkgPath)) {
    try {
      const raw = await readFile(pkgPath, 'utf-8');
      const pkg = JSON.parse(raw) as Record<string, unknown>;
      const allDeps = {
        ...(pkg['dependencies'] as Record<string, unknown> | undefined ?? {}),
        ...(pkg['devDependencies'] as Record<string, unknown> | undefined ?? {}),
      };
      const fwMap: Record<string, string> = {
        react: 'react',
        vue: 'vue',
        '@angular/core': 'angular',
        svelte: 'svelte',
        next: 'nextjs',
        nuxt: 'nuxt',
        remix: 'remix',
        express: 'express',
        fastify: 'fastify',
        nest: 'nestjs',
        '@nestjs/core': 'nestjs',
      };
      for (const [dep, fw] of Object.entries(fwMap)) {
        if (dep in allDeps && !frameworks.includes(fw)) {
          frameworks.push(fw);
        }
      }
    } catch {
      // ignore
    }
  }
  return frameworks;
}

async function readIgnoreFile(projectRoot: string): Promise<string[]> {
  const ignorePath = join(projectRoot, '.sprangignore');
  if (!(await fileExists(ignorePath))) return [];
  const raw = await readFile(ignorePath, 'utf-8');
  return raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => {
      if (l.length === 0 || l.startsWith('#')) return false;
      // Reject absolute paths and path traversal sequences
      if (l.startsWith('/') || l.includes('..')) return false;
      return true;
    });
}

function complexityFromLines(lines: number): 'simple' | 'moderate' | 'complex' {
  if (lines < 50) return 'simple';
  if (lines < 200) return 'moderate';
  return 'complex';
}

export class ProjectScannerAgent extends BaseAgent {
  readonly id = 'project-scanner';
  readonly phase = 1 as const;

  async run(ctx: AgentContext): Promise<AgentResult> {
    try {
      const { projectRoot, graph } = ctx;

      const [ignorePatterns, projectName, frameworks] = await Promise.all([
        readIgnoreFile(projectRoot),
        detectProjectName(projectRoot),
        detectFrameworks(projectRoot),
      ]);

      const allExcludes = [...DEFAULT_EXCLUDES, ...ignorePatterns];
      if (ctx.options.excludePatterns) {
        allExcludes.push(...ctx.options.excludePatterns);
      }

      // Enumerate files
      const absolutePaths = await fg('**/*', {
        cwd: projectRoot,
        onlyFiles: true,
        dot: true,
        ignore: allExcludes,
        absolute: true,
        followSymbolicLinks: false,
      });

      const fileRecords: FileRecord[] = [];
      const importMap: Record<string, string[]> = {};
      const languageSet = new Set<string>();

      const newNodes: SprangNode[] = [];

      for (const absPath of absolutePaths) {
        const relPath = relative(projectRoot, absPath);
        const ext = extname(absPath).toLowerCase();
        const language = EXTENSION_TO_LANGUAGE[ext] ?? 'unknown';

        const FILE_SIZE_LIMIT = 10 * 1024 * 1024; // 10MB
        let sizeLines = 0;
        let mtime = 0;
        try {
          const fileStat = await stat(absPath);
          mtime = fileStat.mtimeMs;
          if (fileStat.size > FILE_SIZE_LIMIT) continue;
          const content = await readFile(absPath, 'utf-8');
          sizeLines = content.split('\n').length;

          // Extract imports for all supported languages
          if (SOURCE_LANGUAGES.has(language)) {
            const imports = extractImportsForLanguage(language, content);
            if (imports.length > 0) {
              importMap[relPath] = imports;
            }
          }
        } catch {
          // Skip unreadable files
          continue;
        }

        const fileCategory =
          SOURCE_LANGUAGES.has(language)
            ? 'source'
            : language === 'json' || language === 'yaml' || language === 'toml'
            ? 'config'
            : language === 'markdown'
            ? 'document'
            : 'other';

        fileRecords.push({
          path: relPath,
          absolutePath: absPath,
          language,
          sizeLines,
          fileCategory,
          mtime,
        });

        if (language !== 'unknown') {
          languageSet.add(language);
        }

        // Create graph node for this file
        const nodeId = `file:${relPath}`;
        const complexity = complexityFromLines(sizeLines);
        newNodes.push({
          id: nodeId,
          type: 'file',
          label: basename(absPath),
          location: { file: relPath },
          complexity,
          metadata: {
            language,
            sizeLines,
            mtime,
            fileCategory,
          },
        });
      }

      const scanResult: ScanResult = {
        name: projectName,
        languages: Array.from(languageSet),
        frameworks,
        files: fileRecords,
        totalFiles: fileRecords.length,
        filteredByIgnore: absolutePaths.length - fileRecords.length,
        estimatedComplexity:
          fileRecords.length < 50
            ? 'small'
            : fileRecords.length < 200
            ? 'medium'
            : 'large',
        importMap,
      };

      await this.writeIntermediate(ctx, 'scan-result.json', scanResult);

      // Build updated graph
      const updatedGraph: KnowledgeGraph = {
        ...graph,
        project_name: projectName,
        languages: Array.from(languageSet),
        frameworks,
        nodes: [...graph.nodes, ...newNodes],
        edges: [...graph.edges],
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
