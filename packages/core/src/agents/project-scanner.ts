import { readFile, stat } from 'node:fs/promises';
import { join, basename, extname, relative, dirname } from 'node:path';
import fg from 'fast-glob';
import type { KnowledgeGraph, ScanResult, FileRecord, SprangNode } from '../schema/types.js';
import { EXTENSION_TO_LANGUAGE, DEFAULT_EXCLUDES, FRAMEWORK_MARKERS } from '../schema/constants.js';
import { BaseAgent } from './base.js';
import type { AgentContext, AgentResult } from './base.js';
import { fileExists } from '../utils/fs.js';

// Regex for static imports: import ... from '...' or import('...')
const IMPORT_FROM_RE =
  /(?:import|require)\s*(?:type\s+)?(?:\{[^}]*\}|[\w*$]+(?:\s*,\s*(?:\{[^}]*\}|[\w*$]+))?)?\s*from\s*['"]([^'"]+)['"]/g;
const DYNAMIC_IMPORT_RE = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

function extractImports(source: string): string[] {
  const imports = new Set<string>();
  let m: RegExpExecArray | null;
  IMPORT_FROM_RE.lastIndex = 0;
  while ((m = IMPORT_FROM_RE.exec(source)) !== null) {
    const path = m[1];
    if (path !== undefined) imports.add(path);
  }
  DYNAMIC_IMPORT_RE.lastIndex = 0;
  while ((m = DYNAMIC_IMPORT_RE.exec(source)) !== null) {
    const path = m[1];
    if (path !== undefined) imports.add(path);
  }
  return Array.from(imports);
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

          // Extract imports for TS/JS files
          if (
            language === 'typescript' ||
            language === 'javascript'
          ) {
            const imports = extractImports(content);
            if (imports.length > 0) {
              importMap[relPath] = imports;
            }
          }
        } catch {
          // Skip unreadable files
          continue;
        }

        const fileCategory =
          language === 'typescript' || language === 'javascript'
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
