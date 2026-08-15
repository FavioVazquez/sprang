import { describe, it, expect } from 'vitest';
import { parseSymbols } from '../../src/agents/language-parsers/index.js';
import { extractImportsForLanguage } from '../../src/agents/project-scanner.js';

/**
 * Swift, Bash, SQL and Terraform all had extension mappings and were listed as
 * source languages before 0.4.0, but `parseSymbols` had no case for any of
 * them — so those projects produced file nodes with zero symbols while
 * appearing to be supported. These tests pin the new parsers.
 */
describe('Swift', () => {
  const src = `
import Foundation
@testable import MyApp

public struct Account {
    let id: String
    public init(id: String) { self.id = id }
    public func balance() async -> Int { 0 }
    private func secret() -> Int { 1 }
}

protocol Payable {
    func pay()
}

extension Account: Payable {
    func pay() {}
}
`;
  const { functions, classes } = parseSymbols('swift', src);

  it('finds funcs, initialisers and async', () => {
    const names = functions.map((f) => f.name);
    expect(names).toContain('balance');
    expect(names).toContain('init');
    expect(names).toContain('secret');
    expect(functions.find((f) => f.name === 'balance')?.isAsync).toBe(true);
  });

  it('treats private as not exported (Swift has no export keyword)', () => {
    expect(functions.find((f) => f.name === 'secret')?.exported).toBe(false);
    expect(functions.find((f) => f.name === 'balance')?.exported).toBe(true);
  });

  it('finds struct, protocol and extension types', () => {
    const names = classes.map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(['Account', 'Payable']));
  });

  it('extracts imports, including @testable', () => {
    const imports = extractImportsForLanguage('swift', src);
    expect(imports).toEqual(expect.arrayContaining(['Foundation', 'MyApp']));
  });
});

describe('Bash', () => {
  const src = `
#!/usr/bin/env bash
source ./lib/common.sh
. "$HOME/.env"

deploy() {
  echo hi
}

function _internal {
  echo private
}

if [ -f x ]; then
  echo y
fi
`;
  it('finds both function forms and skips keywords', () => {
    const { functions } = parseSymbols('bash', src);
    const names = functions.map((f) => f.name);
    expect(names).toContain('deploy');
    expect(names).toContain('_internal');
    expect(names).not.toContain('if');
  });

  it('treats a leading underscore as internal', () => {
    const { functions } = parseSymbols('bash', src);
    expect(functions.find((f) => f.name === '_internal')?.exported).toBe(false);
    expect(functions.find((f) => f.name === 'deploy')?.exported).toBe(true);
  });

  it('extracts sourced files as imports', () => {
    const imports = extractImportsForLanguage('bash', src);
    expect(imports).toContain('./lib/common.sh');
  });
});

describe('SQL', () => {
  const src = `
-- a comment CREATE TABLE ignored
CREATE TABLE IF NOT EXISTS users (id int);
CREATE MATERIALIZED VIEW active_users AS SELECT 1;
CREATE OR REPLACE FUNCTION calc_total(a int) RETURNS int AS $$ SELECT 1 $$;
CREATE TRIGGER audit_users AFTER INSERT ON users EXECUTE PROCEDURE f();
`;
  it('finds tables and views as classes', () => {
    const { classes } = parseSymbols('sql', src);
    expect(classes.map((c) => c.name)).toEqual(
      expect.arrayContaining(['users', 'active_users']),
    );
  });

  it('finds routines and triggers as functions', () => {
    const { functions } = parseSymbols('sql', src);
    expect(functions.map((f) => f.name)).toEqual(
      expect.arrayContaining(['calc_total', 'audit_users']),
    );
  });

  it('ignores commented-out DDL', () => {
    const { classes } = parseSymbols('sql', '-- CREATE TABLE ghost (id int);\n');
    expect(classes).toHaveLength(0);
  });
});

describe('Terraform', () => {
  const src = `
# comment
resource "aws_s3_bucket" "logs" {
  bucket = "x"
}
data "aws_ami" "ubuntu" {}
module "vpc" {
  source = "../modules/vpc"
}
variable "region" {
  default = "us-east-1"
}
output "arn" {}
`;
  it('names resources by their Terraform address', () => {
    const { classes } = parseSymbols('terraform', src);
    const names = classes.map((c) => c.name);
    expect(names).toContain('aws_s3_bucket.logs');
    expect(names).toContain('aws_ami.ubuntu');
    expect(names).toContain('module.vpc');
  });

  it('treats variables and outputs as the module interface', () => {
    const { functions } = parseSymbols('terraform', src);
    const names = functions.map((f) => f.name);
    expect(names).toContain('variable.region');
    expect(names).toContain('output.arn');
  });

  it('extracts module sources as imports', () => {
    expect(extractImportsForLanguage('terraform', src)).toContain('../modules/vpc');
  });
});

describe('regression: previously-unsupported languages are no longer silent', () => {
  it.each(['swift', 'bash', 'sql', 'terraform'])('%s produces at least one symbol', (lang) => {
    const samples: Record<string, string> = {
      swift: 'func a() {}\n',
      bash: 'a() {\n echo 1\n}\n',
      sql: 'CREATE TABLE t (id int);\n',
      terraform: 'resource "r" "n" {\n}\n',
    };
    const { functions, classes } = parseSymbols(lang, samples[lang]!);
    expect(functions.length + classes.length).toBeGreaterThan(0);
  });
});

describe('language registry is a single source of truth', () => {
  it('every registered language has a parseSymbols case', async () => {
    const { SYMBOL_PARSED_LANGUAGES } = await import(
      '../../src/agents/language-parsers/provenance.js'
    );
    // A language in the registry with no dispatcher case returns empty for
    // everything — which is exactly how Swift looked "supported" for months.
    const probes: Record<string, string> = {
      typescript: 'export function a(){}\n',
      javascript: 'function a(){}\n',
      python: 'def a():\n  pass\n',
      go: 'func A() {}\n',
      rust: 'pub fn a() {}\n',
      java: 'public class A { void b() {} }\n',
      kotlin: 'class A { fun b() {} }\n',
      ruby: 'def a\nend\n',
      php: 'function a() {}\n',
      c: 'int a() { return 1; }\n',
      cpp: 'int a() { return 1; }\n',
      csharp: 'public class A { public void B() {} }\n',
      swift: 'func a() {}\n',
      bash: 'a() {\n echo 1\n}\n',
      sql: 'CREATE TABLE t (id int);\n',
      terraform: 'resource "r" "n" {\n}\n',
    };
    const missing: string[] = [];
    for (const lang of SYMBOL_PARSED_LANGUAGES) {
      const probe = probes[lang];
      expect(probe, `no probe defined for registered language "${lang}"`).toBeDefined();
      const { functions, classes } = parseSymbols(lang, probe!);
      // typescript/javascript are handled by the analyzer's native extractor,
      // not parseSymbols, so they are legitimately empty here.
      if (lang === 'typescript' || lang === 'javascript') continue;
      if (functions.length + classes.length === 0) missing.push(lang);
    }
    expect(missing, `registered but not parsed: ${missing.join(', ')}`).toEqual([]);
  });

  it('reports provenance honestly, never claiming more than regex today', async () => {
    const { parserProvenanceFor } = await import(
      '../../src/agents/language-parsers/provenance.js'
    );
    expect(parserProvenanceFor('swift')).toBe('heuristic-regex');
    expect(parserProvenanceFor('haskell')).toBe('none');
    expect(parserProvenanceFor(undefined)).toBe('none');
  });
});
