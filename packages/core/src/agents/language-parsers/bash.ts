import type { ParsedSymbols } from './index.js';

/**
 * Shell functions.
 *
 * Shell scripts are frequently the glue that actually runs a project — CI
 * steps, deploy scripts, git hooks — so treating them as opaque files loses
 * real structure. `.sh`/`.bash`/`.zsh` were mapped to a language but never
 * dispatched to a parser.
 */
export function parseBash(source: string): ParsedSymbols {
  const functions: ParsedSymbols['functions'] = [];
  const lines = source.split('\n');

  // Both shell function forms:  `name() {`  and  `function name {`
  const parenRe = /^\s*(?:function\s+)?([A-Za-z_][\w:.-]*)\s*\(\s*\)\s*\{?/;
  const kwRe = /^\s*function\s+([A-Za-z_][\w:.-]*)\s*\{/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (/^\s*#/.test(line)) continue; // comment

    const m = kwRe.exec(line) ?? parenRe.exec(line);
    if (m?.[1]) {
      const name = m[1];
      // `if (...)`-style false positives and shell keywords.
      if (['if', 'while', 'until', 'for', 'case', 'select', 'time'].includes(name)) continue;
      functions.push({
        name,
        startLine: i + 1,
        // Shell has no visibility modifiers; a leading underscore is the
        // near-universal convention for "internal".
        exported: !name.startsWith('_'),
        isAsync: false,
      });
    }
  }

  return { functions, classes: [] };
}
