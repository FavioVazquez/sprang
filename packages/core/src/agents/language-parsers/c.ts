import type { ParsedSymbols } from './index.js';

export function parseC(source: string): ParsedSymbols {
  const functions: ParsedSymbols['functions'] = [];
  const classes: ParsedSymbols['classes'] = [];
  const lines = source.split('\n');

  // C/C++ function: return_type[*] name( at start of line (not indented, no semicolon on same line)
  // Matches: int main(, char* greet(, void foo(, static int bar(
  const fnRe = /^(?!#|\/\/|typedef\s)(?:(?:static|inline|extern|const)\s+)*[\w*][\w*\s]*\s(\w+)\s*\((?:[^;{)]*)\s*\)\s*(?:const\s*)?(?:\{|$)/;
  // C++ class/struct/union at file scope
  const classRe = /^(?:(?:template\s*<[^>]*>\s*)?(?:class|struct|union))\s+(\w+)/;

  const SKIP = new Set([
    'if', 'for', 'while', 'switch', 'do', 'else', 'return',
    'sizeof', 'typedef', 'namespace', 'extern', 'inline',
  ]);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (line.trim().startsWith('#') || line.trim().startsWith('//')) continue;

    const clsM = classRe.exec(line);
    if (clsM) {
      const name = clsM[1] ?? '';
      if (name && !SKIP.has(name)) {
        classes.push({ name, startLine: i + 1, exported: true });
      }
      continue;
    }

    const fnM = fnRe.exec(line);
    if (fnM) {
      const name = fnM[1] ?? '';
      if (name && !SKIP.has(name) && /^[a-zA-Z_]/.test(name)) {
        functions.push({ name, startLine: i + 1, exported: true, isAsync: false });
      }
    }
  }

  return { functions, classes };
}
