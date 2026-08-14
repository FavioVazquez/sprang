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
import { isDevinLocalAvailable } from '../devin-local.js';
import {
  isDevinCLIAvailable,
  isClaudeCLIAvailable,
  isCopilotCLIAvailable,
  detectBridge,
} from '../detect.js';
import { writeRelayQuestion, getRelayQuestionPath } from '../relay.js';
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

describe('isDevinLocalAvailable', () => {
  let tmpDir: string;
  beforeEach(() => { tmpDir = makeTmp(); });
  afterEach(() => { cleanTmp(tmpDir); vi.restoreAllMocks(); });

  const marker = (root: string) => path.join(root, '.sprang', '.devin-bridge-active');

  it('is false without the bridge extension marker', () => {
    expect(isDevinLocalAvailable(tmpDir)).toBe(false);
  });

  it('is true while the bridge extension is active', () => {
    fs.writeFileSync(marker(tmpDir), new Date().toISOString());
    expect(isDevinLocalAvailable(tmpDir)).toBe(true);
  });

  it('ignores a marker left behind by a crashed window', () => {
    // Otherwise a stale marker would strand every question on a bridge that
    // has nothing listening, instead of falling through to a working one.
    const file = marker(tmpDir);
    fs.writeFileSync(file, 'old');
    const twoDaysAgo = Date.now() - 48 * 60 * 60 * 1000;
    fs.utimesSync(file, twoDaysAgo / 1000, twoDaysAgo / 1000);
    expect(isDevinLocalAvailable(tmpDir)).toBe(false);
  });
});

describe('isDevinCLIAvailable', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns false when the devin CLI is absent', () => {
    stubExecFileSync(true);
    expect(isDevinCLIAvailable()).toBe(false);
  });

  it('returns false when devin is installed but not logged in', () => {
    // The devin binary bundled inside Devin Desktop is present but
    // unauthenticated; driving it would fail with "Login canceled".
    mockExecFileSync.mockImplementation((_bin: unknown, args: unknown) => {
      const argv = args as string[];
      if (argv[0] === '--version') return Buffer.from('devin 3000.4.25');
      return Buffer.from('Not logged in.\n  Credentials path: /x/credentials.toml');
    });
    expect(isDevinCLIAvailable()).toBe(false);
  });

  it('returns true when devin is installed and authenticated', () => {
    mockExecFileSync.mockImplementation((_bin: unknown, args: unknown) => {
      const argv = args as string[];
      if (argv[0] === '--version') return Buffer.from('devin 3000.4.25');
      return Buffer.from('Logged in as someone@example.com');
    });
    expect(isDevinCLIAvailable()).toBe(true);
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
  beforeEach(() => { tmpDir = makeTmp(); });
  afterEach(() => { cleanTmp(tmpDir); vi.restoreAllMocks(); });

  /** Drive the sequence of execFileSync probes detectBridge makes. */
  function stubProbes(handler: (bin: string, argv: string[]) => Buffer) {
    mockExecFileSync.mockImplementation((bin: unknown, args: unknown) =>
      handler(bin as string, args as string[]));
  }

  it('prefers the local Devin session over every CLI', () => {
    // Devin local is already authenticated; the CLI needs a second, separate
    // login, so preferring the CLI would push users through pointless friction.
    stubProbes(() => Buffer.from('ok'));
    fs.writeFileSync(path.join(tmpDir, '.sprang', '.devin-bridge-active'), new Date().toISOString());
    expect(detectBridge(tmpDir).kind).toBe('devin-local');
  });

  it('prefers devin when an authenticated devin CLI is present', () => {
    stubProbes((bin) => {
      if (bin === 'devin') return Buffer.from('ok');
      return Buffer.from('1.0.0');
    });
    expect(detectBridge(tmpDir).kind).toBe('devin');
  });

  it('falls through to claude when devin is unauthenticated', () => {
    stubProbes((bin, argv) => {
      if (bin === 'devin' && argv[0] === 'auth') return Buffer.from('Not logged in.');
      if (bin === 'devin') return Buffer.from('devin 3000.4.25');
      if (bin === 'claude') return Buffer.from('1.0.0');
      throw new Error('not found');
    });
    expect(detectBridge(tmpDir).kind).toBe('claude');
  });

  it('returns copilot when only the copilot CLI is available', () => {
    stubProbes((bin) => {
      if (bin === 'copilot') return Buffer.from('1.0.0');
      throw new Error('not found');
    });
    expect(detectBridge(tmpDir).kind).toBe('copilot');
  });

  it('falls back to relay when no CLI is available', () => {
    // There is no "none" state any more: an IDE-hosted agent can still answer
    // through the sprang_respond MCP tool.
    stubExecFileSync(true);
    const status = detectBridge(tmpDir);
    expect(status.kind).toBe('relay');
    expect(status.detail).toContain('sprang_respond');
  });
});

// ─── relay.ts ─────────────────────────────────────────────────────────────

describe('writeRelayQuestion', () => {
  let tmpDir: string;
  beforeEach(() => { tmpDir = makeTmp(); });
  afterEach(() => { cleanTmp(tmpDir); });

  it('writes the question file atomically with no .tmp leftover', () => {
    writeRelayQuestion('hello world', tmpDir);
    const p = getRelayQuestionPath(tmpDir);
    expect(fs.existsSync(p)).toBe(true);
    expect(fs.existsSync(p + '.tmp')).toBe(false);
    expect(fs.readFileSync(p, 'utf-8')).toContain('hello world');
  });

  it('wraps the message with [SPRANG DASHBOARD MESSAGE] and a sprang_respond call', () => {
    const prompt = writeRelayQuestion('what does auth.ts do?', tmpDir);
    const content = fs.readFileSync(getRelayQuestionPath(tmpDir), 'utf-8');
    expect(content).toBe(prompt);
    expect(content).toContain('[SPRANG DASHBOARD MESSAGE]');
    expect(content).toContain('sprang_respond');
    expect(content).toContain('what does auth.ts do?');
  });

  it('JSON-escapes the question so the suggested call stays valid', () => {
    const prompt = writeRelayQuestion('what does "auth.ts" do?', tmpDir);
    expect(prompt).toContain('\\"auth.ts\\"');
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

describe('CLI spawn hygiene', () => {
  let tmpDir: string;
  beforeEach(() => { tmpDir = makeTmp(); });
  afterEach(() => { cleanTmp(tmpDir); vi.restoreAllMocks(); });

  it('closes stdin when spawning a CLI', () => {
    // Inheriting stdin from a long-lived server makes these CLIs block waiting
    // for piped input and then exit non-zero ("no stdin data received in 3s"),
    // which broke the bridge even with valid credentials. The prompt is passed
    // as an argument, so stdin must be closed.
    stubExecFileSync(false);
    stubSpawnSync({ status: 0, stdout: JSON.stringify({ type: 'result', result: 'ok', session_id: 's' }) });
    askClaude('question', tmpDir);
    const opts = mockSpawnSync.mock.calls[0]![2] as { stdio?: unknown };
    expect(opts.stdio).toEqual(['ignore', 'pipe', 'pipe']);
  });
});

describe('askAgent', () => {
  let tmpDir: string;
  beforeEach(() => { tmpDir = makeTmp(); });
  afterEach(() => { cleanTmp(tmpDir); vi.restoreAllMocks(); });

  it('stages the question for the bridge extension when Devin local is active', () => {
    stubExecFileSync(true);
    fs.writeFileSync(path.join(tmpDir, '.sprang', '.devin-bridge-active'), new Date().toISOString());
    const result = askAgent('what does auth.ts do?', tmpDir);
    expect(result.bridge).toBe('devin-local');
    expect(result.mode).toBe('async');
    // Same file the manual relay uses — the extension just performs the paste.
    const staged = fs.readFileSync(path.join(tmpDir, '.sprang', 'agent-question.md'), 'utf-8');
    expect(staged).toContain('what does auth.ts do?');
    expect(staged).toContain('sprang_respond');
  });

  it('stages the question for manual relay when no CLI is available', () => {
    stubExecFileSync(true);
    const result = askAgent('test question', tmpDir);
    expect(result.mode).toBe('async');
    expect(result.ok).toBe(true);
    expect(result.bridge).toBe('relay');
    expect(result.prompt).toContain('test question');
    const staged = fs.readFileSync(path.join(tmpDir, '.sprang', 'agent-question.md'), 'utf-8');
    expect(staged).toContain('test question');
  });

  it('reports the failure when the selected CLI bridge errors', () => {
    stubExecFileSync(false);            // a CLI is available…
    stubSpawnSync({ status: 1, stderr: 'boom' }); // …but the call fails
    const result = askAgent('test', tmpDir);
    expect(result.mode).toBe('sync');
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('writes cascade-response.json and returns mode=sync for the claude bridge', () => {
    // devin probe fails, claude probe succeeds
    mockExecFileSync.mockImplementation((bin: unknown) => {
      if (bin === 'devin') throw new Error('not found');
      return Buffer.from('1.0.0');
    });
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
    stubExecFileSync(true); // relay bridge
    const oldResp = path.join(tmpDir, '.sprang', 'cascade-response.json');
    fs.writeFileSync(oldResp, '{"response":"stale"}');
    askAgent('new question', tmpDir);
    expect(fs.existsSync(oldResp)).toBe(false);
  });

  it('clearAgentSession removes response + all session files', () => {
    const respFile = path.join(tmpDir, '.sprang', 'cascade-response.json');
    const claudeSession = path.join(tmpDir, '.sprang', 'claude-session.json');
    const copilotSession = path.join(tmpDir, '.sprang', 'copilot-session.json');
    const devinSession = path.join(tmpDir, '.sprang', 'devin-session.json');
    fs.writeFileSync(respFile, '{}');
    fs.writeFileSync(claudeSession, '{}');
    fs.writeFileSync(copilotSession, '{}');
    fs.writeFileSync(devinSession, '{}');
    clearAgentSession(tmpDir);
    expect(fs.existsSync(respFile)).toBe(false);
    expect(fs.existsSync(claudeSession)).toBe(false);
    expect(fs.existsSync(copilotSession)).toBe(false);
    expect(fs.existsSync(devinSession)).toBe(false);
  });
});
