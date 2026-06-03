import type { ParsedSymbols } from './index.js';

export function parseCSharp(source: string): ParsedSymbols {
  const functions: ParsedSymbols['functions'] = [];
  const classes: ParsedSymbols['classes'] = [];
  const lines = source.split('\n');

  // class/interface/struct/record/enum Name
  const classRe =
    /^\s*(?:(?:public|private|protected|internal|static|abstract|sealed|partial|readonly)\s+)*(?:class|interface|struct|record|enum)\s+(\w+)/;
  // [access] [modifiers] ReturnType MethodName(
  const methodRe =
    /^\s*(?:(?:public|private|protected|internal|static|virtual|override|abstract|async|new|sealed)\s+)+(?!class\s|interface\s|struct\s|record\s|enum\s)(?:[\w<>\[\],\s.?]+\s+)?(\w+)\s*\(/;

  const SKIP = new Set([
    'if', 'for', 'foreach', 'while', 'switch', 'do', 'catch',
    'return', 'throw', 'new', 'typeof', 'nameof',
  ]);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';

    const clsM = classRe.exec(line);
    if (clsM) {
      const name = clsM[1] ?? '';
      if (name) {
        const isPublic = /\bpublic\b/.test(line);
        classes.push({ name, startLine: i + 1, exported: isPublic });
      }
      continue;
    }

    const mM = methodRe.exec(line);
    if (mM) {
      const name = mM[1] ?? '';
      if (name && !SKIP.has(name)) {
        const isPublic = /\bpublic\b/.test(line);
        const isAsync = /\basync\b/.test(line);
        functions.push({ name, startLine: i + 1, exported: isPublic, isAsync });
      }
    }
  }

  return { functions, classes };
}
