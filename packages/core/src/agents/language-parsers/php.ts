import type { ParsedSymbols } from './index.js';

export function parsePhp(source: string): ParsedSymbols {
  const functions: ParsedSymbols['functions'] = [];
  const classes: ParsedSymbols['classes'] = [];
  const lines = source.split('\n');

  // [public|private|protected] [static] function name(
  const fnRe =
    /^\s*(?:(?:public|private|protected|static|final|abstract)\s+)*function\s+(&?\s*\w+)\s*\(/;
  // [abstract|final] class Name or interface Name or trait Name
  const classRe =
    /^\s*(?:(?:abstract|final|readonly)\s+)*(?:class|interface|trait|enum)\s+(\w+)/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const clsM = classRe.exec(line);
    if (clsM) {
      const name = clsM[1] ?? '';
      if (name) {
        classes.push({
          name,
          startLine: i + 1,
          exported: true, // PHP has no explicit export; all top-level are available
        });
      }
      continue;
    }
    const fnM = fnRe.exec(line);
    if (fnM) {
      const name = (fnM[1] ?? '').replace(/^&\s*/, '');
      if (name && name !== '__construct') {
        const isPublic =
          /\bpublic\b/.test(line) ||
          (!/\bprivate\b/.test(line) && !/\bprotected\b/.test(line));
        functions.push({ name, startLine: i + 1, exported: isPublic, isAsync: false });
      }
    }
  }

  return { functions, classes };
}
