import type { ParsedSymbols } from './index.js';

/**
 * Swift symbols.
 *
 * `.swift` was mapped to a language and listed as a source language since
 * before 0.2.4, but no parser was ever dispatched for it — so Swift projects
 * produced file nodes with no symbols at all while appearing to be supported.
 */
export function parseSwift(source: string): ParsedSymbols {
  const functions: ParsedSymbols['functions'] = [];
  const classes: ParsedSymbols['classes'] = [];
  const lines = source.split('\n');

  // [modifiers] func name[<T>](  — also matches `static func`, `mutating func`, `override func`
  const fnRe = /^\s*(?:(?:public|private|internal|fileprivate|open|static|class|final|override|mutating|nonmutating|convenience|required|@\w+)\s+)*func\s+(\w+)/;
  // init / deinit are real entry points and worth having as symbols
  const initRe = /^\s*(?:(?:public|private|internal|fileprivate|open|required|convenience|override)\s+)*(init|deinit)\b/;
  // class / struct / enum / protocol / actor / extension
  const typeRe = /^\s*(?:(?:public|private|internal|fileprivate|open|final|indirect|@\w+)\s+)*(?:class|struct|enum|protocol|actor|extension)\s+(\w+)/;

  // Swift has no export keyword: anything not explicitly private/fileprivate is
  // visible at least module-wide, which is the closest analogue.
  const isExported = (line: string) => !/\b(private|fileprivate)\b/.test(line);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';

    const fnM = fnRe.exec(line);
    if (fnM?.[1]) {
      functions.push({
        name: fnM[1],
        startLine: i + 1,
        exported: isExported(line),
        // `async` is a Swift keyword in the signature, after the parameter list.
        isAsync: /\basync\b/.test(line),
      });
      continue;
    }

    const initM = initRe.exec(line);
    if (initM?.[1]) {
      functions.push({
        name: initM[1],
        startLine: i + 1,
        exported: isExported(line),
        isAsync: /\basync\b/.test(line),
      });
      continue;
    }

    const tyM = typeRe.exec(line);
    if (tyM?.[1]) {
      classes.push({
        name: tyM[1],
        startLine: i + 1,
        exported: isExported(line),
      });
    }
  }

  return { functions, classes };
}
