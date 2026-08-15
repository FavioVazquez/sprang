import type { ParsedSymbols } from './index.js';
import { runLineParser } from './line-parser.js';

/** PHP: no export keyword, so visibility is the access modifier. */
export function parsePhp(source: string): ParsedSymbols {
  return runLineParser(source, {
    rules: [
      {
        kind: 'class',
        pattern: /^\s*(?:(?:abstract|final|readonly)\s+)*(?:class|interface|trait|enum)\s+(\w+)/,
      },
      {
        kind: 'function',
        pattern:
          /^\s*(?:(?:public|private|protected|static|final|abstract)\s+)*function\s+(&?\s*\w+)\s*\(/,
        skip: new Set(['__construct']),
        // `function &getRef()` returns by reference; the ampersand is not part
        // of the name.
        transform: (m) => (m[1] ?? '').replace(/^&\s*/, ''),
        exported: (_name, line) =>
          /\bpublic\b/.test(line) || (!/\bprivate\b/.test(line) && !/\bprotected\b/.test(line)),
        isAsync: () => false,
      },
    ],
  });
}
