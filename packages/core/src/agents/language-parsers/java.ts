import type { ParsedSymbols } from './index.js';
import { runLineParser } from './line-parser.js';

/**
 * Java.
 *
 * Types are tested before methods: the method pattern is permissive enough to
 * match a class declaration's header, so the order is load-bearing.
 */
const CONTROL_FLOW = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'else', 'new', 'return', 'throw',
]);

const isPublic = (_name: string, line: string): boolean => /\bpublic\b/.test(line);

export function parseJava(source: string): ParsedSymbols {
  return runLineParser(source, {
    rules: [
      {
        kind: 'class',
        pattern:
          /^\s*(?:(?:public|private|protected|static|final|abstract)\s+)*(?:class|interface|enum|record)\s+(\w+)/,
        exported: isPublic,
      },
      {
        kind: 'function',
        pattern:
          /^\s*(?:(?:public|private|protected|static|final|synchronized|native|abstract|default)\s+)*(?!class\s|interface\s|enum\s)(?:[\w<>[\],\s.]+\s+)?(\w+)\s*\(/,
        skip: CONTROL_FLOW,
        exported: isPublic,
        isAsync: () => false,
      },
    ],
  });
}
