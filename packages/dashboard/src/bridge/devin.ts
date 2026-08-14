/**
 * Devin CLI bridge — sends a question to `devin -p` non-interactively and
 * returns the text response.
 *
 * Flags (verified against `devin 3000.4.25`):
 *   -p / --print <prompt>              non-interactive; prints the reply and exits
 *   -c / --continue                    continue the most recent conversation
 *   -r / --resume <id>                 resume a specific session
 *   --permission-mode auto             auto-approve read-only tools (the default)
 *   --respect-workspace-trust false    required: print mode cannot show the trust
 *                                      prompt and hard-fails in an untrusted dir
 *
 * Session continuity: unlike `claude --output-format json`, Devin's print mode
 * emits no machine-readable session id, so there is nothing to persist. `-c`
 * continues the most recent conversation for the working directory, which gives
 * the same thread-of-conversation behaviour without an id round-trip. We record
 * only whether a turn has already happened, so the first question starts fresh.
 */

import { execFileSync, spawnSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const SESSION_FILE = '.sprang/devin-session.json';
const DEVIN_TIMEOUT_MS = 180_000; // 3 min max per call

interface DevinSessionData {
  started_at: string;
  turns: number;
}

/**
 * Devin Desktop ships a `devin` binary inside its server directory, but that copy
 * is not authenticated — only a separately installed CLI is. Resolve PATH first
 * and treat the bundled copy as a last resort.
 */
export function resolveDevinBinary(): string | null {
  try {
    execFileSync('devin', ['--version'], { timeout: 5000, stdio: 'pipe' });
    return 'devin';
  } catch {
    return null;
  }
}

/**
 * Devin Desktop signs the CLI in over ACP rather than through the CLI's own
 * credential store, so `devin auth status` reports "Not logged in" while the IDE
 * works perfectly. The CLI does however accept the same credential directly:
 *
 *   ACP server credential policy: ACP_BACKEND not set. Will accept host
 *   credentials if provided, otherwise fall back to env vars and stored CLI
 *   credentials.
 *
 * So exporting WINDSURF_API_KEY (copy it from the IDE with the
 * "Devin: Copy API Key" command) authenticates the CLI against the account you
 * are already signed into — no second login, and no browser flow.
 */
export function hasWindsurfApiKey(): boolean {
  return Boolean(process.env['WINDSURF_API_KEY']);
}

/** True when a `devin` CLI is present *and* can authenticate — either through
 *  its own credential store or an inherited WINDSURF_API_KEY. */
export function isDevinCLIAvailable(): boolean {
  const bin = resolveDevinBinary();
  if (!bin) return false;
  // An inherited key is sufficient; `auth status` does not know about it.
  if (hasWindsurfApiKey()) return true;
  try {
    const out = execFileSync(bin, ['auth', 'status'], {
      timeout: 8000,
      stdio: 'pipe',
      encoding: 'utf-8',
    });
    return !/not logged in/i.test(out);
  } catch {
    return false;
  }
}

function loadSession(sprangRoot: string): DevinSessionData | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(sprangRoot, SESSION_FILE), 'utf-8')) as DevinSessionData;
  } catch {
    return null;
  }
}

function recordTurn(sprangRoot: string, previous: DevinSessionData | null): void {
  const file = path.join(sprangRoot, SESSION_FILE);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const data: DevinSessionData = {
    started_at: previous?.started_at ?? new Date().toISOString(),
    turns: (previous?.turns ?? 0) + 1,
  };
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, file);
}

function buildPrompt(question: string): string {
  return `You are answering a question from the Sprang dashboard about this codebase.
Use the available MCP tools (sprang_query, sprang_node, sprang_health, etc.) to ground your answer in the knowledge graph.
Be concise — this answer will be displayed in a small chat panel.

Question: ${question}`;
}

function buildArgs(question: string, continueSession: boolean): string[] {
  const args = ['--respect-workspace-trust', 'false', '--permission-mode', 'auto'];
  if (continueSession) args.push('--continue');
  args.push('-p', buildPrompt(question));
  return args;
}

export type DevinAskResult =
  | { ok: true; response: string }
  | { ok: false; error: string };

/** Send a question to the Devin CLI and wait for the reply. */
export function askDevin(question: string, sprangRoot: string): DevinAskResult {
  const bin = resolveDevinBinary();
  if (!bin) return { ok: false, error: 'devin CLI not found on PATH' };

  const previous = loadSession(sprangRoot);
  const args = buildArgs(question, previous !== null);

  let result: ReturnType<typeof spawnSync>;
  try {
    result = spawnSync(bin, args, {
      cwd: sprangRoot,
      timeout: DEVIN_TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024,
      encoding: 'utf-8',
      // See STDIN note in askDevinBackground.
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    return { ok: false, error: `devin CLI error: ${err instanceof Error ? err.message : String(err)}` };
  }

  if (result.error) return { ok: false, error: `devin CLI error: ${result.error.message}` };

  const stdout = String(result.stdout ?? '').trim();
  if (result.status !== 0) {
    const stderr = String(result.stderr ?? '').slice(0, 500) || stdout.slice(0, 500);
    return { ok: false, error: `devin exited with code ${result.status}: ${stderr}` };
  }
  if (!stdout) return { ok: false, error: 'devin returned empty output' };

  recordTurn(sprangRoot, previous);
  return { ok: true, response: stdout };
}

/**
 * Non-blocking variant — spawns `devin -p` in the background and writes the
 * response file when done, so the HTTP handler returns immediately.
 */
export function askDevinBackground(
  question: string,
  sprangRoot: string,
  responsePath: string,
  onFailure?: (error: string) => void,
): void {
  const bin = resolveDevinBinary();
  if (!bin) {
    onFailure?.('devin CLI not found on PATH');
    return;
  }

  const previous = loadSession(sprangRoot);
  // Close stdin: these CLIs block waiting for piped input when stdin is
  // inherited from a server process, then exit non-zero ("no stdin data
  // received in 3s"). The prompt is passed as an argument, not on stdin.
  const child = spawn(bin, buildArgs(question, previous !== null), {
    cwd: sprangRoot,
    timeout: DEVIN_TIMEOUT_MS,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf-8'); });
  child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf-8'); });
  child.on('error', (err) => onFailure?.(`devin could not be started: ${err.message}`));

  child.on('close', (code) => {
    const text = stdout.trim();
    if (code !== 0 || !text) {
      onFailure?.(`devin exited with code ${code}: ${(stderr || text).trim().slice(0, 300)}`);
      return;
    }
    recordTurn(sprangRoot, previous);
    const payload = {
      response: text,
      question,
      written_at: new Date().toISOString(),
      bridge: 'devin',
    };
    fs.mkdirSync(path.dirname(responsePath), { recursive: true });
    const tmp = responsePath + '.tmp';
    try {
      fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf-8');
      fs.renameSync(tmp, responsePath);
    } catch { /* dashboard will just keep polling */ }
  });
}

/** Forget the conversation so the next question starts a fresh Devin session. */
export function clearDevinSession(sprangRoot: string): void {
  const file = path.join(sprangRoot, SESSION_FILE);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}
