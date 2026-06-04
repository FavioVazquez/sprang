/**
 * Unit tests for the agent bridge modules.
 *
 * vi.mock is hoisted to file-top by Vitest (ESM limitation — module namespace
 * is not configurable so vi.spyOn doesn't work on node builtins). We share
 * mock fn instances and reconfigure them per-test via mockImplementation /
 * mockReturnValue. Each afterEach calls vi.restoreAllMocks() to reset.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// ─── Top-level mock — hoisted above imports ───────────────────────────────────
// These mock factories run first; the fn() references are stable across tests.
const mockExecFileSync = vi.fn();
const mockSpawnSync = vi.fn();

vi.mock('node:child_process', () => ({
  execFileSync: (...args: unknown[]) => mockExecFileSync(...args),
  spawnSync: (...args: unknown[]) => mockSpawnSync(...args),
}));

// Now import the modules under test (they will use the mocked child_process)
import {
  isWindsurfBridgeActive,
  isClaudeCLIAvailable,
  isCopilotCLIAvailable,
  detectBridge,
} from '../detect.js';
import { writeWindsurfTrigger, getWindsurfTriggerPath } from '../windsurf.js';
import { askClaude, clearClaudeSession } from '../claude.js';
import { askCopilot, clearCopilotSession } from '../copilot.js';
import { askAgent, clearAgentSession } from '../index.js';

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeTmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sprang-bridge-'));
  fs.mkdirSync(path.join(d, '.sprang'), { recursive: true });
  return d;
}

function cleanTmp(d: string): void {
  fs.rmSync(d, { recursive: true, force: true });
}

type SpawnResult = { pid: number; output: null[]; signal: null; status: number; stdout: string; stderr: string; error: undefined };

// Configure mockSpawnSync to return a fake result
function stubSpawnSync(result: Partial<SpawnResult>) {
  mockSpawnSync.mockReturnValue({
    pid: 1, output: [], signal: null, status: 0,
    stdout: '', stderr: '', error: undefined,
    ...result,
  });
  return mockSpawnSync;
}

// Configure mockExecFileSync to throw (CLI not found) or return a buffer
function stubExecFileSync(throws = true) {
  if (throws) {
    mockExecFileSync.mockImplementation(() => { throw new Error('not found'); });
  } else {
    mockExecFileSync.mockReturnValue(Buffer.from('1.0.0'));
  }
  return mockExecFileSync;
}

// Reset mock state before every test so implementations don't leak
beforeEach(() => {
  mockExecFileSync.mockReset();
  mockSpawnSync.mockReset();
});

// ─── detect.ts ───────────────────────────────────────────────────────────────

describe('isWindsurfBridgeActive', () => {
  let tmpDir: string;
  const origEnv = process.env['WINDSURF_CASCADE_TERMINAL_KIND'];
  beforeEach(() => { tmpDir = makeTmp(); delete process.env['WINDSURF_CASCADE_TERMINAL_KIND']; });
  afterEach(() => {
    cleanTmp(tmpDir);
    vi.restoreAllMocks();
    if (origEnv !== undefined) process.env['WINDSURF_CASCADE_TERMINAL_KIND'] = origEnv;
    else delete process.env['WINDSURF_CASCADE_TERMINAL_KIND'];
  });

  it('returns true when WINDSURF_CASCADE_TERMINAL_KIND env var is set', () => {
    process.env['WINDSURF_CASCADE_TERMINAL_KIND'] = 'inherit';
    expect(isWindsurfBridgeActive(tmpDir)).toBe(true);
  });

  it('returns false when env var unset and trigger file does not exist', () => {
    expect(isWindsurfBridgeActive(tmpDir)).toBe(false);
  });

  it('returns true when env var unset but trigger file exists (fallback)', () => {
    fs.writeFileSync(path.join(tmpDir, '.cascade-trigger-session'), 'hello');
    expect(isWindsurfBridgeActive(tmpDir)).toBe(true);
  });
});

describe('isClaudeCLIAvailable', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns false when claude CLI throws', () => {
    stubExecFileSync(true);
    expect(isClaudeCLIAvailable()).toBe(false);
  });

  it('returns true when claude CLI responds', () => {
    stubExecFileSync(false);
    expect(isClaudeCLIAvailable()).toBe(true);
  });
});

describe('isCopilotCLIAvailable', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns false when copilot CLI throws', () => {
    stubExecFileSync(true);
    expect(isCopilotCLIAvailable()).toBe(false);
  });

  it('returns true when copilot CLI responds', () => {
    stubExecFileSync(false);
    expect(isCopilotCLIAvailable()).toBe(true);
  });
});

describe('detectBridge priority', () => {
  let tmpDir: string;
  const origEnv = process.env['WINDSURF_CASCADE_TERMINAL_KIND'];
  beforeEach(() => { tmpDir = makeTmp(); delete process.env['WINDSURF_CASCADE_TERMINAL_KIND']; });
  afterEach(() => {
    cleanTmp(tmpDir); vi.restoreAllMocks();
    if (origEnv !== undefined) process.env['WINDSURF_CASCADE_TERMINAL_KIND'] = origEnv;
    else delete process.env['WINDSURF_CASCADE_TERMINAL_KIND'];
  });

  it('returns windsurf when trigger file is fresh (highest priority)', () => {
    // Even with CLIs available, windsurf wins if trigger is fresh
    stubExecFileSync(false);
    fs.writeFileSync(path.join(tmpDir, '.cascade-trigger-session'), 'alive');
    expect(detectBridge(tmpDir).kind).toBe('windsurf');
  });

  it('returns claude when no windsurf but claude available', () => {
    let calls = 0;
    mockExecFileSync.mockImplementation(() => {
      calls++;
      if (calls === 1) return Buffer.from('1.0.0');
      throw new Error('not found');
    });
    expect(detectBridge(tmpDir).kind).toBe('claude');
  });

  it('returns copilot when only copilot CLI available', () => {
    let calls = 0;
    mockExecFileSync.mockImplementation(() => {
      calls++;
      if (calls === 1) throw new Error('claude not found');
      return Buffer.from('1.0.0'); // copilot ok
    });
    expect(detectBridge(tmpDir).kind).toBe('copilot');
  });

  it('returns none when nothing available', () => {
    stubExecFileSync(true);
    const status = detectBridge(tmpDir);
    expect(status.kind).toBe('none');
    expect(status.detail).toContain('No agent bridge');
  });
});

// ─── windsurf.ts ─────────────────────────────────────────────────────────────

describe('writeWindsurfTrigger', () => {
  let tmpDir: string;
  beforeEach(() => { tmpDir = makeTmp(); });
  afterEach(() => { cleanTmp(tmpDir); });

  it('writes trigger file atomically with no .tmp leftover', () => {
    writeWindsurfTrigger('hello world', tmpDir);
    const p = getWindsurfTriggerPath(tmpDir);
    expect(fs.existsSync(p)).toBe(true);
    expect(fs.existsSync(p + '.tmp')).toBe(false);
    expect(fs.readFileSync(p, 'utf-8')).toContain('hello world');
  });

  it('wraps message with [SPRANG DASHBOARD MESSAGE] and sprang_respond', () => {
    writeWindsurfTrigger('what does auth.ts do?', tmpDir);
    const content = fs.readFileSync(getWindsurfTriggerPath(tmpDir), 'utf-8');
    expect(content).toContain('[SPRANG DASHBOARD MESSAGE');
    expect(content).toContain('sprang_respond');
    expect(content).toContain('what does auth.ts do?');
  });
});

// ─── claude.ts ───────────────────────────────────────────────────────────────

describe('askClaude', () => {
  let tmpDir: string;
  beforeEach(() => { tmpDir = makeTmp(); });
  afterEach(() => { cleanTmp(tmpDir); vi.restoreAllMocks(); });

  it('returns error when claude exits non-zero', () => {
    stubSpawnSync({ status: 1, stderr: 'auth error' });
    const result = askClaude('test', tmpDir);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('exited with code 1');
  });

  it('returns error when spawnSync itself throws', () => {
    mockSpawnSync.mockImplementation(() => { throw new Error('ENOMEM'); });
    const result = askClaude('test', tmpDir);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('ENOMEM');
  });

  it('parses JSON result line and saves session_id', () => {
    const fakeOut = JSON.stringify({ type: 'result', result: 'auth handles tokens', session_id: 'sess-123' });
    stubSpawnSync({ status: 0, stdout: fakeOut });
    const result = askClaude('what does auth.ts do?', tmpDir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.response).toBe('auth handles tokens');
      expect(result.session_id).toBe('sess-123');
    }
    const saved = JSON.parse(fs.readFileSync(path.join(tmpDir, '.sprang', 'claude-session.json'), 'utf-8')) as { session_id: string };
    expect(saved.session_id).toBe('sess-123');
  });

  it('uses --resume when prior session exists', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.sprang', 'claude-session.json'),
      JSON.stringify({ session_id: 'prev-sess', created_at: new Date().toISOString() }),
    );
    stubSpawnSync({
      status: 0,
      stdout: JSON.stringify({ type: 'result', result: 'ok', session_id: 'prev-sess' }),
    });
    askClaude('question', tmpDir);
    const args = (mockSpawnSync.mock.calls[0] as unknown as [string, string[]])[1];
    expect(args).toContain('--resume');
    expect(args).toContain('prev-sess');
  });

  it('falls back to plain text when output is not JSON', () => {
    stubSpawnSync({ status: 0, stdout: 'plain text answer' });
    const result = askClaude('test', tmpDir);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.response).toBe('plain text answer');
  });

  it('clearClaudeSession removes session file', () => {
    const f = path.join(tmpDir, '.sprang', 'claude-session.json');
    fs.writeFileSync(f, '{}');
    clearClaudeSession(tmpDir);
    expect(fs.existsSync(f)).toBe(false);
  });
});

// ─── copilot.ts ───────────────────────────────────────────────────────────────

describe('askCopilot', () => {
  let tmpDir: string;
  beforeEach(() => { tmpDir = makeTmp(); });
  afterEach(() => { cleanTmp(tmpDir); vi.restoreAllMocks(); });

  it('returns error when copilot exits non-zero', () => {
    stubSpawnSync({ status: 1, stderr: 'not authenticated' });
    const result = askCopilot('test', tmpDir);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('exited with code 1');
  });

  it('returns plain text response on success', () => {
    stubSpawnSync({ status: 0, stdout: 'auth.ts manages tokens' });
    const result = askCopilot('what does auth.ts do?', tmpDir);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.response).toBe('auth.ts manages tokens');
  });

  it('uses --resume=<id> when prior session exists', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.sprang', 'copilot-session.json'),
      JSON.stringify({ session_id: 'prev-copilot-sess', created_at: new Date().toISOString() }),
    );
    stubSpawnSync({ status: 0, stdout: 'response' });
    askCopilot('question', tmpDir);
    const args = (mockSpawnSync.mock.calls[0] as unknown as [string, string[]])[1];
    expect(args.some((a: string) => a.startsWith('--resume='))).toBe(true);
    expect(args.some((a: string) => a.includes('prev-copilot-sess'))).toBe(true);
  });

  it('does not use --resume on first session', () => {
    stubSpawnSync({ status: 0, stdout: 'response' });
    askCopilot('question', tmpDir);
    const args = (mockSpawnSync.mock.calls[0] as unknown as [string, string[]])[1];
    expect(args.some((a: string) => a.startsWith('--resume='))).toBe(false);
  });

  it('clearCopilotSession removes session file', () => {
    const f = path.join(tmpDir, '.sprang', 'copilot-session.json');
    fs.writeFileSync(f, '{}');
    clearCopilotSession(tmpDir);
    expect(fs.existsSync(f)).toBe(false);
  });
});

// ─── index.ts ─────────────────────────────────────────────────────────────────

describe('askAgent', () => {
  let tmpDir: string;
  const origEnv = process.env['WINDSURF_CASCADE_TERMINAL_KIND'];
  beforeEach(() => { tmpDir = makeTmp(); delete process.env['WINDSURF_CASCADE_TERMINAL_KIND']; });
  afterEach(() => {
    cleanTmp(tmpDir); vi.restoreAllMocks();
    if (origEnv !== undefined) process.env['WINDSURF_CASCADE_TERMINAL_KIND'] = origEnv;
    else delete process.env['WINDSURF_CASCADE_TERMINAL_KIND'];
  });

  it('returns mode=async for windsurf bridge and writes trigger file', () => {
    // Fresh trigger file → windsurf detected
    fs.writeFileSync(path.join(tmpDir, '.cascade-trigger-session'), 'alive');
    const result = askAgent('test question', tmpDir);
    expect(result.mode).toBe('async');
    expect(result.ok).toBe(true);
    const content = fs.readFileSync(path.join(tmpDir, '.cascade-trigger-session'), 'utf-8');
    expect(content).toContain('test question');
  });

  it('returns mode=sync+ok=false for none bridge', () => {
    // No trigger file, CLIs unavailable
    stubExecFileSync(true);
    const result = askAgent('test', tmpDir);
    expect(result.mode).toBe('sync');
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('writes cascade-response.json and returns mode=sync for claude bridge', () => {
    // No trigger file (no windsurf), claude CLI available
    stubExecFileSync(false); // execFileSync succeeds → claude available
    const fakeOut = JSON.stringify({ type: 'result', result: 'the answer', session_id: 's1' });
    stubSpawnSync({ status: 0, stdout: fakeOut });
    const result = askAgent('what does auth do?', tmpDir);
    expect(result.mode).toBe('sync');
    expect(result.ok).toBe(true);
    const respFile = path.join(tmpDir, '.sprang', 'cascade-response.json');
    expect(fs.existsSync(respFile)).toBe(true);
    const resp = JSON.parse(fs.readFileSync(respFile, 'utf-8')) as { bridge: string; response: string };
    expect(resp.bridge).toBe('claude');
    expect(resp.response).toBe('the answer');
  });

  it('clears previous response before sending', () => {
    fs.writeFileSync(path.join(tmpDir, '.cascade-trigger-session'), 'alive');
    const oldResp = path.join(tmpDir, '.sprang', 'cascade-response.json');
    fs.writeFileSync(oldResp, '{"response":"stale"}');
    askAgent('new question', tmpDir);
    expect(fs.existsSync(oldResp)).toBe(false);
  });

  it('clearAgentSession removes response + all session files', () => {
    const respFile = path.join(tmpDir, '.sprang', 'cascade-response.json');
    const claudeSession = path.join(tmpDir, '.sprang', 'claude-session.json');
    const copilotSession = path.join(tmpDir, '.sprang', 'copilot-session.json');
    fs.writeFileSync(respFile, '{}');
    fs.writeFileSync(claudeSession, '{}');
    fs.writeFileSync(copilotSession, '{}');
    clearAgentSession(tmpDir);
    expect(fs.existsSync(respFile)).toBe(false);
    expect(fs.existsSync(claudeSession)).toBe(false);
    expect(fs.existsSync(copilotSession)).toBe(false);
  });
});
