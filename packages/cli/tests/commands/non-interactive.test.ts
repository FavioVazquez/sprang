import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { execFileSync, execFileSync as run } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(HERE, '../../dist/index.js');

interface Result {
  code: number;
  stdout: string;
  stderr: string;
}

/** Run the built CLI with **no TTY and no stdin** — how CI, Docker, scripts and
 *  agents invoke it. */
function sprang(args: string[], cwd: string): Result {
  try {
    const stdout = run(process.execPath, [CLI, ...args], {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60_000,
    });
    return { code: 0, stdout, stderr: '' };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

describe('CLI behaviour without a TTY', () => {
  let dir: string;

  beforeAll(() => {
    if (!fs.existsSync(CLI)) throw new Error(`build the CLI first: ${CLI} missing`);
  });

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sprang-cli-'));
    execFileSync('git', ['init', '-q', '.'], { cwd: dir });
    fs.writeFileSync(path.join(dir, 'a.ts'), 'export const a = 1;\n');
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  describe('init', () => {
    it('scaffolds without a TTY instead of silently doing nothing', () => {
      // Regression: `rl.question` never fires its callback on EOF, so the
      // promise never settled, Node exited 0, and nothing was written — while
      // reporting success. This is the exact command the README documents.
      const res = sprang(['init', '--platform', 'devin'], dir);
      expect(res.code).toBe(0);
      expect(fs.existsSync(path.join(dir, '.devin'))).toBe(true);
      expect(fs.readdirSync(path.join(dir, '.devin', 'skills')).length).toBe(11);
      expect(fs.existsSync(path.join(dir, '.devin', 'mcp_config.json'))).toBe(true);
    });

    it('still honours an explicit path and -y', () => {
      expect(sprang(['init', '.', '--platform', 'claude'], dir).code).toBe(0);
      expect(fs.existsSync(path.join(dir, '.claude'))).toBe(true);
      fs.rmSync(path.join(dir, '.claude'), { recursive: true, force: true });
      expect(sprang(['init', '--platform', 'claude', '-y'], dir).code).toBe(0);
      expect(fs.existsSync(path.join(dir, '.claude'))).toBe(true);
    });

    it('rejects an unknown platform loudly', () => {
      const res = sprang(['init', '--platform', 'emacs'], dir);
      expect(res.code).not.toBe(0);
      expect(res.stderr).toMatch(/platform must be one of/);
    });
  });

  describe('exit codes when the graph is unusable', () => {
    const writeGraph = (d: string, contents: string) => {
      fs.mkdirSync(path.join(d, '.sprang'), { recursive: true });
      fs.writeFileSync(path.join(d, '.sprang', 'knowledge-graph.json'), contents);
    };

    it('health and query fail when there is no graph', () => {
      // `sprang health && deploy` must not proceed with nothing to report on.
      for (const args of [['health'], ['query', 'foo']]) {
        const res = sprang(args, dir);
        expect(res.code, args.join(' ')).toBe(1);
        expect(res.stderr).toMatch(/No knowledge graph found/);
      }
    });

    it('says the graph is invalid — not missing — and does not advise a re-scan', () => {
      writeGraph(dir, JSON.stringify({ metadata: { bogus: true }, nodes: 'not-an-array' }));
      for (const args of [['health'], ['query', 'foo'], ['diagram']]) {
        const res = sprang(args, dir);
        expect(res.code, args.join(' ')).toBe(1);
        expect(res.stderr).toMatch(/failed schema validation/);
        // Re-scanning overwrites the evidence and cannot fix an enrichment bug.
        expect(res.stderr).toMatch(/merge|analyze/);
      }
    });

    it('status reports a malformed graph instead of crashing', () => {
      // status is the command you reach for *because* something is wrong.
      writeGraph(dir, JSON.stringify({ metadata: {}, nodes: 'not-an-array' }));
      const res = sprang(['status'], dir);
      expect(res.code).toBe(0);
      expect(res.stdout + res.stderr).not.toMatch(/TypeError|Cannot read properties/);
      expect(res.stdout).toMatch(/malformed/);
    });

    it('no command crashes on a truncated graph file', () => {
      writeGraph(dir, '{"nodes": [');
      for (const args of [['health'], ['status'], ['diagram'], ['query', 'x']]) {
        const res = sprang(args, dir);
        expect(res.stdout + res.stderr, args.join(' ')).not.toMatch(
          /TypeError|SyntaxError|at Command|Node\.js v/,
        );
      }
    });
  });
});
