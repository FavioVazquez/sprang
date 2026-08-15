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
