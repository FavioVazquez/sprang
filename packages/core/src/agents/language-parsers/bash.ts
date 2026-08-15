import type { ParsedSymbols } from './index.js';
import { runLineParser, exportedUnlessUnderscored, isHashComment } from './line-parser.js';

/**
 * Shell functions.
 *
 * Shell scripts are frequently the glue that actually runs a project — CI
 * steps, deploy scripts, git hooks — so treating them as opaque files loses
 * real structure.
 */
const SHELL_KEYWORDS = new Set(['if', 'while', 'until', 'for', 'case', 'select', 'time']);

export function parseBash(source: string): ParsedSymbols {
  return runLineParser(source, {
    ignoreLine: isHashComment,
    rules: [
      {
        kind: 'function',
        // `function name {` — tested first, since the paren form's optional
        // `function` prefix would otherwise not match this bodyless shape.
        pattern: /^\s*function\s+([A-Za-z_][\w:.-]*)\s*\{/,
        skip: SHELL_KEYWORDS,
        exported: exportedUnlessUnderscored,
        isAsync: () => false,
      },
      {
        kind: 'function',
        // `name() {`
        pattern: /^\s*(?:function\s+)?([A-Za-z_][\w:.-]*)\s*\(\s*\)\s*\{?/,
        skip: SHELL_KEYWORDS,
        exported: exportedUnlessUnderscored,
        isAsync: () => false,
      },
    ],
  });
}
