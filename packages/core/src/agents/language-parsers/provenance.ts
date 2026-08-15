/**
 * How a file's symbols were actually extracted.
 *
 * Sprang's parsers are line-oriented regular expressions. That is a legitimate
 * engineering trade — it works on a bare `git clone` with no toolchain, no
 * build, and no language server — but it is materially less accurate than an
 * AST, and consumers deserve to know which one produced the edges they are
 * reasoning about.
 *
 * Presenting a regex-derived call edge with the same authority as a resolved
 * one is the quiet dishonesty that erodes trust in every other number the tool
 * reports. An explicit fallback is fine; a silent one is not.
 */
export type ParserProvenance =
  /** Line-oriented regular expressions. Names and line numbers only. */
  | 'heuristic-regex'
  /** Reserved for the tree-sitter backend. */
  | 'tree-sitter'
  /** Recognised file type, but no symbol extraction is attempted. */
  | 'none';

/**
 * THE registry of languages Sprang can extract symbols from.
 *
 * This exists because the same list used to be written out by hand in three
 * places — the extension map, the scanner's `SOURCE_LANGUAGES`, and the file
 * analyzer's `SUPPORTED_LANGS` — and they silently disagreed. Swift was in two
 * of the three, so Swift files were scanned, counted as source, and reported as
 * supported, while the analyzer skipped them and produced no symbols at all.
 *
 * Anything added here must have a case in `parseSymbols`. Adding a language in
 * only one place is exactly the bug this replaces.
 */
export const SYMBOL_PARSED_LANGUAGES = new Set([
  'typescript', 'javascript', 'python', 'go', 'rust', 'java', 'kotlin',
  'ruby', 'php', 'c', 'cpp', 'csharp', 'swift', 'bash', 'sql', 'terraform',
]);

export function parserProvenanceFor(language: string | undefined): ParserProvenance {
  if (!language) return 'none';
  return SYMBOL_PARSED_LANGUAGES.has(language) ? 'heuristic-regex' : 'none';
}
