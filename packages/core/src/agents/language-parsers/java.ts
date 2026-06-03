import type { ParsedSymbols } from './index.js';

export function parseJava(source: string): ParsedSymbols {
  const functions: ParsedSymbols['functions'] = [];
  const classes: ParsedSymbols['classes'] = [];
  const lines = source.split('\n');

  // [access] [static] [return_type] methodName( ...
  const methodRe =
    /^\s*(?:(?:public|private|protected|static|final|synchronized|native|abstract|default)\s+)*(?!class\s|interface\s|enum\s)(?:[\w<>\[\],\s.]+\s+)?(\w+)\s*\(/;
  // [access] class/interface/enum Name
  const classRe =
    /^\s*(?:(?:public|private|protected|static|final|abstract)\s+)*(?:class|interface|enum|record)\s+(\w+)/;

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
      // skip keywords that leaked through
      if (name && !['if', 'for', 'while', 'switch', 'catch', 'else', 'new', 'return', 'throw'].includes(name)) {
        const isPublic = /\bpublic\b/.test(line);
        functions.push({ name, startLine: i + 1, exported: isPublic, isAsync: false });
      }
    }
  }

  return { functions, classes };
}
