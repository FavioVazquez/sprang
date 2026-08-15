import type { ParsedSymbols } from './index.js';
import { runLineParser, isSlashComment } from './line-parser.js';

/**
 * C and C++.
 *
 * The class rule is listed first deliberately: the function pattern is loose
 * enough to match `class Foo {`, so testing functions first would classify
 * every class as a function. C has no export keyword, so everything at file
 * scope is treated as visible.
 */
const SKIP = new Set([
  'if', 'for', 'while', 'switch', 'do', 'else', 'return',
  'sizeof', 'typedef', 'namespace', 'extern', 'inline',
]);

export function parseC(source: string): ParsedSymbols {
  return runLineParser(source, {
    ignoreLine: (trimmed) => trimmed.startsWith('#') || isSlashComment(trimmed),
    rules: [
      {
        kind: 'class',
        pattern: /^(?:(?:template\s*<[^>]*>\s*)?(?:class|struct|union))\s+(\w+)/,
        skip: SKIP,
      },
      {
        kind: 'function',
        // return_type[*] name( at file scope, no semicolon on the same line.
        pattern:
          /^(?!#|\/\/|typedef\s)(?:(?:static|inline|extern|const)\s+)*[\w*][\w*\s]*\s(\w+)\s*\((?:[^;{)]*)\s*\)\s*(?:const\s*)?(?:\{|$)/,
        skip: SKIP,
        isAsync: () => false,
        transform: (m) => {
          const name = m[1] ?? '';
          // A leading digit means the regex caught an expression, not a decl.
          return /^[a-zA-Z_]/.test(name) ? name : null;
        },
      },
    ],
  });
}
