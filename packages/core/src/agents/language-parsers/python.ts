import type { ParsedSymbols } from './index.js';

export function parsePython(source: string): ParsedSymbols {
  const functions: ParsedSymbols['functions'] = [];
  const classes: ParsedSymbols['classes'] = [];
  const lines = source.split('\n');

  // def [async] name(  or  async def name(
  const fnRe = /^(\s*)(?:(async)\s+)?def\s+(\w+)\s*\(/;
  // class Name[(...)][:
  const classRe = /^(\s*)class\s+(\w+)/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const fnM = fnRe.exec(line);
    if (fnM) {
      const indent = fnM[1]?.length ?? 0;
      const name = fnM[3] ?? '';
      if (name) {
        functions.push({
          name,
          startLine: i + 1,
          exported: indent === 0 && !name.startsWith('_'),
          isAsync: fnM[2] === 'async',
        });
      }
      continue;
    }
    const clsM = classRe.exec(line);
    if (clsM) {
      const indent = clsM[1]?.length ?? 0;
      const name = clsM[2] ?? '';
      if (name) {
        classes.push({
          name,
          startLine: i + 1,
          exported: indent === 0 && !name.startsWith('_'),
        });
      }
    }
  }

  return { functions, classes };
}
