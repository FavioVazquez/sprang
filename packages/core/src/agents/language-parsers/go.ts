import type { ParsedSymbols } from './index.js';

export function parseGo(source: string): ParsedSymbols {
  const functions: ParsedSymbols['functions'] = [];
  const classes: ParsedSymbols['classes'] = [];
  const lines = source.split('\n');

  // func [( receiver )] Name[GenericParams]( ...
  const fnRe = /^func\s+(?:\([^)]*\)\s+)?(\w+)\s*[([{(]/;
  // type Name struct { or type Name interface {
  const structRe = /^type\s+(\w+)\s+(?:struct|interface)\s*\{/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const fnM = fnRe.exec(line);
    if (fnM) {
      const name = fnM[1] ?? '';
      if (name && name !== 'init') {
        functions.push({
          name,
          startLine: i + 1,
          exported: /^[A-Z]/.test(name),
          isAsync: false,
        });
      }
      continue;
    }
    const stM = structRe.exec(line);
    if (stM) {
      const name = stM[1] ?? '';
      if (name) {
        classes.push({
          name,
          startLine: i + 1,
          exported: /^[A-Z]/.test(name),
        });
      }
    }
  }

  return { functions, classes };
}
