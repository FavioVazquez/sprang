import type { ParsedSymbols } from './index.js';
import { runLineParser, exportedIfCapitalised } from './line-parser.js';

/** Go: capitalisation is the visibility rule, and `init` is runtime-invoked. */
export function parseGo(source: string): ParsedSymbols {
  return runLineParser(source, {
    rules: [
      {
        kind: 'function',
        // func [( receiver )] Name[GenericParams]( ...
        pattern: /^func\s+(?:\([^)]*\)\s+)?(\w+)\s*[([{(]/,
        skip: new Set(['init']),
        exported: exportedIfCapitalised,
        isAsync: () => false,
      },
      {
        kind: 'class',
        pattern: /^type\s+(\w+)\s+(?:struct|interface)\s*\{/,
        exported: exportedIfCapitalised,
      },
    ],
  });
}
