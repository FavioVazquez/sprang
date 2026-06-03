import type { ParsedSymbols } from './index.js';

export function parseKotlin(source: string): ParsedSymbols {
  const functions: ParsedSymbols['functions'] = [];
  const classes: ParsedSymbols['classes'] = [];
  const lines = source.split('\n');

  // [modifiers] fun [<generics>] name(
  const fnRe =
    /^\s*(?:(?:public|private|protected|internal|open|override|suspend|inline|operator|infix|tailrec|external|actual|expect)\s+)*fun\s+(?:<[^>]*>\s+)?(\w+)\s*[(<]/;
  // [modifiers] class/interface/object/enum class Name
  const classRe =
    /^\s*(?:(?:public|private|protected|internal|open|abstract|sealed|data|inner|value|companion|enum|annotation|actual|expect)\s+)*(?:class|interface|object)\s+(\w+)/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';

    const clsM = classRe.exec(line);
    if (clsM) {
      const name = clsM[1] ?? '';
      if (name) {
        const isPublic = !/\bprivate\b/.test(line) && !/\bprotected\b/.test(line);
        classes.push({ name, startLine: i + 1, exported: isPublic });
      }
      continue;
    }

    const fnM = fnRe.exec(line);
    if (fnM) {
      const name = fnM[1] ?? '';
      if (name) {
        const isPublic = !/\bprivate\b/.test(line) && !/\bprotected\b/.test(line);
        const isAsync = /\bsuspend\b/.test(line);
        functions.push({ name, startLine: i + 1, exported: isPublic, isAsync });
      }
    }
  }

  return { functions, classes };
}
