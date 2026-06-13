import { defineConfig } from '@playwright/test';

/**
 * Bridge e2e config — runs e2e/bridge.spec.ts against two preview servers
 * whose PATH is prefixed with mock platform CLIs, so the real spawn → parse
 * → session-persist → response-file pipeline executes end-to-end:
 *
 *   port 4174 — "claude environment": e2e/mock-bin/claude-env contains a mock
 *     `claude` CLI that answers --version and emits the JSON result contract.
 *     Bridge detection resolves to `claude`.
 *
 *   port 4175 — "copilot environment": e2e/mock-bin/copilot-env contains a
 *     failing `claude` shim (shadows any real claude on PATH) plus a mock
 *     `copilot` CLI emitting the JSONL contract. Detection falls through
 *     windsurf → claude → copilot.
 *
 * Each server gets its own SPRANG_ROOT (e2e/.bridge-root-*) so session files,
 * trigger files, and cascade-response.json are isolated from the main e2e
 * suite and from the repo's own .sprang/. Tests are request-only (no browser).
 */
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
        // Unset WINDSURF_CASCADE_TERMINAL_KIND so bridge detection is deterministic
        // even when this suite is run from inside Windsurf/Devin Desktop (the var
        // leaks into spawned processes and would force detection to `windsurf`).
        'env -u WINDSURF_CASCADE_TERMINAL_KIND ' +
        'SPRANG_ROOT="$PWD/e2e/.bridge-root-claude" ' +
        'MOCK_CLAUDE_LOG="$PWD/e2e/.bridge-root-claude/mock-claude-args.log" ' +
        'PATH="$PWD/e2e/mock-bin/claude-env:$PATH" ' +
        'pnpm preview --port 4174 --host',
      port: 4174,
      reuseExistingServer: false,
      timeout: 60000,
    },
    {
      command:
        'rm -rf e2e/.bridge-root-copilot && mkdir -p e2e/.bridge-root-copilot/.sprang && ' +
        'env -u WINDSURF_CASCADE_TERMINAL_KIND ' +
        'SPRANG_ROOT="$PWD/e2e/.bridge-root-copilot" ' +
        'MOCK_COPILOT_LOG="$PWD/e2e/.bridge-root-copilot/mock-copilot-args.log" ' +
        'PATH="$PWD/e2e/mock-bin/copilot-env:$PATH" ' +
        'pnpm preview --port 4175 --host',
      port: 4175,
      reuseExistingServer: false,
      timeout: 60000,
    },
  ],
  projects: [{ name: 'bridge-api' }],
});
