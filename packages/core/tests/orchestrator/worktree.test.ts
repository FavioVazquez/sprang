import { describe, it, expect, vi, afterEach } from 'vitest';
import * as childProcess from 'node:child_process';
import * as path from 'node:path';

// We test resolveSprangDir by mocking execSync
vi.mock('node:child_process', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:child_process')>();
  return { ...original, execSync: vi.fn() };
});

// Import after mock is set up
const { resolveSprangDir } = await import('../../src/orchestrator/runner.js');
const mockedExecSync = vi.mocked(childProcess.execSync);

const SPRANG_DIR_NAME = '.sprang';

describe('resolveSprangDir', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns original sprangDir for a main worktree (git-common-dir is .git)', async () => {
    const projectRoot = '/home/user/myrepo';
    const sprangDir = path.join(projectRoot, SPRANG_DIR_NAME);

    // main worktree: git rev-parse --git-common-dir returns ".git"
    mockedExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('--git-common-dir')) {
        return '.git\n';
      }
      return '';
    });

    const result = await resolveSprangDir(projectRoot, sprangDir);
    expect(result).toBe(sprangDir);
  });

  it('redirects to main repo root when inside a worktree', async () => {
    // Suppose main repo is at /home/user/myrepo
    // The worktree is at /home/user/myrepo-wt
    // git rev-parse --git-common-dir returns something like /home/user/myrepo/.git
    const mainRepoRoot = '/home/user/myrepo';
    const worktreeRoot = '/home/user/myrepo-wt';
    const sprangDir = path.join(worktreeRoot, SPRANG_DIR_NAME);
    const mainGitDir = path.join(mainRepoRoot, '.git');

    mockedExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('--git-common-dir')) {
        return mainGitDir + '\n';
      }
      return '';
    });

    const result = await resolveSprangDir(worktreeRoot, sprangDir);
    const expectedDir = path.join(mainRepoRoot, SPRANG_DIR_NAME);
    expect(result).toBe(expectedDir);
  });

  it('returns original sprangDir when git is not available (execSync throws)', async () => {
    const projectRoot = '/home/user/myrepo';
    const sprangDir = path.join(projectRoot, SPRANG_DIR_NAME);

    mockedExecSync.mockImplementation(() => {
      throw new Error('git not found');
    });

    const result = await resolveSprangDir(projectRoot, sprangDir);
    expect(result).toBe(sprangDir);
  });

  it('returns original sprangDir when not inside a git repo', async () => {
    const projectRoot = '/tmp/not-a-repo';
    const sprangDir = path.join(projectRoot, SPRANG_DIR_NAME);

    mockedExecSync.mockImplementation(() => {
      throw new Error('fatal: not a git repository');
    });

    const result = await resolveSprangDir(projectRoot, sprangDir);
    expect(result).toBe(sprangDir);
  });
});
