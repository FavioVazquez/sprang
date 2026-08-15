import type { ParsedSymbols } from './index.js';

/**
 * A declarative line parser, shared by the regex language backends.
 *
 * Sprang's own clone detector found `parseC` and `parseGo` at similarity 1.0,
 * and it was right: every one of these parsers splits the source into lines,
 * runs one regex for functions and one for classes, skips a handful of
 * keywords, and pushes the captures. Twelve copies of that loop is twelve
 * places for a fix to be applied eleven times.
 *
 * Expressing the differences as data leaves each language file holding only
 * what is actually language-specific — its patterns and its notion of what
 * "exported" means — which is the only part worth reading.
 *
 * Deliberately still line-oriented. Tree-sitter is the accurate backend and
 * runs first when a grammar loads; this is the floor that works with no
 * toolchain at all, and making the floor cleverer would only make it slower to
 * be wrong.
 */
export interface LineRule {
  /** Applied to each line; capture group 1 must be the symbol name. */
  pattern: RegExp;
  /** Names to ignore — usually control-flow keywords a loose regex catches. */
  skip?: ReadonlySet<string>;
  /** Whether the symbol is visible outside its module. Defaults to true. */
  exported?: (name: string, line: string) => boolean;
  /** Only for function rules. Defaults to detecting `async`. */
  isAsync?: (line: string) => boolean;
  /** Rename the capture, e.g. Terraform's `resource "type" "name"` address. */
  transform?: (match: RegExpExecArray, line: string) => string | null;
}

export interface LineParserSpec {
  /**
   * Rules in priority order; the first match on a line wins.
   *
   * A single ordered list rather than separate function and class lists,
   * because the order between the two kinds is itself language-specific: C
   * must test `class Foo {` before its function pattern, since the function
   * regex is loose enough to match a class declaration. Two lists would have
   * silently changed C's behaviour during this refactor.
   */
  rules: Array<LineRule & { kind: 'function' | 'class' }>;
  /** Lines to ignore entirely, typically comments. */
  ignoreLine?: (trimmed: string) => boolean;
}

const DEFAULT_ASYNC = (line: string): boolean => /\basync\b/.test(line);

/**
 * Run a spec over source, returning the symbols it declares.
 *
 * One pass, first matching rule wins per line. A rule that matches but whose
 * name is skipped or empty consumes the line rather than falling through to a
 * looser rule below — matching the behaviour of the hand-written parsers,
 * where a `continue` followed the match, not the push.
 */
export function runLineParser(source: string, spec: LineParserSpec): ParsedSymbols {
  const functions: ParsedSymbols['functions'] = [];
  const classes: ParsedSymbols['classes'] = [];
  const lines = source.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const trimmed = line.trim();
    if (trimmed === '') continue;
    if (spec.ignoreLine?.(trimmed)) continue;

    for (const rule of spec.rules) {
      rule.pattern.lastIndex = 0;
      const m = rule.pattern.exec(line);
      if (!m) continue;

      const name = rule.transform ? rule.transform(m, line) : (m[1] ?? '');
      if (name && !rule.skip?.has(name)) {
        if (rule.kind === 'function') {
          functions.push({
            name,
            startLine: i + 1,
            exported: rule.exported ? rule.exported(name, line) : true,
            isAsync: (rule.isAsync ?? DEFAULT_ASYNC)(line),
          });
        } else {
          classes.push({
            name,
            startLine: i + 1,
            exported: rule.exported ? rule.exported(name, line) : true,
          });
        }
      }
      break;
    }
  }

  return { functions, classes };
}

/** Exported when the name starts with a capital. Go, and Elixir-ish languages. */
export const exportedIfCapitalised = (name: string): boolean => /^[A-Z]/.test(name);

/** Not exported when the name starts with an underscore. The widest convention. */
export const exportedUnlessUnderscored = (name: string): boolean => !name.startsWith('_');

/** Common comment prefixes, for `ignoreLine`. */
export const isHashComment = (trimmed: string): boolean => trimmed.startsWith('#');
export const isSlashComment = (trimmed: string): boolean =>
  trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
