import type { ParsedSymbols } from './index.js';

/**
 * SQL routines and tables.
 *
 * Schema files and migrations carry a lot of a system's real structure, and
 * `.sql` was mapped to a language with no parser. Tables and views are
 * reported as "classes" because they are the nearest analogue in the graph
 * schema: a named structure that other things reference.
 */
export function parseSql(source: string): ParsedSymbols {
  const functions: ParsedSymbols['functions'] = [];
  const classes: ParsedSymbols['classes'] = [];
  const lines = source.split('\n');

  const routineRe = /^\s*CREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE)\s+(?:IF\s+NOT\s+EXISTS\s+)?["`[]?([\w.]+)/i;
  const tableRe = /^\s*CREATE\s+(?:GLOBAL\s+|LOCAL\s+)?(?:TEMP(?:ORARY)?\s+|UNLOGGED\s+)?(?:TABLE|VIEW|MATERIALIZED\s+VIEW)\s+(?:IF\s+NOT\s+EXISTS\s+)?["`[]?([\w.]+)/i;
  const triggerRe = /^\s*CREATE\s+(?:OR\s+REPLACE\s+)?TRIGGER\s+["`[]?([\w.]+)/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (/^\s*(--|\/\*)/.test(line)) continue;

    const r = routineRe.exec(line) ?? triggerRe.exec(line);
    if (r?.[1]) {
      functions.push({ name: r[1], startLine: i + 1, exported: true, isAsync: false });
      continue;
    }
    const t = tableRe.exec(line);
    if (t?.[1]) {
      classes.push({ name: t[1], startLine: i + 1, exported: true });
    }
  }

  return { functions, classes };
}
