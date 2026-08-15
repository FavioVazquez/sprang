import { parsePython } from './python.js';
import { parseGo } from './go.js';
import { parseRust } from './rust.js';
import { parseJava } from './java.js';
import { parseRuby } from './ruby.js';
import { parsePhp } from './php.js';
import { parseC } from './c.js';
import { parseCSharp } from './csharp.js';
import { parseKotlin } from './kotlin.js';
import { parseSwift } from './swift.js';
import { parseBash } from './bash.js';
import { parseSql } from './sql.js';
import { parseTerraform } from './terraform.js';
import { parseWithTreeSitter } from './tree-sitter.js';
import type { ParserProvenance } from './provenance.js';

export interface ParsedSymbol {
  name: string;
  startLine: number;
  exported: boolean;
  isAsync: boolean;
}

export interface ParsedClass {
  name: string;
  startLine: number;
  exported: boolean;
}

export interface ParsedSymbols {
  functions: ParsedSymbol[];
  classes: ParsedClass[];
}

export function parseSymbols(lang: string, source: string): ParsedSymbols {
  switch (lang) {
    case 'python': return parsePython(source);
    case 'go': return parseGo(source);
    case 'rust': return parseRust(source);
    case 'java': return parseJava(source);
    case 'kotlin': return parseKotlin(source);
    case 'ruby': return parseRuby(source);
    case 'php': return parsePhp(source);
    case 'c':
    case 'cpp': return parseC(source);
    case 'csharp': return parseCSharp(source);
    // Added in 0.4.0. These four already had extension mappings and were listed
    // as source languages, but no case existed here — so a Swift or Terraform
    // project produced file nodes with zero symbols while appearing supported.
    case 'swift': return parseSwift(source);
    case 'bash': return parseBash(source);
    case 'sql': return parseSql(source);
    case 'terraform': return parseTerraform(source);
    default: return { functions: [], classes: [] };
  }
}

/**
 * Parse with the best backend available, and say which one ran.
 *
 * Tree-sitter first, regex as the floor. The floor matters: it needs no
 * toolchain, no build and no WASM support, so a scan never fails because a
 * grammar could not load. What must not happen is the two being
 * indistinguishable downstream, which is why the provenance comes back with
 * the symbols rather than being inferred later.
 */
export async function parseSymbolsBest(
  lang: string,
  source: string,
): Promise<{ symbols: ParsedSymbols; provenance: ParserProvenance }> {
  const regex = parseSymbols(lang, source);
  const ast = await parseWithTreeSitter(lang, source);

  // No grammar, or the parse failed: regex is the floor and always answers.
  if (!ast) return { symbols: regex, provenance: 'heuristic-regex' };

  // Union, not replacement.
  //
  // Grammars vary in quality and in what they name. The Kotlin and C grammars
  // in particular find fewer declarations than the hand-written regexes do,
  // and an "upgrade" that loses symbols is not an upgrade — every downstream
  // metric would quietly get worse on those languages. Taking the union means
  // tree-sitter can only ever add: the AST contributes the things regexes
  // structurally cannot see (methods inside classes, multi-line signatures,
  // declarations correctly ignored inside strings), and the regexes keep
  // whatever the grammar missed.
  const merge = <T extends { name: string; startLine: number }>(from: T[], into: T[]): T[] => {
    const seen = new Set(into.map((s) => `${s.name}:${s.startLine}`));
    // Also key on name alone within a small line window, since the two
    // backends disagree by a line on declarations preceded by decorators.
    const byName = new Map<string, number[]>();
    for (const s of into) {
      const lines = byName.get(s.name) ?? [];
      lines.push(s.startLine);
      byName.set(s.name, lines);
    }
    const out = [...into];
    for (const candidate of from) {
      if (seen.has(`${candidate.name}:${candidate.startLine}`)) continue;
      const near = (byName.get(candidate.name) ?? []).some(
        (line) => Math.abs(line - candidate.startLine) <= 2,
      );
      if (near) continue;
      out.push(candidate);
    }
    return out;
  };

  const symbols: ParsedSymbols = {
    functions: merge(regex.functions, ast.functions),
    classes: merge(regex.classes, ast.classes),
  };
  return { symbols, provenance: 'tree-sitter' };
}
