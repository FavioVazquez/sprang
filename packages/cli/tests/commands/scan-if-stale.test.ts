import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import * as childProcess from 'node:child_process';
import * as fsPromises from 'node:fs/promises';

vi.mock('node:child_process', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:child_process')>();
  return { ...original, execSync: vi.fn() };
});

vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>();
  return { ...original, readFile: vi.fn() };
});

// Mock runPhase1Only and runSprangAnalysis so scan tests don't do real I/O
vi.mock('@sprang/core', async (importOriginal) => {
  const original = await importOriginal<typeof import('@sprang/core')>();
  return {
    ...original,
    runPhase1Only: vi.fn().mockResolvedValue({
      nodes: [{ type: 'file' }],
      edges: [],
      stats: { gitCommitHash: undefined },
    }),
    runSprangAnalysis: vi.fn().mockResolvedValue(undefined),
  };
});

const mockedExecSync = vi.mocked(childProcess.execSync);
const mockedReadFile = vi.mocked(fsPromises.readFile);

const FAKE_COMMIT = 'abc1234567890def1234567890def1234567890de';

describe('scan --if-stale', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('skips scan when graph commit hash matches current HEAD', async () => {
    // graph file contains the same hash as current HEAD
    const graph = {
      stats: { gitCommitHash: FAKE_COMMIT },
    };
    mockedReadFile.mockResolvedValue(JSON.stringify(graph) as unknown as Buffer);
    mockedExecSync.mockReturnValue((FAKE_COMMIT + '\n') as unknown as Buffer);

    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    const { makeScanCommand } = await import('../../src/commands/scan.js');
    const cmd = makeScanCommand();

    // Parse with --if-stale on a fake project root
    await cmd.parseAsync(['--if-stale', '/tmp/fake-project'], { from: 'user' });

    // Should have logged the "Graph is current" message
    const output = writeSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(output).toContain('Graph is current');
    expect(output).toContain(FAKE_COMMIT.slice(0, 7));

    writeSpy.mockRestore();
  });

  it('proceeds with scan when hashes differ', async () => {
    const graph = {
      stats: { gitCommitHash: 'oldhash1234567890def1234567890def1234567' },
    };
    mockedReadFile.mockResolvedValue(JSON.stringify(graph) as unknown as Buffer);
    mockedExecSync.mockReturnValue((FAKE_COMMIT + '\n') as unknown as Buffer);

    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    // Re-import to get fresh module (after clearing mocks)
    const { makeScanCommand } = await import('../../src/commands/scan.js');
    const cmd = makeScanCommand();

    await cmd.parseAsync(['--if-stale', '--phase1-only', '/tmp/fake-project'], { from: 'user' });

    const output = writeSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(output).not.toContain('Graph is current');

    writeSpy.mockRestore();
  });

  it('proceeds with scan when no graph file exists', async () => {
    const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    mockedReadFile.mockRejectedValue(enoent);
    mockedExecSync.mockReturnValue((FAKE_COMMIT + '\n') as unknown as Buffer);

    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    const { makeScanCommand } = await import('../../src/commands/scan.js');
    const cmd = makeScanCommand();

    await cmd.parseAsync(['--if-stale', '--phase1-only', '/tmp/fake-project'], { from: 'user' });

    const output = writeSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(output).not.toContain('Graph is current');

    writeSpy.mockRestore();
  });
});
