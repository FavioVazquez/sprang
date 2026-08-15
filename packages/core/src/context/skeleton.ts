/**
 * Scope-eliding source rendering ("skeletons").
 *
 * ## Why this beats sending whole files
 *
 * When an agent needs to know *where* something lives, the whole file is almost
 * entirely noise. A 900-line service class costs ~9,000 tokens, of which the
 * model needs maybe forty lines: the class header, the method it must change,
 * and the signatures around it. Sending the rest is not merely wasteful, it is
 * actively harmful — long irrelevant spans measurably degrade retrieval within
 * the context window ("lost in the middle") and push genuinely relevant files
 * out of the budget entirely.
 *
 * A skeleton keeps exactly the lines of interest plus the *enclosing scope
 * headers* that make them interpretable, and collapses everything else into a
 * single `⋮` marker. This is the highest information-per-token representation
 * of a source file we know of:
 *
 * - a bare signature list loses the nesting, so `save()` could be on any of six
 *   classes;
 * - a whole file wastes 90%+ of its tokens;
 * - a skeleton keeps the nesting *and* the elision markers, so the model can
 *   both locate the code and see that there is more it has not been shown —
 *   which is what prompts it to ask for the specific region it needs.
 *
 * ## Language-agnostic by design
 *
 * Scope detection is **purely indentation-based**. There is no parser, no
 * grammar, and no per-language configuration, so this works on TypeScript,
 * Python, Go, Ruby, YAML, Rust and anything else without a tree-sitter grammar
 * being available or loaded.
 *
 * For brace-style languages this means scope headers are inferred from
 * *indentation convention* rather than from the braces themselves. In practice
 * every formatter in wide use (Prettier, gofmt, rustfmt, clang-format) indents
 * block bodies, so this is right the overwhelming majority of the time. When it
 * is wrong — an Allman-braced C file where `{` sits on its own line, or a
 * hand-written file with erratic indentation — the failure mode is *benign*:
 * the header line picked is a nearby line at lower indentation, so the reader
 * sees slightly-off but still adjacent context. It never loses a line of
 * interest and never produces misleading code, because every emitted line is a
 * verbatim line from the source. Wrong-but-adjacent is a cost worth paying for
 * zero-dependency, all-language coverage.
 *
 * @module
 */

/** The elision marker used to stand in for one or more omitted lines. */
const ELISION = '⋮';

/** The suffix appended to a line that was truncated by `maxLineLength`. */
const TRUNCATION_SUFFIX = '…';

/** Maximum number of enclosing scope headers emitted per line of interest. */
const MAX_SCOPE_LEVELS = 3;

const DEFAULT_MAX_LINE_LENGTH = 200;

export interface SkeletonOptions {
  /** 1-based line numbers to keep. */
  linesOfInterest: number[];
  /** Include this many lines of context after each kept line. Default 0. */
  padding?: number;
  /** Truncate every emitted line to this many characters. Default 200. */
  maxLineLength?: number;
  /** Show a header line for the enclosing block of each LOI. Default true. */
  showEnclosingScope?: boolean;
}

/**
 * Split into lines, normalising CRLF and lone CR line endings.
 *
 * A single trailing empty line produced by a file-final newline is dropped, so
 * that a fully-covered file does not pick up a spurious trailing `⋮`.
 */
function splitLines(source: string): string[] {
  const normalised = source.replace(/\r\n?/g, '\n');
  const lines = normalised.split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/**
 * Leading-whitespace prefix of a line.
 *
 * A tab counts as **one indentation unit**, exactly like a space. Mixing tabs
 * and spaces within one file therefore produces slightly odd depths, but files
 * are overwhelmingly consistent in practice and treating a tab as N spaces
 * would require guessing N.
 */
function indentPrefix(line: string): string {
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (ch !== ' ' && ch !== '\t') break;
    i++;
  }
  return line.slice(0, i);
}

function indentWidth(line: string): number {
  return indentPrefix(line).length;
}

function isBlank(line: string): boolean {
  return line.trim().length === 0;
}

function truncate(line: string, maxLineLength: number): string {
  if (maxLineLength <= 0) return line;
  if (line.length <= maxLineLength) return line;
  return line.slice(0, maxLineLength) + TRUNCATION_SUFFIX;
}

/**
 * Collect the enclosing scope headers for a line of interest.
 *
 * Walks backward from `loi` looking for non-blank lines with *strictly smaller*
 * indentation, taking the nearest line at each successively smaller indentation
 * level. A method inside a class inside a namespace therefore contributes three
 * headers; the walk stops after {@link MAX_SCOPE_LEVELS} levels or once a
 * top-level (zero-indent) header has been captured.
 */
function collectScopeHeaders(lines: string[], loi: number): number[] {
  const target = lines[loi - 1];
  if (target === undefined) return [];

  const headers: number[] = [];
  let minIndent = indentWidth(target);

  for (let i = loi - 1; i >= 1 && headers.length < MAX_SCOPE_LEVELS; i--) {
    const line = lines[i - 1];
    if (line === undefined || isBlank(line)) continue;
    const width = indentWidth(line);
    if (width < minIndent) {
      headers.push(i);
      minIndent = width;
      if (width === 0) break;
    }
  }

  return headers;
}

/**
 * Render `source` down to the lines of interest, their enclosing scope headers
 * and `⋮` markers for everything in between.
 *
 * Behaviour notes:
 * - Kept lines are emitted in source order, deduplicated: a line that is both a
 *   line of interest and a scope header appears exactly once.
 * - Every run of one or more omitted lines — leading, interior or trailing —
 *   collapses to a single `⋮`. The marker carries the **indentation of the
 *   following kept line** (the last kept line, for a trailing run), which keeps
 *   the elision visually inside the block it elides and makes the output read
 *   as a valid outline rather than a diff.
 * - Out-of-range and duplicate line numbers are ignored silently, so callers
 *   can pass raw search hits without pre-filtering.
 * - Empty `source` or empty `linesOfInterest` produce the empty string.
 * - The returned string has no trailing newline.
 */
export function renderSkeleton(source: string, opts: SkeletonOptions): string {
  const {
    linesOfInterest,
    padding = 0,
    maxLineLength = DEFAULT_MAX_LINE_LENGTH,
    showEnclosingScope = true,
  } = opts;

  if (source.length === 0) return '';
  if (linesOfInterest.length === 0) return '';

  const lines = splitLines(source);
  if (lines.length === 0) return '';

  const validLois: number[] = [];
  for (const loi of linesOfInterest) {
    if (!Number.isInteger(loi)) continue;
    if (loi < 1 || loi > lines.length) continue;
    validLois.push(loi);
  }
  if (validLois.length === 0) return '';

  const keep = new Set<number>();
  const pad = Math.max(0, Math.floor(padding));

  for (const loi of validLois) {
    keep.add(loi);
    for (let i = 1; i <= pad; i++) {
      const line = loi + i;
      if (line <= lines.length) keep.add(line);
    }
    if (showEnclosingScope) {
      for (const header of collectScopeHeaders(lines, loi)) keep.add(header);
    }
  }

  const ordered = [...keep].sort((a, b) => a - b);

  const out: string[] = [];
  let previous = 0;

  for (const lineNo of ordered) {
    const text = lines[lineNo - 1] ?? '';
    if (lineNo > previous + 1) {
      out.push(indentPrefix(text) + ELISION);
    }
    out.push(truncate(text, maxLineLength));
    previous = lineNo;
  }

  const lastKept = ordered[ordered.length - 1];
  if (lastKept !== undefined && lastKept < lines.length) {
    out.push(indentPrefix(lines[lastKept - 1] ?? '') + ELISION);
  }

  return out.join('\n');
}

/**
 * Convenience wrapper: render a skeleton around a set of named symbols.
 *
 * `name` is not used for matching — the caller has already resolved each symbol
 * to a start line (via tree-sitter, ctags, or a plain search) — but it is part
 * of the signature so call sites read clearly and so a future implementation
 * can fall back to name search when `startLine` is unreliable.
 *
 * Duplicate start lines collapse, so passing overloads or a getter/setter pair
 * that share a line is safe.
 */
export function skeletonForSymbols(
  source: string,
  symbols: Array<{ name: string; startLine: number }>,
  opts?: Omit<SkeletonOptions, 'linesOfInterest'>,
): string {
  const linesOfInterest = [...new Set(symbols.map((s) => s.startLine))].sort((a, b) => a - b);
  return renderSkeleton(source, { ...opts, linesOfInterest });
}
