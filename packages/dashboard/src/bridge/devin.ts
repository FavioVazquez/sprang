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

/**
 * Environment the `devin` CLI must NOT inherit.
 *
 * The dashboard is usually launched from a terminal inside Devin Desktop, which
 * exports ACP_BACKEND. With it set the CLI switches to ACP mode, where — in its
 * own words — "ACP host is the sole source of credentials. Local CLI
 * credentials (env vars, on-disk REPL store) will NOT be used." The result is a
 * CLI that is genuinely logged in yet reports "Not logged in", because it is
 * waiting for an ACP host that will never call authenticate.
 */
function cliEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env['ACP_BACKEND'];
  return env;
}

const SESSION_FILE = '.sprang/devin-session.json';

/**
 * Model used for dashboard questions.
 *
 * Benchmarked on a real question ("call sprang_health, reply with the grade"),
 * measured end to end through this bridge:
 *
 *   claude-sonnet-4.5 (default)  115s
 *   swe-1.7-lightning             23s   ← chosen
 *   swe-1.6-fast                  23s
 *   claude-haiku-4.5              23s   (prepends chatter)
 *   gemini-3.7-flash              26s
 *   gpt-5.4-mini                  27s
 *   kimi-k3                       28s
 *
 * swe-1.7-lightning was also the best of the fast models on a harder question
 * (naming the files behind a specific change and summarising it), so speed here
 * costs nothing in answer quality. Dashboard questions are short lookups
 * against the knowledge graph — the default model is five times slower for no
 * benefit.
 *
 * Override with SPRANG_DEVIN_MODEL if an account lacks this model.
 */
const DEFAULT_MODEL = 'swe-1.7-lightning';
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
    execFileSync('devin', ['--version'], { timeout: 5000, stdio: 'pipe', env: cliEnv() });
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
      env: cliEnv(),
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

/**
 * Grant exactly the Sprang MCP tools, and nothing else.
 *
 * In non-interactive mode `--permission-mode auto` approves read-only tools but
 * not MCP calls, so the agent answers "rejected a tool call that requires
 * confirmation" and gives up. The CLI's own advice is `--permission-mode
 * dangerous`, which auto-approves *everything* — an unacceptable trade for
 * answering a question about a codebase.
 *
 * A generated config granting `mcp__sprang__*` is the narrow equivalent:
 * verified to let sprang_health through while leaving every other tool behind
 * the normal prompt.
 */
function writePermissionConfig(sprangRoot: string): string | null {
  try {
    const dir = path.join(sprangRoot, '.sprang');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'devin-cli-config.json');
    fs.writeFileSync(file, JSON.stringify({ permissions: { allow: ['mcp__sprang__*'] } }, null, 2));
    return file;
  } catch {
    return null;
  }
}

function buildArgs(question: string, continueSession: boolean, configPath: string | null): string[] {
  const args = ['--respect-workspace-trust', 'false', '--permission-mode', 'auto'];
  const model = process.env['SPRANG_DEVIN_MODEL'] ?? DEFAULT_MODEL;
  if (model) args.push('--model', model);
  if (configPath) args.push('--config', configPath);
  if (continueSession) args.push('--continue');
  args.push('-p', buildPrompt(question));
  return args;
}

/**
 * Strip the CLI's first-run chrome. `devin -p` prints a welcome banner and
 * login confirmation on stdout ahead of the answer, which would otherwise be
 * shown to the user as part of the reply.
 */
export function cleanDevinOutput(raw: string): string {
  const BANNER = [
    /^welcome to devin cli!?$/i,
    /^logged in as .*$/i,
    /^you're all set\..*$/i,
    /^✓?\s*organization: .*$/i,
    /^run devin to get started\.?$/i,
  ];
  const lines = raw
    // eslint-disable-next-line no-control-regex
    .replace(/\u001b\[[0-9;]*m/g, '')  // ANSI colour
    .split('\n');
  let start = 0;
  while (start < lines.length) {
    const line = lines[start]!.trim();
    if (line === '' || BANNER.some((re) => re.test(line))) start++;
    else break;
  }
  return lines.slice(start).join('\n').trim();
}

export type DevinAskResult =
  | { ok: true; response: string }
  | { ok: false; error: string };

/** Send a question to the Devin CLI and wait for the reply. */
export function askDevin(question: string, sprangRoot: string): DevinAskResult {
  const bin = resolveDevinBinary();
  if (!bin) return { ok: false, error: 'devin CLI not found on PATH' };

  const previous = loadSession(sprangRoot);
  const configPath = writePermissionConfig(sprangRoot);

  const run = (withContinue: boolean): ReturnType<typeof spawnSync> =>
    spawnSync(bin, buildArgs(question, withContinue, configPath), {
      cwd: sprangRoot,
      timeout: DEVIN_TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024,
      encoding: 'utf-8',
      env: cliEnv(),
      // See STDIN note in askDevinBackground.
      stdio: ['ignore', 'pipe', 'pipe'],
    });

  let result: ReturnType<typeof spawnSync>;
  // Tracks the thread the answer actually came from. A dropped resume starts a
  // new thread, so the turn counter must restart with it rather than carry the
  // abandoned session's history forward.
  let resumed = previous;
  try {
    result = run(previous !== null);
    // Resuming can fail for reasons that have nothing to do with the question —
    // a session recorded against a different model, a stale lock, an
    // interrupted turn ("failed to start ACP agent session"). Continuity is a
    // nicety; answering is the point. Drop the thread and retry once clean.
    if (previous !== null && result.status !== 0) {
      clearDevinSession(sprangRoot);
      resumed = null;
      result = run(false);
    }
  } catch (err) {
    return { ok: false, error: `devin CLI error: ${err instanceof Error ? err.message : String(err)}` };
  }

  if (result.error) return { ok: false, error: `devin CLI error: ${result.error.message}` };

  const stdout = cleanDevinOutput(String(result.stdout ?? ''));
  if (result.status !== 0) {
    const stderr = String(result.stderr ?? '').slice(0, 500) || stdout.slice(0, 500);
    return { ok: false, error: `devin exited with code ${result.status}: ${stderr}` };
  }
  if (!stdout) return { ok: false, error: 'devin returned empty output' };

  recordTurn(sprangRoot, resumed);
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
  // A failed resume must not cost the user their answer — see askDevin.
  const usedContinue = previous !== null;
  // Close stdin: these CLIs block waiting for piped input when stdin is
  // inherited from a server process, then exit non-zero ("no stdin data
  // received in 3s"). The prompt is passed as an argument, not on stdin.
  const child = spawn(bin, buildArgs(question, usedContinue, writePermissionConfig(sprangRoot)), {
    cwd: sprangRoot,
    timeout: DEVIN_TIMEOUT_MS,
    env: cliEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf-8'); });
  child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf-8'); });
  child.on('error', (err) => onFailure?.(`devin could not be started: ${err.message}`));

  child.on('close', (code) => {
    const text = cleanDevinOutput(stdout);
    if (code !== 0 || !text) {
      if (usedContinue) {
        // Retry once without --continue; a stale session should not surface as
        // a failed question. Clearing the session makes the retry a fresh one.
        clearDevinSession(sprangRoot);
        askDevinBackground(question, sprangRoot, responsePath, onFailure);
        return;
      }
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
