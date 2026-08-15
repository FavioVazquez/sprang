import { describe, it, expect } from 'vitest';
import {
  extractEnvRefs,
  summarizeEnvVars,
  detectEnvFileKind,
  ENV_SOURCES,
  SHELL_NAME_PATTERN,
} from '../../src/artifacts/env-vars.js';
import type { EnvVarRef } from '../../src/artifacts/env-vars.js';

const names = (refs: EnvVarRef[]): string[] => refs.map((r) => r.name);

// ─── file classification ──────────────────────────────────────────────────────

describe('detectEnvFileKind', () => {
  it('classifies dotenv variants', () => {
    expect(detectEnvFileKind('.env')).toBe('dotenv');
    expect(detectEnvFileKind('app/.env.example')).toBe('dotenv');
    expect(detectEnvFileKind('.env.sample')).toBe('dotenv');
    expect(detectEnvFileKind('.env.local')).toBe('dotenv');
  });

  it('classifies infra and code files', () => {
    expect(detectEnvFileKind('Dockerfile')).toBe('dockerfile');
    expect(detectEnvFileKind('ops/Dockerfile.prod')).toBe('dockerfile');
    expect(detectEnvFileKind('docker-compose.yml')).toBe('docker-compose');
    expect(detectEnvFileKind('.github/workflows/ci.yml')).toBe('github-actions');
    expect(detectEnvFileKind('k8s/deploy.yaml')).toBe('kubernetes');
    expect(detectEnvFileKind('infra/main.tf')).toBe('terraform');
    expect(detectEnvFileKind('src/app.ts')).toBe('js');
    expect(detectEnvFileKind('src/app.py')).toBe('python');
    expect(detectEnvFileKind('main.go')).toBe('go');
    expect(detectEnvFileKind('app.rb')).toBe('ruby');
    expect(detectEnvFileKind('deploy.sh')).toBe('shell');
    expect(detectEnvFileKind('Main.java')).toBe('java');
    expect(detectEnvFileKind('README.md')).toBe('unknown');
  });
});

// ─── JS / TS reads ────────────────────────────────────────────────────────────

describe('extractEnvRefs — JavaScript / TypeScript', () => {
  it('detects process.env.NAME', () => {
    const refs = extractEnvRefs('src/db.ts', 'const url = process.env.DATABASE_URL;');
    expect(refs).toEqual([
      {
        name: 'DATABASE_URL',
        file: 'src/db.ts',
        line: 1,
        kind: 'read',
        source: ENV_SOURCES.processEnv,
      },
    ]);
  });

  it("detects process.env['NAME'] bracket access", () => {
    const refs = extractEnvRefs('src/db.ts', "const k = process.env['STRIPE_KEY'];");
    expect(names(refs)).toEqual(['STRIPE_KEY']);
    expect(refs[0]?.source).toBe(ENV_SOURCES.processEnv);
  });

  it('detects import.meta.env.NAME (Vite)', () => {
    const refs = extractEnvRefs('src/client.ts', 'export const api = import.meta.env.VITE_API_URL;');
    expect(names(refs)).toEqual(['VITE_API_URL']);
    expect(refs[0]?.source).toBe(ENV_SOURCES.importMetaEnv);
  });

  it("detects Deno.env.get('NAME')", () => {
    const refs = extractEnvRefs('server.ts', "const t = Deno.env.get('DENO_TOKEN');");
    expect(names(refs)).toEqual(['DENO_TOKEN']);
    expect(refs[0]?.source).toBe(ENV_SOURCES.denoEnv);
  });

  it('reports correct 1-based line numbers across a multi-line file', () => {
    const src = ['// header', 'const a = 1;', 'const b = process.env.PORT;'].join('\n');
    const refs = extractEnvRefs('src/server.ts', src);
    expect(refs).toHaveLength(1);
    expect(refs[0]?.line).toBe(3);
  });
});

// ─── Python ───────────────────────────────────────────────────────────────────

describe('extractEnvRefs — Python', () => {
  it("detects os.environ['NAME']", () => {
    const refs = extractEnvRefs('app/settings.py', "SECRET = os.environ['SECRET_KEY']");
    expect(names(refs)).toEqual(['SECRET_KEY']);
    expect(refs[0]?.source).toBe(ENV_SOURCES.osEnviron);
  });

  it("detects os.environ.get('NAME') and os.getenv('NAME')", () => {
    const src = ["a = os.environ.get('A_VAR')", "b = os.getenv('B_VAR', 'default')"].join('\n');
    const refs = extractEnvRefs('app/settings.py', src);
    expect(names(refs).sort()).toEqual(['A_VAR', 'B_VAR']);
  });

  it('detects bare environ.get("NAME") from `from os import environ`', () => {
    const refs = extractEnvRefs('app/conf.py', 'x = environ.get("REDIS_URL")');
    expect(names(refs)).toEqual(['REDIS_URL']);
    expect(refs[0]?.source).toBe(ENV_SOURCES.osEnvironGet);
  });
});

// ─── Go / Ruby / Java ─────────────────────────────────────────────────────────

describe('extractEnvRefs — Go', () => {
  it('detects os.Getenv and os.LookupEnv', () => {
    const src = ['h := os.Getenv("HOST")', 'p, ok := os.LookupEnv("PORT")'].join('\n');
    const refs = extractEnvRefs('cmd/main.go', src);
    expect(names(refs)).toEqual(['HOST', 'PORT']);
    expect(refs[0]?.source).toBe(ENV_SOURCES.goGetenv);
    expect(refs[1]?.source).toBe(ENV_SOURCES.goLookupEnv);
  });
});

describe('extractEnvRefs — Ruby', () => {
  it("detects ENV['NAME'] and ENV.fetch('NAME')", () => {
    const src = ["url = ENV['RAILS_DB']", "key = ENV.fetch('RAILS_KEY')"].join('\n');
    const refs = extractEnvRefs('config/app.rb', src);
    expect(names(refs)).toEqual(['RAILS_DB', 'RAILS_KEY']);
    expect(refs[1]?.source).toBe(ENV_SOURCES.rubyEnvFetch);
  });
});

describe('extractEnvRefs — Java / Kotlin', () => {
  it('detects System.getenv("NAME")', () => {
    const refs = extractEnvRefs('src/Main.java', 'String s = System.getenv("JAVA_HOME");');
    expect(names(refs)).toEqual(['JAVA_HOME']);
    expect(refs[0]?.source).toBe(ENV_SOURCES.javaGetenv);
  });

  it('works for Kotlin files too', () => {
    const refs = extractEnvRefs('src/Main.kt', 'val s = System.getenv("KT_TOKEN")');
    expect(names(refs)).toEqual(['KT_TOKEN']);
  });
});

// ─── Shell (and the uppercase restriction) ────────────────────────────────────

describe('extractEnvRefs — shell', () => {
  it('detects $NAME and ${NAME}', () => {
    const refs = extractEnvRefs('deploy.sh', 'echo $DEPLOY_ENV\necho "${API_TOKEN}"');
    expect(names(refs).sort()).toEqual(['API_TOKEN', 'DEPLOY_ENV']);
    expect(refs[0]?.source).toBe(ENV_SOURCES.shellExpansion);
  });

  it('ignores lowercase and mixed-case shell variables', () => {
    const refs = extractEnvRefs('run.sh', 'for f in $files; do echo $f $myVar; done');
    expect(refs).toEqual([]);
  });

  it('ignores single-character names (length >= 2 restriction)', () => {
    const refs = extractEnvRefs('run.sh', 'echo $A $B ${C}\necho $LONG_ONE');
    expect(names(refs)).toEqual(['LONG_ONE']);
  });

  it('ignores positional and special parameters', () => {
    const refs = extractEnvRefs('run.sh', 'echo $1 $2 $@ $? $$ $*');
    expect(refs).toEqual([]);
  });

  it('handles ${NAME:-default} expansion syntax', () => {
    const refs = extractEnvRefs('run.sh', 'PORT_VALUE=${SERVER_PORT:-8080}');
    expect(names(refs)).toContain('SERVER_PORT');
  });

  it('exposes the documented shell name rule', () => {
    expect(SHELL_NAME_PATTERN.test('DATABASE_URL')).toBe(true);
    expect(SHELL_NAME_PATTERN.test('AB')).toBe(true);
    expect(SHELL_NAME_PATTERN.test('A')).toBe(false);
    expect(SHELL_NAME_PATTERN.test('lower_case')).toBe(false);
  });
});

// ─── Comment skipping ─────────────────────────────────────────────────────────

describe('extractEnvRefs — comment handling', () => {
  it('skips // line comments in JS/TS', () => {
    const src = ['// const old = process.env.OLD_VAR;', 'const n = process.env.NEW_VAR;'].join('\n');
    expect(names(extractEnvRefs('src/a.ts', src))).toEqual(['NEW_VAR']);
  });

  it('skips /* block */ comments in JS/TS', () => {
    const src = '/* process.env.BLOCKED */ const x = process.env.KEPT;';
    expect(names(extractEnvRefs('src/a.ts', src))).toEqual(['KEPT']);
  });

  it('skips # comments in Python', () => {
    const src = ['# os.getenv("COMMENTED")', 'v = os.getenv("REAL")'].join('\n');
    expect(names(extractEnvRefs('a.py', src))).toEqual(['REAL']);
  });

  it('does not treat # inside a quoted string as a comment', () => {
    const refs = extractEnvRefs('a.py', 'x = "# not a comment" + os.getenv("STILL_FOUND")');
    expect(names(refs)).toEqual(['STILL_FOUND']);
  });

  it('does not treat // inside a URL string as a comment', () => {
    const refs = extractEnvRefs('a.ts', 'const u = "https://x.dev" + process.env.SUFFIX;');
    expect(names(refs)).toEqual(['SUFFIX']);
  });
});

// ─── Declarations ─────────────────────────────────────────────────────────────

describe('extractEnvRefs — .env declarations', () => {
  it('detects NAME=value lines and skips comments and blanks', () => {
    const src = ['# comment', '', 'DATABASE_URL=postgres://x', 'export API_KEY=abc', '   '].join('\n');
    const refs = extractEnvRefs('.env.example', src);
    expect(names(refs)).toEqual(['DATABASE_URL', 'API_KEY']);
    expect(refs.every((r) => r.kind === 'declared')).toBe(true);
    expect(refs[0]?.source).toBe(ENV_SOURCES.dotenv);
    expect(refs[0]?.line).toBe(3);
  });

  it('handles .env.local and .env.sample the same way', () => {
    expect(names(extractEnvRefs('.env.local', 'A_VAR=1'))).toEqual(['A_VAR']);
    expect(names(extractEnvRefs('.env.sample', 'B_VAR=2'))).toEqual(['B_VAR']);
  });
});

describe('extractEnvRefs — Dockerfile declarations', () => {
  it('detects ENV NAME=value including multiple pairs', () => {
    const src = ['FROM node:20', 'ENV NODE_ENV=production APP_PORT=3000'].join('\n');
    const refs = extractEnvRefs('Dockerfile', src);
    expect(names(refs)).toEqual(['NODE_ENV', 'APP_PORT']);
    expect(refs[0]?.source).toBe(ENV_SOURCES.dockerfile);
  });

  it('detects the legacy `ENV NAME value` form', () => {
    const refs = extractEnvRefs('Dockerfile', 'ENV LEGACY_VAR some value');
    expect(names(refs)).toEqual(['LEGACY_VAR']);
  });
});

describe('extractEnvRefs — docker-compose declarations', () => {
  it('detects list-form environment entries', () => {
    const src = [
      'services:',
      '  web:',
      '    environment:',
      '      - DB_HOST=db',
      '      - DB_PORT',
      '    ports:',
      '      - "80:80"',
    ].join('\n');
    const refs = extractEnvRefs('docker-compose.yml', src);
    expect(names(refs)).toEqual(['DB_HOST', 'DB_PORT']);
    expect(refs[0]?.source).toBe(ENV_SOURCES.dockerCompose);
  });

  it('detects map-form environment entries and stops at the next key', () => {
    const src = [
      'services:',
      '  api:',
      '    environment:',
      '      REDIS_URL: redis://cache',
      '      LOG_LEVEL: debug',
      '    image: api:latest',
    ].join('\n');
    expect(names(extractEnvRefs('docker-compose.yml', src))).toEqual(['REDIS_URL', 'LOG_LEVEL']);
  });
});

describe('extractEnvRefs — Kubernetes declarations', () => {
  it('detects `- name: NAME` under an env: list', () => {
    const src = [
      'spec:',
      '  containers:',
      '    - name: api',
      '      env:',
      '        - name: SERVICE_TOKEN',
      '          value: abc',
      '        - name: SERVICE_MODE',
      '      image: api:1',
    ].join('\n');
    const refs = extractEnvRefs('k8s/deploy.yaml', src);
    expect(names(refs)).toEqual(['SERVICE_TOKEN', 'SERVICE_MODE']);
    expect(refs[0]?.source).toBe(ENV_SOURCES.kubernetes);
  });

  it('does not pick up container names outside the env block', () => {
    const src = ['spec:', '  containers:', '    - name: web', '    - name: sidecar'].join('\n');
    expect(extractEnvRefs('k8s/deploy.yaml', src)).toEqual([]);
  });
});

describe('extractEnvRefs — GitHub Actions declarations', () => {
  it('detects keys under env: at both top level and job level', () => {
    const src = [
      'name: ci',
      'env:',
      '  GLOBAL_TOKEN: x',
      'jobs:',
      '  build:',
      '    env:',
      '      JOB_TOKEN: y',
      '    steps:',
      '      - run: echo hi',
    ].join('\n');
    const refs = extractEnvRefs('.github/workflows/ci.yml', src);
    expect(names(refs)).toEqual(['GLOBAL_TOKEN', 'JOB_TOKEN']);
    expect(refs[0]?.source).toBe(ENV_SOURCES.githubActions);
  });
});

describe('extractEnvRefs — Terraform variables', () => {
  it('detects variable blocks with a distinct source token', () => {
    const src = ['variable "region" {', '  type = string', '}', 'variable "bucket_name" {}'].join('\n');
    const refs = extractEnvRefs('infra/main.tf', src);
    expect(names(refs)).toEqual(['region', 'bucket_name']);
    expect(refs.every((r) => r.source === ENV_SOURCES.terraform)).toBe(true);
    expect(refs[0]?.source).not.toBe(ENV_SOURCES.dotenv);
  });
});

// ─── Edge cases ───────────────────────────────────────────────────────────────

describe('extractEnvRefs — edge cases', () => {
  it('returns [] for empty input', () => {
    expect(extractEnvRefs('src/a.ts', '')).toEqual([]);
    expect(extractEnvRefs('.env', '')).toEqual([]);
  });

  it('returns [] for a file with no matches', () => {
    expect(extractEnvRefs('src/a.ts', 'export const two = 1 + 1;\n')).toEqual([]);
  });

  it('returns [] for an unknown file type', () => {
    expect(extractEnvRefs('README.md', 'process.env.NOT_SCANNED')).toEqual([]);
  });

  it('keeps duplicate refs to the same name within one file', () => {
    const src = ['const a = process.env.DUP;', 'const b = process.env.DUP;'].join('\n');
    const refs = extractEnvRefs('src/a.ts', src);
    expect(refs).toHaveLength(2);
    expect(refs.map((r) => r.line)).toEqual([1, 2]);
  });
});

// ─── summarizeEnvVars ─────────────────────────────────────────────────────────

describe('summarizeEnvVars', () => {
  it('returns [] for no refs', () => {
    expect(summarizeEnvVars([])).toEqual([]);
  });

  it('flags a variable that is read but never declared', () => {
    const refs = extractEnvRefs('src/pay.ts', 'const s = process.env.STRIPE_WEBHOOK_SECRET;');
    const summary = summarizeEnvVars(refs);
    expect(summary).toEqual([
      {
        name: 'STRIPE_WEBHOOK_SECRET',
        readBy: ['src/pay.ts'],
        declaredIn: [],
        undeclared: true,
      },
    ]);
  });

  it('does not flag a variable declared somewhere', () => {
    const refs = [
      ...extractEnvRefs('src/db.ts', 'const u = process.env.DATABASE_URL;'),
      ...extractEnvRefs('.env.example', 'DATABASE_URL=postgres://localhost'),
    ];
    const summary = summarizeEnvVars(refs);
    expect(summary).toHaveLength(1);
    expect(summary[0]?.undeclared).toBe(false);
    expect(summary[0]?.declaredIn).toEqual(['.env.example']);
  });

  it('does not flag a declared-but-never-read variable as undeclared', () => {
    const summary = summarizeEnvVars(extractEnvRefs('.env', 'UNUSED_VAR=1'));
    expect(summary[0]?.undeclared).toBe(false);
    expect(summary[0]?.readBy).toEqual([]);
  });

  it('dedupes files and sorts both file lists and the result', () => {
    const refs = [
      ...extractEnvRefs('src/z.ts', 'process.env.ZED; process.env.ZED;'),
      ...extractEnvRefs('src/a.ts', 'process.env.ZED;'),
      ...extractEnvRefs('src/a.ts', 'process.env.ALPHA;'),
    ];
    const summary = summarizeEnvVars(refs);
    expect(summary.map((s) => s.name)).toEqual(['ALPHA', 'ZED']);
    expect(summary[1]?.readBy).toEqual(['src/a.ts', 'src/z.ts']);
  });

  it('merges reads across languages into one entry', () => {
    const refs = [
      ...extractEnvRefs('src/a.ts', 'process.env.SHARED_TOKEN;'),
      ...extractEnvRefs('app.py', 'os.getenv("SHARED_TOKEN")'),
      ...extractEnvRefs('main.go', 'os.Getenv("SHARED_TOKEN")'),
      ...extractEnvRefs('Dockerfile', 'ENV SHARED_TOKEN=abc'),
    ];
    const summary = summarizeEnvVars(refs);
    expect(summary).toHaveLength(1);
    expect(summary[0]?.readBy).toEqual(['app.py', 'main.go', 'src/a.ts']);
    expect(summary[0]?.declaredIn).toEqual(['Dockerfile']);
    expect(summary[0]?.undeclared).toBe(false);
  });

  it('reports the realistic mixed case end to end', () => {
    const refs = [
      ...extractEnvRefs('src/pay.ts', 'process.env.STRIPE_WEBHOOK_SECRET;\nprocess.env.DATABASE_URL;'),
      ...extractEnvRefs('.env.example', 'DATABASE_URL=postgres://localhost\nLOG_LEVEL=info'),
    ];
    const summary = summarizeEnvVars(refs);
    expect(summary.map((s) => [s.name, s.undeclared])).toEqual([
      ['DATABASE_URL', false],
      ['LOG_LEVEL', false],
      ['STRIPE_WEBHOOK_SECRET', true],
    ]);
  });
});

describe('undeclared signal quality', () => {
  it('does not flag variables the runtime provides', () => {
    // A scan of this repository reported 48 of 50 variables as undeclared
    // before this gate — including CI, HOME and the editor's project
    // directory. A signal that fires on everything is not a signal.
    const refs = extractEnvRefs('src/a.ts', 'const x = process.env.CI;\nconst y = process.env.HOME;\n');
    const summary = summarizeEnvVars(refs);
    expect(summary.every((s) => !s.undeclared)).toBe(true);
  });

  it('treats a shell assignment as a declaration of that variable', () => {
    // `ACTION=deploy` then `$ACTION` is a local, not a missing env var.
    const refs = extractEnvRefs('deploy.sh', 'ACTION=deploy\necho "$ACTION"\n');
    const summary = summarizeEnvVars(refs);
    const action = summary.find((s) => s.name === 'ACTION');
    expect(action?.undeclared).toBe(false);
  });

  it('handles export, readonly and local forms of assignment', () => {
    for (const form of ['export FOO=1', 'readonly FOO=1', 'local FOO=1', 'declare -r FOO=1']) {
      const refs = extractEnvRefs('s.sh', `${form}\necho "$FOO"\n`);
      expect(summarizeEnvVars(refs).find((s) => s.name === 'FOO')?.undeclared).toBe(false);
    }
  });

  it('does not treat a commented assignment as a declaration', () => {
    const refs = extractEnvRefs('s.sh', '# FOO=1\necho "$FOO"\n');
    expect(summarizeEnvVars(refs).find((s) => s.name === 'FOO')?.undeclared).toBe(true);
  });

  it('still reports a genuinely missing application variable', () => {
    const refs = extractEnvRefs('src/pay.ts', 'const k = process.env.STRIPE_WEBHOOK_SECRET;\n');
    expect(summarizeEnvVars(refs).find((s) => s.name === 'STRIPE_WEBHOOK_SECRET')?.undeclared).toBe(true);
  });
});
