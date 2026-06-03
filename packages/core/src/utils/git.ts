import { simpleGit } from 'simple-git';
import type { CommitRef } from '../schema/types.js';

export async function isGitRepo(dir: string): Promise<boolean> {
  try {
    const git = simpleGit(dir);
    await git.revparse(['--git-dir']);
    return true;
  } catch {
    return false;
  }
}

export async function getGitLog(
  dir: string,
  filePath: string,
  maxCount = 50
): Promise<CommitRef[]> {
  try {
    const git = simpleGit(dir);
    const result = await git.raw([
      'log',
      '--follow',
      `--max-count=${maxCount}`,
      '--format=%H|%ae|%ai|%s',
      '--',
      filePath,
    ]);

    if (!result.trim()) return [];

    return result
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const parts = line.split('|');
        const sha = parts[0] ?? '';
        const author = parts[1] ?? '';
        const dateRaw = parts[2] ?? '';
        // Remaining parts are the subject (may contain pipes)
        const message = parts.slice(3).join('|');

        return {
          sha: sha.slice(0, 7),
          author,
          date: dateRaw.trim() ? new Date(dateRaw.trim()).toISOString() : new Date().toISOString(),
          message: message.trim(),
        };
      });
  } catch {
    return [];
  }
}

export async function getGitLogWithDiff(
  dir: string,
  filePath: string
): Promise<Array<CommitRef & { body: string; diff: string }>> {
  try {
    const git = simpleGit(dir);
    const result = await git.raw([
      'log',
      '--follow',
      '-p',
      '--format=COMMIT_START|%H|%ae|%ai|%s',
      '--',
      filePath,
    ]);

    if (!result.trim()) return [];

    const commits: Array<CommitRef & { body: string; diff: string }> = [];
    const sections = result.split(/^COMMIT_START\|/m).filter(Boolean);

    for (const section of sections) {
      const newlineIdx = section.indexOf('\n');
      const header = newlineIdx === -1 ? section : section.slice(0, newlineIdx);
      const rest = newlineIdx === -1 ? '' : section.slice(newlineIdx + 1);

      const parts = header.split('|');
      const sha = parts[0] ?? '';
      const author = parts[1] ?? '';
      const dateRaw = parts[2] ?? '';
      const message = parts.slice(3).join('|').trim();

      // Split body vs diff
      const diffIdx = rest.indexOf('\ndiff --git');
      const body = diffIdx === -1 ? rest.trim() : rest.slice(0, diffIdx).trim();
      const diff = diffIdx === -1 ? '' : rest.slice(diffIdx).trim();

      commits.push({
        sha: sha.slice(0, 7),
        author,
        date: dateRaw.trim() ? new Date(dateRaw.trim()).toISOString() : new Date().toISOString(),
        message,
        body,
        diff,
      });
    }

    return commits;
  } catch {
    return [];
  }
}

export async function getCurrentHead(dir: string): Promise<string> {
  const git = simpleGit(dir);
  const result = await git.revparse(['HEAD']);
  return result.trim();
}

export async function getCommitFrequency(
  dir: string,
  filePath: string,
  days: number
): Promise<number> {
  try {
    const git = simpleGit(dir);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const result = await git.raw([
      'log',
      '--follow',
      '--oneline',
      `--since=${since}`,
      '--',
      filePath,
    ]);
    if (!result.trim()) return 0;
    return result.trim().split('\n').filter(Boolean).length;
  } catch {
    return 0;
  }
}
