import { execSync } from 'node:child_process';
import { writeFile, readFile, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { Command } from 'commander';

const SPRANG_HOOK_MARKER = '# Sprang auto-update hook';

const HOOK_SNIPPET = `${SPRANG_HOOK_MARKER}
node "$(git rev-parse --show-toplevel)/packages/cli/dist/index.js" scan --phase1-only --if-stale 2>&1 | head -5 || true
`;

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

      let newContent: string;
      if (existingContent.length === 0) {
        // Create a fresh hook file
        newContent = `#!/bin/sh\n${HOOK_SNIPPET}`;
      } else {
        // Append to existing hook
        newContent = existingContent.trimEnd() + '\n\n' + HOOK_SNIPPET;
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
