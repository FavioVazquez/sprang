import { test, expect, type APIRequestContext } from '@playwright/test';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

/**
 * Platform bridge e2e — exercises the REAL pipeline for every agent bridge
 * through the dashboard HTTP endpoints, with mock platform CLIs on PATH
 * (see playwright.bridge.config.ts):
 *
 *   POST /agent-ask → detectBridge → spawn CLI (devin/claude/copilot) or stage
 *   the relay question → background parse → .sprang/cascade-response.json
 *   → GET /agent-response
 *
 * Unlike the vitest bridge unit tests (which stub spawnSync), nothing here is
 * stubbed: the preview server really spawns the mock executables, really
 * parses their stdout, really persists session files, and really writes the
 * response file the dashboard polls.
 *
 * Detection priority is devin → claude → copilot → relay, so each environment
 * shadows the higher-priority CLIs it must not select.
 */

const CLAUDE_URL = 'http://localhost:4174';
const COPILOT_URL = 'http://localhost:4175';
const DEVIN_URL = 'http://localhost:4176';
const RELAY_URL = 'http://localhost:4177';

// Playwright runs from packages/dashboard — these match SPRANG_ROOT of each server
const claudeRoot = join(process.cwd(), 'e2e', '.bridge-root-claude');
const copilotRoot = join(process.cwd(), 'e2e', '.bridge-root-copilot');
const devinRoot = join(process.cwd(), 'e2e', '.bridge-root-devin');
const relayRoot = join(process.cwd(), 'e2e', '.bridge-root-relay');
const claudeLog = join(claudeRoot, 'mock-claude-args.log');
const copilotLog = join(copilotRoot, 'mock-copilot-args.log');
const devinLog = join(devinRoot, 'mock-devin-args.log');

test.describe.configure({ mode: 'serial' });

interface AskBody {
  ok: boolean;
  sent: string;
  mode: string;
  bridge: string;
  prompt?: string;
}

async function ask(request: APIRequestContext, baseURL: string, message: string): Promise<AskBody> {
  const res = await request.post(`${baseURL}/agent-ask`, {
    data: { message },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(res.status()).toBe(200);
  const body = (await res.json()) as AskBody;
  expect(body.ok).toBe(true);
  return body;
}

interface AgentResponse {
  response: string;
  question: string;
  bridge?: string;
  session_id?: string;
  written_at: string;
}

async function waitForAgentResponse(
  request: APIRequestContext,
  baseURL: string,
  timeoutMs = 15000,
): Promise<AgentResponse> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await request.get(`${baseURL}/agent-response`);
    if (res.status() === 200) return (await res.json()) as AgentResponse;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`No agent response within ${timeoutMs}ms`);
}

/** Split the mock CLI argv log into per-invocation argv arrays. */
function readCalls(logPath: string): string[][] {
  if (!fs.existsSync(logPath)) return [];
  return fs
    .readFileSync(logPath, 'utf-8')
    .split('---CALL---')
    .map((block) => block.split('\n').map((l) => l.trim()).filter(Boolean))
    .filter((args) => args.length > 0);
}

async function waitForFile(path: string, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(path)) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`File not written within ${timeoutMs}ms: ${path}`);
}

// ---------------------------------------------------------------------------
// Claude Code bridge (mock `claude` CLI on PATH, port 4174)
// ---------------------------------------------------------------------------

test('claude bridge – /bridge-status detects claude CLI', async ({ request }) => {
  const res = await request.get(`${CLAUDE_URL}/bridge-status`);
  expect(res.status()).toBe(200);
  const status = (await res.json()) as { kind: string; detail: string };
  expect(status.kind).toBe('claude');
});

test('claude bridge – full ask pipeline: spawn, parse, session persist, response file', async ({
  request,
}) => {
  await ask(request, CLAUDE_URL, 'What is the health of this codebase?');

  const payload = await waitForAgentResponse(request, CLAUDE_URL);
  expect(payload.response).toContain('Mock Claude answer');
  expect(payload.bridge).toBe('claude');
  expect(payload.session_id).toBe('mock-claude-session-1');
  expect(payload.question).toBe('What is the health of this codebase?');

  // Session persisted for continuity
  const sessionFile = join(claudeRoot, '.sprang', 'claude-session.json');
  expect(fs.existsSync(sessionFile)).toBe(true);
  const session = JSON.parse(fs.readFileSync(sessionFile, 'utf-8')) as { session_id: string };
  expect(session.session_id).toBe('mock-claude-session-1');

  // The CLI was invoked with the documented contract
  const calls = readCalls(claudeLog);
  expect(calls.length).toBe(1);
  const argv = calls[0]!;
  expect(argv).toContain('-p');
  expect(argv).toContain('--output-format');
  expect(argv).toContain('json');
  expect(argv.join(' ')).toContain('What is the health of this codebase?');
  // MCP tool allowlist includes sprang_respond (the dashboard return path)
  const allowed = argv[argv.indexOf('--allowedTools') + 1] ?? '';
  expect(allowed).toContain('mcp__sprang__sprang_respond');
  expect(allowed).toContain('mcp__sprang__sprang_query');
  // First call must NOT resume
  expect(argv).not.toContain('--resume');
});

test('claude bridge – second ask resumes the persisted session', async ({ request }) => {
  await ask(request, CLAUDE_URL, 'And what about circular dependencies?');
  await waitForAgentResponse(request, CLAUDE_URL);

  const calls = readCalls(claudeLog);
  expect(calls.length).toBe(2);
  const argv = calls[1]!;
  const resumeIdx = argv.indexOf('--resume');
  expect(resumeIdx).toBeGreaterThan(-1);
  expect(argv[resumeIdx + 1]).toBe('mock-claude-session-1');
});

// ---------------------------------------------------------------------------
// Devin CLI bridge, unauthenticated (port 4174 — the claude environment also
// carries a mock `devin` that reports "Not logged in")
// ---------------------------------------------------------------------------

test('devin bridge – an installed but unauthenticated devin is skipped in favour of claude', async ({
  request,
}) => {
  // Precondition: a `devin` binary really is on that server's PATH…
  const mockDevin = join(claudeRoot, 'bin', 'devin');
  expect(fs.existsSync(mockDevin)).toBe(true);
  // …it answers --version…
  expect(execFileSync(mockDevin, ['--version'], { encoding: 'utf-8' })).toContain('devin');
  // …but it is not logged in, exactly like the copy bundled with Devin Desktop.
  expect(execFileSync(mockDevin, ['auth', 'status'], { encoding: 'utf-8' })).toMatch(/not logged in/i);

  // Detection must therefore fall through devin → claude.
  const status = (await (await request.get(`${CLAUDE_URL}/bridge-status`)).json()) as {
    kind: string;
  };
  expect(status.kind).toBe('claude');
});

// ---------------------------------------------------------------------------
// Devin CLI bridge (mock authenticated `devin` on PATH, port 4176)
// ---------------------------------------------------------------------------

test('devin bridge – /bridge-status detects an authenticated devin CLI', async ({ request }) => {
  const res = await request.get(`${DEVIN_URL}/bridge-status`);
  expect(res.status()).toBe(200);
  const status = (await res.json()) as { kind: string; detail: string };
  expect(status.kind).toBe('devin');
});

test('devin bridge – full ask pipeline: spawn, parse, response file', async ({ request }) => {
  const body = await ask(request, DEVIN_URL, 'What is the health of this codebase?');
  expect(body.bridge).toBe('devin');

  const payload = await waitForAgentResponse(request, DEVIN_URL);
  expect(payload.response).toContain('Mock Devin answer');
  expect(payload.bridge).toBe('devin');
  expect(payload.question).toBe('What is the health of this codebase?');

  // The answer really landed in the one response file every bridge writes
  const responseFile = join(devinRoot, '.sprang', 'cascade-response.json');
  await waitForFile(responseFile);
  const onDisk = JSON.parse(fs.readFileSync(responseFile, 'utf-8')) as { bridge: string };
  expect(onDisk.bridge).toBe('devin');

  // Print mode was invoked with the documented contract
  const calls = readCalls(devinLog);
  expect(calls.length).toBe(1);
  const argv = calls[0]!;
  expect(argv).toContain('-p');
  expect(argv).toContain('--permission-mode');
  expect(argv).toContain('--respect-workspace-trust');
  expect(argv.join(' ')).toContain('What is the health of this codebase?');
  // First call must NOT continue a previous conversation
  expect(argv).not.toContain('--continue');
});

test('devin bridge – second ask continues the recorded conversation', async ({ request }) => {
  // A turn was recorded by the previous test, so `-c` should now be passed.
  expect(fs.existsSync(join(devinRoot, '.sprang', 'devin-session.json'))).toBe(true);

  await ask(request, DEVIN_URL, 'And what about circular dependencies?');
  await waitForAgentResponse(request, DEVIN_URL);

  const calls = readCalls(devinLog);
  expect(calls.length).toBe(2);
  expect(calls[1]!).toContain('--continue');
});

// ---------------------------------------------------------------------------
// Relay bridge (no drivable agent CLI on PATH, port 4177)
// ---------------------------------------------------------------------------

test('relay bridge – /bridge-status falls back to relay when no CLI is drivable', async ({
  request,
}) => {
  const res = await request.get(`${RELAY_URL}/bridge-status`);
  expect(res.status()).toBe(200);
  const status = (await res.json()) as { kind: string; detail: string };
  expect(status.kind).toBe('relay');
  // There is no "no bridge" state — the detail explains the MCP return path.
  expect(status.detail).toContain('sprang_respond');
});

test('relay bridge – /agent-ask stages the question for the user’s own agent', async ({
  request,
}) => {
  const question = 'Hello from the dashboard e2e test';
  const body = await ask(request, RELAY_URL, question);
  expect(body.mode).toBe('async');
  expect(body.bridge).toBe('relay');
  expect(body.prompt).toBeTruthy();
  expect(body.prompt).toContain(question);

  const questionFile = join(relayRoot, '.sprang', 'agent-question.md');
  await waitForFile(questionFile);
  const content = fs.readFileSync(questionFile, 'utf-8');
  expect(content).toBe(body.prompt);
  expect(content).toContain('[SPRANG DASHBOARD MESSAGE');
  expect(content).toContain(question);
  // The agent answers by calling the MCP tool, which writes cascade-response.json
  expect(content).toContain('sprang_respond');
  // Atomic write left no temp file behind
  expect(fs.existsSync(questionFile + '.tmp')).toBe(false);
});

// ---------------------------------------------------------------------------
// Copilot CLI bridge (failing claude shim + mock `copilot` on PATH, port 4175)
// ---------------------------------------------------------------------------

test('copilot bridge – detection falls through claude to copilot', async ({ request }) => {
  const res = await request.get(`${COPILOT_URL}/bridge-status`);
  expect(res.status()).toBe(200);
  const status = (await res.json()) as { kind: string; detail: string };
  expect(status.kind).toBe('copilot');
});

test('copilot bridge – full ask pipeline: spawn, JSONL parse, session persist, response file', async ({
  request,
}) => {
  await ask(request, COPILOT_URL, 'Which files have the highest risk?');

  const payload = await waitForAgentResponse(request, COPILOT_URL);
  expect(payload.response).toContain('Mock Copilot answer');
  expect(payload.bridge).toBe('copilot');
  expect(payload.session_id).toBe('mock-copilot-session-1');

  const sessionFile = join(copilotRoot, '.sprang', 'copilot-session.json');
  expect(fs.existsSync(sessionFile)).toBe(true);
  const session = JSON.parse(fs.readFileSync(sessionFile, 'utf-8')) as { session_id: string };
  expect(session.session_id).toBe('mock-copilot-session-1');

  const calls = readCalls(copilotLog);
  expect(calls.length).toBe(1);
  const argv = calls[0]!;
  expect(argv).toContain('--prompt');
  expect(argv).toContain('--output-format');
  expect(argv.join(' ')).toContain('Which files have the highest risk?');
  expect(argv.some((a) => a.startsWith('--resume='))).toBe(false);
});

test('copilot bridge – second ask resumes via --resume=<id>', async ({ request }) => {
  await ask(request, COPILOT_URL, 'Show me the top offender');
  await waitForAgentResponse(request, COPILOT_URL);

  const calls = readCalls(copilotLog);
  expect(calls.length).toBe(2);
  expect(calls[1]).toContain('--resume=mock-copilot-session-1');
});

test('copilot bridge – DELETE /agent-response clears the session; next ask starts fresh', async ({
  request,
}) => {
  const del = await request.delete(`${COPILOT_URL}/agent-response`);
  expect(del.status()).toBe(200);

  const sessionFile = join(copilotRoot, '.sprang', 'copilot-session.json');
  expect(fs.existsSync(sessionFile)).toBe(false);

  await ask(request, COPILOT_URL, 'Fresh conversation please');
  await waitForAgentResponse(request, COPILOT_URL);

  const calls = readCalls(copilotLog);
  expect(calls.length).toBe(3);
  expect(calls[2]!.some((a) => a.startsWith('--resume='))).toBe(false);
});
