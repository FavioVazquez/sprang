import { defineConfig } from '@playwright/test';

/**
 * Bridge e2e config — runs e2e/bridge.spec.ts against four preview servers
 * whose PATH is prefixed with mock platform CLIs, so the real spawn → parse
 * → session-persist → response-file pipeline executes end-to-end:
 *
 *   port 4174 — "claude environment": e2e/mock-bin/claude-env contains a mock
 *     `claude` CLI that answers --version and emits the JSON result contract.
 *     It also gets an *unauthenticated* mock `devin` (generated below), which
 *     is the real-world Devin Desktop case: the binary is on PATH but
 *     `devin auth status` says "Not logged in", so detection must skip it.
 *     Bridge detection resolves to `claude`.
 *
 *   port 4175 — "copilot environment": e2e/mock-bin/copilot-env contains a
 *     failing `claude` shim (shadows any real claude on PATH) plus a mock
 *     `copilot` CLI emitting the JSONL contract. Detection falls through
 *     devin → claude → copilot.
 *
 *   port 4176 — "devin environment": a generated mock `devin` that answers
 *     --version, reports "Logged in", and prints an answer for `-p`.
 *     Detection resolves to `devin` (highest priority).
 *
 *   port 4177 — "relay environment": failing shims for every agent CLI, so no
 *     CLI is drivable and detection falls back to `relay`. /agent-ask stages
 *     .sprang/agent-question.md for the user's own agent, which answers via
 *     the sprang_respond MCP tool.
 *
 * Each server gets its own SPRANG_ROOT (e2e/.bridge-root-*) so session files,
 * the relay question file, and cascade-response.json are isolated from the main
 * e2e suite and from the repo's own .sprang/. Tests are request-only (no
 * browser). Mock CLIs that are generated (rather than committed under
 * e2e/mock-bin/) are written into <root>/bin, which is wiped on each start.
 */

/** Shell snippet that writes an executable mock CLI. Bodies must not contain `'`. */
function mockBin(dir: string, name: string, body: string): string {
  if (body.includes("'")) throw new Error(`mock ${name}: body must not contain single quotes`);
  return `mkdir -p ${dir} && printf '%s\\n' '${body}' > ${dir}/${name} && chmod +x ${dir}/${name}`;
}

const DEVIN_AUTHED = [
  '#!/usr/bin/env bash',
  '# Mock Devin CLI (authenticated) for bridge e2e tests.',
  '#   devin --version    -> version string, exit 0',
  '#   devin auth status  -> "Logged in ..." (detect.ts requires this)',
  '#   devin ... -p <p>   -> plain-text answer on stdout',
  'if [ "$1" = "--version" ]; then echo "devin 3000.4.25 (mock)"; exit 0; fi',
  'if [ "$1" = "auth" ]; then echo "Logged in as mock@example.com"; exit 0; fi',
  'log="${MOCK_DEVIN_LOG:-/tmp/mock-devin-args.log}"',
  '{ echo "---CALL---"; for a in "$@"; do echo "$a"; done; } >> "$log"',
  'echo "Mock Devin answer: the knowledge graph looks healthy"',
].join('\n');

/** Present, reports itself healthy, but every actual answer fails — the shape of
 *  a revoked OAuth token. Detection cannot see this (Claude's own `auth status`
 *  reports loggedIn:true for a revoked token), so the ask must degrade to relay. */
const CLAUDE_BROKEN_AUTH = [
  '#!/usr/bin/env bash',
  '# Mock Claude CLI that passes detection but 401s on every request.',
  'if [ "$1" = "--version" ]; then echo "2.1.163 (Claude Code)"; exit 0; fi',
  // Double quotes need no escaping: mockBin wraps the body in shell single quotes.
  'echo {"type":"result","is_error":true,"api_error_status":401,"result":"Failed to authenticate. API Error: 401 OAuth access token has been revoked."}',
  'exit 1',
].join('\n');

const DEVIN_UNAUTHED = [
  '#!/usr/bin/env bash',
  '# Mock Devin CLI as shipped inside Devin Desktop: present but NOT logged in.',
  '# detect.ts must fall through to the next bridge instead of picking devin.',
  'if [ "$1" = "--version" ]; then echo "devin 3000.4.25 (mock)"; exit 0; fi',
  'if [ "$1" = "auth" ]; then echo "Not logged in."; echo "  Credentials path: /tmp/credentials.toml"; exit 0; fi',
  'echo "Login canceled" >&2',
  'exit 1',
].join('\n');

const FAILING_SHIM = [
  '#!/usr/bin/env bash',
  '# Failing shim — shadows any real CLI on PATH so bridge detection skips it.',
  'exit 1',
].join('\n');

const CLAUDE_BIN = '"$PWD/e2e/.bridge-root-claude/bin"';
const DEVIN_BIN = '"$PWD/e2e/.bridge-root-devin/bin"';
const RELAY_BIN = '"$PWD/e2e/.bridge-root-relay/bin"';
const DEGRADED_BIN = '"$PWD/e2e/.bridge-root-degraded/bin"';

export default defineConfig({
  testDir: './e2e',
  testMatch: /bridge\.spec\.ts/,
  timeout: 30000,
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? 'dot' : 'list',
  webServer: [
    {
      command:
        'rm -rf e2e/.bridge-root-claude && mkdir -p e2e/.bridge-root-claude/.sprang && ' +
        mockBin(CLAUDE_BIN, 'devin', DEVIN_UNAUTHED) + ' && ' +
        'SPRANG_ROOT="$PWD/e2e/.bridge-root-claude" ' +
        'MOCK_CLAUDE_LOG="$PWD/e2e/.bridge-root-claude/mock-claude-args.log" ' +
        'PATH="$PWD/e2e/.bridge-root-claude/bin:$PWD/e2e/mock-bin/claude-env:$PATH" ' +
        'pnpm preview --port 4174 --host',
      port: 4174,
      reuseExistingServer: false,
      timeout: 60000,
    },
    {
      command:
        'rm -rf e2e/.bridge-root-copilot && mkdir -p e2e/.bridge-root-copilot/.sprang && ' +
        mockBin('"$PWD/e2e/.bridge-root-copilot/bin"', 'devin', FAILING_SHIM) + ' && ' +
        'SPRANG_ROOT="$PWD/e2e/.bridge-root-copilot" ' +
        'MOCK_COPILOT_LOG="$PWD/e2e/.bridge-root-copilot/mock-copilot-args.log" ' +
        'PATH="$PWD/e2e/.bridge-root-copilot/bin:$PWD/e2e/mock-bin/copilot-env:$PATH" ' +
        'pnpm preview --port 4175 --host',
      port: 4175,
      reuseExistingServer: false,
      timeout: 60000,
    },
    {
      command:
        'rm -rf e2e/.bridge-root-devin && mkdir -p e2e/.bridge-root-devin/.sprang && ' +
        mockBin(DEVIN_BIN, 'devin', DEVIN_AUTHED) + ' && ' +
        'SPRANG_ROOT="$PWD/e2e/.bridge-root-devin" ' +
        'MOCK_DEVIN_LOG="$PWD/e2e/.bridge-root-devin/mock-devin-args.log" ' +
        'PATH="$PWD/e2e/.bridge-root-devin/bin:$PATH" ' +
        'pnpm preview --port 4176 --host',
      port: 4176,
      reuseExistingServer: false,
      timeout: 60000,
    },
    {
      command:
        'rm -rf e2e/.bridge-root-degraded && mkdir -p e2e/.bridge-root-degraded/.sprang && ' +
        mockBin(DEGRADED_BIN, 'devin', FAILING_SHIM) + ' && ' +
        mockBin(DEGRADED_BIN, 'claude', CLAUDE_BROKEN_AUTH) + ' && ' +
        mockBin(DEGRADED_BIN, 'copilot', FAILING_SHIM) + ' && ' +
        'SPRANG_ROOT="$PWD/e2e/.bridge-root-degraded" ' +
        'PATH="$PWD/e2e/.bridge-root-degraded/bin:$PATH" ' +
        'pnpm preview --port 4178 --host',
      port: 4178,
      reuseExistingServer: false,
      timeout: 60000,
    },
    {
      command:
        'rm -rf e2e/.bridge-root-relay && mkdir -p e2e/.bridge-root-relay/.sprang && ' +
        mockBin(RELAY_BIN, 'devin', FAILING_SHIM) + ' && ' +
        mockBin(RELAY_BIN, 'claude', FAILING_SHIM) + ' && ' +
        mockBin(RELAY_BIN, 'copilot', FAILING_SHIM) + ' && ' +
        'SPRANG_ROOT="$PWD/e2e/.bridge-root-relay" ' +
        'PATH="$PWD/e2e/.bridge-root-relay/bin:$PATH" ' +
        'pnpm preview --port 4177 --host',
      port: 4177,
      reuseExistingServer: false,
      timeout: 60000,
    },
  ],
  projects: [{ name: 'bridge-api' }],
});
