import type { ParsedSymbols } from './index.js';
import { runLineParser } from './line-parser.js';

/**
 * Ruby.
 *
 * Top-level indentation stands in for visibility: a `def` at column zero is
 * reachable from anywhere, one nested inside a class is not, and a leading
 * underscore is the community's private marker.
 */
const atTopLevel = (line: string): boolean => /^\S/.test(line);

export function parseRuby(source: string): ParsedSymbols {
  return runLineParser(source, {
    rules: [
      {
        kind: 'function',
        pattern: /^(\s*)def\s+(?:self\.)?(\w+)/,
        transform: (m) => m[2] ?? '',
        exported: (name, line) => atTopLevel(line) && !name.startsWith('_'),
        isAsync: () => false,
      },
      {
        kind: 'class',
        pattern: /^(\s*)(?:class|module)\s+(\w+)/,
        transform: (m) => m[2] ?? '',
        exported: (_name, line) => atTopLevel(line),
      },
    ],
  });
}
