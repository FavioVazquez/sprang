import { execSync } from 'node:child_process';
import { writeFile, readFile, chmod } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';

const SPRANG_HOOK_MARKER = '# Sprang auto-update hook';

/**
 * Resolve the absolute path to the CLI entry that is currently running. After
 * bundling, this file is part of `dist/index.js`, so `import.meta.url` points
 * straight at the installed CLI — correct for both the monorepo and an npm
 * install (`node_modules/@faviovazquez/sprang/dist/index.js`). The previous
 * implementation hardcoded `packages/cli/dist/index.js`, which only exists in
 * the Sprang repo and made the hook throw `Cannot find module` for npm users.
 */
function resolveCliEntry(): string {
  try {
    return realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return fileURLToPath(import.meta.url);
  }
}

/**
 * Build the hook snippet. Prefers the resolved CLI path, but falls back to a
 * `sprang` binary on PATH so the hook never errors even if the install moves.
 */
function buildHookSnippet(cliEntry: string): string {
  return `${SPRANG_HOOK_MARKER}
SPRANG_BIN="${cliEntry}"
if [ -f "$SPRANG_BIN" ]; then
  node "$SPRANG_BIN" scan --phase1-only --if-stale 2>&1 | head -5 || true
elif command -v sprang >/dev/null 2>&1; then
  sprang scan --phase1-only --if-stale 2>&1 | head -5 || true
fi
`;
}

export function makeInstallHooksCommand(): Command {
  const cmd = new Command('install-hooks');
  cmd
    .description('Install a git post-commit hook that auto-updates the Sprang knowledge graph')
    .action(async () => {
      let gitDir: string;
      try {
        gitDir = execSync('git rev-parse --git-dir', { encoding: 'utf-8' }).trim();
      } catch {
        process.stderr.write('Error: Not inside a git repository.\n');
        process.exit(1);
        return;
      }

      const hooksDir = join(gitDir, 'hooks');
      const hookPath = join(hooksDir, 'post-commit');

      let existingContent = '';
      try {
        existingContent = await readFile(hookPath, 'utf-8');
      } catch { /* hook does not exist yet */ }

      // Avoid duplicate installs
      if (existingContent.includes(SPRANG_HOOK_MARKER)) {
        process.stdout.write('[sprang] Sprang hook is already installed in .git/hooks/post-commit.\n');
        return;
      }

      const hookSnippet = buildHookSnippet(resolveCliEntry());

      let newContent: string;
      if (existingContent.length === 0) {
        // Create a fresh hook file
        newContent = `#!/bin/sh\n${hookSnippet}`;
      } else {
        // Append to existing hook
        newContent = existingContent.trimEnd() + '\n\n' + hookSnippet;
      }

      await writeFile(hookPath, newContent, 'utf-8');
      await chmod(hookPath, 0o755);

      process.stdout.write('[sprang] Post-commit hook installed at ' + hookPath + '\n');
      process.stdout.write(
        '[sprang] The hook will run `sprang scan --phase1-only --if-stale` after each commit.\n'
      );
      process.stdout.write(
        '[sprang] To uninstall, remove the lines between "# Sprang auto-update hook" markers in ' +
          hookPath +
          '\n'
      );
    });

  return cmd;
}
