import { parsePython } from './python.js';
import { parseGo } from './go.js';
import { parseRust } from './rust.js';
import { parseJava } from './java.js';
import { parseRuby } from './ruby.js';
import { parsePhp } from './php.js';
import { parseC } from './c.js';
import { parseCSharp } from './csharp.js';
import { parseKotlin } from './kotlin.js';

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
    default: return { functions: [], classes: [] };
  }
}
