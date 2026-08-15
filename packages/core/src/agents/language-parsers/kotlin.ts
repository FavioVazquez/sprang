import type { ParsedSymbols } from './index.js';
import { runLineParser } from './line-parser.js';

/** Kotlin: public is the default, and `suspend` is the async marker. */
const isPublic = (_name: string, line: string): boolean =>
  !/\bprivate\b/.test(line) && !/\bprotected\b/.test(line);

export function parseKotlin(source: string): ParsedSymbols {
  return runLineParser(source, {
    rules: [
      {
        kind: 'class',
        pattern:
          /^\s*(?:(?:public|private|protected|internal|open|abstract|sealed|data|inner|value|companion|enum|annotation|actual|expect)\s+)*(?:class|interface|object)\s+(\w+)/,
        exported: isPublic,
      },
      {
        kind: 'function',
        pattern:
          /^\s*(?:(?:public|private|protected|internal|open|override|suspend|inline|operator|infix|tailrec|external|actual|expect)\s+)*fun\s+(?:<[^>]*>\s+)?(\w+)\s*[(<]/,
        exported: isPublic,
        isAsync: (line) => /\bsuspend\b/.test(line),
      },
    ],
  });
}
