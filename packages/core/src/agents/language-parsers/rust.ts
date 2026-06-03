import type { ParsedSymbols } from './index.js';

export function parseRust(source: string): ParsedSymbols {
  const functions: ParsedSymbols['functions'] = [];
  const classes: ParsedSymbols['classes'] = [];
  const lines = source.split('\n');

  // pub [async] fn name  or  async fn name  or  fn name
  const fnRe = /^(\s*)(?:(pub(?:\([^)]*\))?)\s+)?(?:(async)\s+)?fn\s+(\w+)/;
  // pub struct Name  or  struct Name  or  pub enum Name  or  trait Name
  const typeRe = /^(\s*)(?:(pub(?:\([^)]*\))?)\s+)?(?:struct|enum|trait)\s+(\w+)/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const fnM = fnRe.exec(line);
    if (fnM) {
      const indent = fnM[1]?.length ?? 0;
      const isPub = !!fnM[2];
      const isAsync = fnM[3] === 'async';
      const name = fnM[4] ?? '';
      if (name) {
        functions.push({
          name,
          startLine: i + 1,
          exported: indent === 0 && isPub,
          isAsync,
        });
      }
      continue;
    }
    const typeM = typeRe.exec(line);
    if (typeM) {
      const indent = typeM[1]?.length ?? 0;
      const isPub = !!typeM[2];
      const name = typeM[3] ?? '';
      if (name) {
        classes.push({
          name,
          startLine: i + 1,
          exported: indent === 0 && isPub,
        });
      }
    }
  }

  return { functions, classes };
}
