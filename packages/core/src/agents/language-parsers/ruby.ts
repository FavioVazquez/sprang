import type { ParsedSymbols } from './index.js';

export function parseRuby(source: string): ParsedSymbols {
  const functions: ParsedSymbols['functions'] = [];
  const classes: ParsedSymbols['classes'] = [];
  const lines = source.split('\n');

  // def method_name or def self.method_name
  const fnRe = /^(\s*)def\s+(?:self\.)?(\w+)/;
  // class Name [< Parent] or module Name
  const classRe = /^(\s*)(?:class|module)\s+(\w+)/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const fnM = fnRe.exec(line);
    if (fnM) {
      const indent = fnM[1]?.length ?? 0;
      const name = fnM[2] ?? '';
      if (name) {
        functions.push({
          name,
          startLine: i + 1,
          exported: indent === 0 && !name.startsWith('_'),
          isAsync: false,
        });
      }
      continue;
    }
    const clsM = classRe.exec(line);
    if (clsM) {
      const indent = clsM[1]?.length ?? 0;
      const name = clsM[2] ?? '';
      if (name) {
        classes.push({ name, startLine: i + 1, exported: indent === 0 });
      }
    }
  }

  return { functions, classes };
}
