import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { readJsonFileOrNull, writeFileAtomic, ensureDir } from './fs.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ChangeType = 'SKIP' | 'COSMETIC' | 'STRUCTURAL';

export interface FileFingerprint {
  contentHash: string;   // SHA-256 of full file content
  functions: string[];   // extracted function names
  classes: string[];     // extracted class names
  imports: string[];     // import paths (raw, not resolved)
  exports: string[];     // exported names
  totalLines: number;
}

export interface FingerprintStore {
  version: '1.0';
  generatedAt: string;
  files: Record<string, FileFingerprint>; // keyed by relative path
}

// ─── Regex extraction helpers ─────────────────────────────────────────────────

function extractTsJsFunctions(content: string): string[] {
  const names: string[] = [];
  const re = /(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\()/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const name = m[1] ?? m[2];
    if (name) names.push(name);
  }
  return names;
}

function extractTsJsClasses(content: string): string[] {
  const names: string[] = [];
  const re = /(?:class|interface)\s+(\w+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    if (m[1]) names.push(m[1]);
  }
  return names;
}

function extractTsJsImports(content: string): string[] {
  const imports = new Set<string>();
  const fromRe = /(?:import|require)\s*(?:type\s+)?(?:\{[^}]*\}|[\w*$]+(?:\s*,\s*(?:\{[^}]*\}|[\w*$]+))?)?\s*from\s*['"]([^'"]+)['"]/g;
  const dynRe = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = fromRe.exec(content)) !== null) {
    if (m[1]) imports.add(m[1]);
  }
  while ((m = dynRe.exec(content)) !== null) {
    if (m[1]) imports.add(m[1]);
  }
  return Array.from(imports);
}

function extractTsJsExports(content: string): string[] {
  const names: string[] = [];
  const re = /export\s+(?:default\s+)?(?:function|class|const|let|var|type|interface)\s+(\w+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    if (m[1]) names.push(m[1]);
  }
  return names;
}

function extractPythonFunctions(content: string): string[] {
  const names: string[] = [];
  const re = /^def\s+(\w+)\s*\(/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    if (m[1]) names.push(m[1]);
  }
  return names;
}

function extractPythonClasses(content: string): string[] {
  const names: string[] = [];
  const re = /^class\s+(\w+)/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    if (m[1]) names.push(m[1]);
  }
  return names;
}

function extractPythonImports(content: string): string[] {
  const imports = new Set<string>();
  const fromRe = /^from\s+(\.+[\w.]*|[\w][\w.]*)\s+import\s+/gm;
  const importRe = /^import\s+([\w][\w., \t]*)/gm;
  let m: RegExpExecArray | null;
  while ((m = fromRe.exec(content)) !== null) {
    if (m[1]) imports.add(m[1]);
  }
  while ((m = importRe.exec(content)) !== null) {
    if (m[1]) {
      for (const part of m[1].split(',')) {
        const trimmed = part.trim().split(/\s+/)[0];
        if (trimmed) imports.add(trimmed);
      }
    }
  }
  return Array.from(imports);
}

function extractGoFunctions(content: string): string[] {
  const names: string[] = [];
  const re = /^func\s+(?:\(\w+\s+\*?\w+\)\s+)?(\w+)\s*\(/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    if (m[1]) names.push(m[1]);
  }
  return names;
}

function extractGoClasses(content: string): string[] {
  const names: string[] = [];
  // Go doesn't have classes but has structs and interfaces
  const re = /^type\s+(\w+)\s+(?:struct|interface)\s*\{/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    if (m[1]) names.push(m[1]);
  }
  return names;
}

function extractGoImports(content: string): string[] {
  const imports = new Set<string>();
  const singleRe = /^\s*import\s+(?:\w+\s+)?["']([^"']+)["']/gm;
  const blockRe = /["']([^"']+)["']/g;
  const blockSectionRe = /import\s*\(([^)]+)\)/gs;
  let m: RegExpExecArray | null;
  while ((m = singleRe.exec(content)) !== null) {
    if (m[1]) imports.add(m[1]);
  }
  let blockM: RegExpExecArray | null;
  while ((blockM = blockSectionRe.exec(content)) !== null) {
    const block = blockM[1] ?? '';
    blockRe.lastIndex = 0;
    while ((m = blockRe.exec(block)) !== null) {
      if (m[1]) imports.add(m[1]);
    }
  }
  return Array.from(imports);
}

// ─── Main API ─────────────────────────────────────────────────────────────────

export function computeFileFingerprint(
  _filePath: string,
  content: string,
  language: string,
): FileFingerprint {
  const contentHash = createHash('sha256').update(content).digest('hex');
  const totalLines = content.split('\n').length;

  let functions: string[] = [];
  let classes: string[] = [];
  let imports: string[] = [];
  let exports: string[] = [];

  switch (language) {
    case 'typescript':
    case 'javascript':
      functions = extractTsJsFunctions(content);
      classes = extractTsJsClasses(content);
      imports = extractTsJsImports(content);
      exports = extractTsJsExports(content);
      break;
    case 'python':
      functions = extractPythonFunctions(content);
      classes = extractPythonClasses(content);
      imports = extractPythonImports(content);
      break;
    case 'go':
      functions = extractGoFunctions(content);
      classes = extractGoClasses(content);
      imports = extractGoImports(content);
      break;
    default:
      // Other languages: empty arrays, still hash-based
      break;
  }

  return { contentHash, functions, classes, imports, exports, totalLines };
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((v, i) => v === sortedB[i]);
}

export function classifyChange(
  prev: FileFingerprint | undefined,
  curr: FileFingerprint,
): ChangeType {
  if (prev === undefined) return 'STRUCTURAL';
  if (prev.contentHash === curr.contentHash) return 'SKIP';
  if (
    arraysEqual(prev.functions, curr.functions) &&
    arraysEqual(prev.classes, curr.classes) &&
    arraysEqual(prev.imports, curr.imports) &&
    arraysEqual(prev.exports, curr.exports)
  ) {
    return 'COSMETIC';
  }
  return 'STRUCTURAL';
}

const FINGERPRINTS_FILE = 'fingerprints.json';

export async function loadFingerprintStore(
  sprangDir: string,
): Promise<FingerprintStore | null> {
  const filePath = join(sprangDir, 'cache', FINGERPRINTS_FILE);
  return readJsonFileOrNull<FingerprintStore>(filePath);
}

export async function saveFingerprintStore(
  sprangDir: string,
  store: FingerprintStore,
): Promise<void> {
  const cacheDir = join(sprangDir, 'cache');
  await ensureDir(cacheDir);
  const filePath = join(cacheDir, FINGERPRINTS_FILE);
  await writeFileAtomic(filePath, JSON.stringify(store, null, 2));
}

export function buildFingerprintStore(
  files: Array<{ path: string; absPath: string; language: string; content: string }>,
): FingerprintStore {
  const fileMap: Record<string, FileFingerprint> = {};
  for (const f of files) {
    fileMap[f.path] = computeFileFingerprint(f.absPath, f.content, f.language);
  }
  return {
    version: '1.0',
    generatedAt: new Date().toISOString(),
    files: fileMap,
  };
}
