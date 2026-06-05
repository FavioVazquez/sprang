import { describe, it, expect, vi, afterEach } from 'vitest';
import * as childProcess from 'node:child_process';
import * as fsPromises from 'node:fs/promises';

vi.mock('node:child_process', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:child_process')>();
  return { ...original, execSync: vi.fn() };
});

vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...original,
    readFile: vi.fn(),
    writeFile: vi.fn().mockResolvedValue(undefined),
    chmod: vi.fn().mockResolvedValue(undefined),
  };
});

const mockedExecSync = vi.mocked(childProcess.execSync);
const mockedReadFile = vi.mocked(fsPromises.readFile);
const mockedWriteFile = vi.mocked(fsPromises.writeFile);

describe('install-hooks command', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('creates a new post-commit hook file when none exists', async () => {
    mockedExecSync.mockReturnValue('.git\n' as unknown as Buffer);
    const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    mockedReadFile.mockRejectedValue(enoent);

    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    const { makeInstallHooksCommand } = await import('../../src/commands/install-hooks.js');
    const cmd = makeInstallHooksCommand();
    await cmd.parseAsync([], { from: 'user' });

    expect(mockedWriteFile).toHaveBeenCalledOnce();
    const [, content] = mockedWriteFile.mock.calls[0]!;
    expect(String(content)).toContain('#!/bin/sh');
    expect(String(content)).toContain('# Sprang auto-update hook');
    expect(String(content)).toContain('--if-stale');

    const output = writeSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(output).toContain('Post-commit hook installed');

    writeSpy.mockRestore();
  });

  it('appends to an existing hook file without duplication', async () => {
    mockedExecSync.mockReturnValue('.git\n' as unknown as Buffer);
    const existingHook = '#!/bin/sh\necho "existing hook"\n';
    mockedReadFile.mockResolvedValue(existingHook as unknown as Buffer);

    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    const { makeInstallHooksCommand } = await import('../../src/commands/install-hooks.js');
    const cmd = makeInstallHooksCommand();
    await cmd.parseAsync([], { from: 'user' });

    expect(mockedWriteFile).toHaveBeenCalledOnce();
    const [, content] = mockedWriteFile.mock.calls[0]!;
    const contentStr = String(content);
    expect(contentStr).toContain('existing hook');
    expect(contentStr).toContain('# Sprang auto-update hook');

    writeSpy.mockRestore();
  });

  it('does not install twice when marker is already present', async () => {
    mockedExecSync.mockReturnValue('.git\n' as unknown as Buffer);
    const existingHook = '#!/bin/sh\n# Sprang auto-update hook\nnode "..." scan --phase1-only --if-stale\n';
    mockedReadFile.mockResolvedValue(existingHook as unknown as Buffer);

    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    const { makeInstallHooksCommand } = await import('../../src/commands/install-hooks.js');
    const cmd = makeInstallHooksCommand();
    await cmd.parseAsync([], { from: 'user' });

    // writeFile should NOT have been called
    expect(mockedWriteFile).not.toHaveBeenCalled();

    const output = writeSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(output).toContain('already installed');

    writeSpy.mockRestore();
  });
});
