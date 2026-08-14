import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadGraphResult, loadGraphOrNull } from '../../src/graph/store.js';

/**
 * `loadGraphOrNull` returns null for both "no graph" and "graph is broken",
 * which is why every CLI command told users to run `sprang scan` when the graph
 * existed and had merely failed validation — advice that overwrites the
 * evidence and cannot fix an enrichment bug.
 */
describe('loadGraphResult', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sprang-load-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const write = (contents: unknown) =>
    fs.writeFileSync(
      path.join(dir, 'knowledge-graph.json'),
      typeof contents === 'string' ? contents : JSON.stringify(contents),
    );

  it('reports GRAPH_NOT_FOUND when there is no file', async () => {
    const res = await loadGraphResult(dir);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('GRAPH_NOT_FOUND');
      expect(res.error.remedy).toMatch(/sprang scan/);
    }
  });

  it('reports GRAPH_INVALID — not NOT_FOUND — when the file exists but is wrong', async () => {
    write({ metadata: { bogus: true }, nodes: 'not-an-array' });

    const res = await loadGraphResult(dir);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('GRAPH_INVALID');
      // The old behaviour sent people to re-scan, destroying the evidence.
      expect(res.error.remedy).not.toMatch(/sprang scan/);
      expect(res.error.remedy).toMatch(/merge|analyze/);
      expect(res.error.code === 'GRAPH_INVALID' && res.error.validation_issues).toBeTruthy();
    }
    // the old loader cannot tell these apart, which is the bug
    expect(await loadGraphOrNull(dir)).toBeNull();
  });

  it('condenses the issue list instead of dumping every Zod error', async () => {
    write({ nodes: 'x' });
    const res = await loadGraphResult(dir);
    expect(res.ok).toBe(false);
    if (!res.ok && res.error.code === 'GRAPH_INVALID') {
      expect(res.error.validation_issues.split(';').length).toBeLessThanOrEqual(5);
      expect(res.error.validation_issues).toMatch(/\+\d+ more|:/);
    }
  });

  it('returns a failure — never throws — for a file that is not JSON at all', async () => {
    // A truncated or half-written graph used to throw out of the loader, so the
    // CLI died with a stack trace on exactly the file it was meant to diagnose.
    write('this is not json {');
    const res = await loadGraphResult(dir);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('GRAPH_READ_ERROR');
      // It must never be reported as "no graph here".
      expect(res.error.code).not.toBe('GRAPH_NOT_FOUND');
      expect(res.error.remedy).toBeTruthy();
    }
  });
});
