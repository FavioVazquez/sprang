import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

// Resolve hook script relative to repo root (three levels up from packages/cli/tests)
const REPO_ROOT = resolve(__dirname, '../../..');
const HOOK_SCRIPT = join(REPO_ROOT, '.windsurf/hooks/save-conversation.py');

// Skip the suite entirely if python3 is not on PATH
const pythonAvailable = spawnSync('python3', ['--version']).status === 0;

type TranscriptEntry =
  | { type: 'user_input'; user_input: { user_response: string } }
  | { type: 'planner_response'; planner_response: { response: string } };

function userInput(msg: string): TranscriptEntry {
  return { type: 'user_input', user_input: { user_response: msg } };
}

function plannerResponse(msg: string): TranscriptEntry {
  return { type: 'planner_response', planner_response: { response: msg } };
}

describe.skipIf(!pythonAvailable)('save-conversation.py', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'sprang-windsurf-hook-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function convPath(): string {
    return join(tmpDir, '.sprang/agent-conversation.md');
  }

  function writeTranscript(entries: TranscriptEntry[], name = 'transcript.jsonl'): string {
    const path = join(tmpDir, name);
    writeFileSync(path, entries.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf-8');
    return path;
  }

  function runHook(stdin: string, opts: { workspaceRoot?: string | null } = {}): {
    exitCode: number;
    stdout: string;
    stderr: string;
  } {
    const env: Record<string, string | undefined> = { ...process.env };
    if (opts.workspaceRoot === null) {
      delete env.WINDSURF_WORKSPACE_ROOT;
    } else {
      env.WINDSURF_WORKSPACE_ROOT = opts.workspaceRoot ?? tmpDir;
    }
    const result = spawnSync('python3', [HOOK_SCRIPT], {
      input: stdin,
      env: env as NodeJS.ProcessEnv,
      encoding: 'utf-8',
    });
    return {
      exitCode: result.status ?? 0,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
    };
  }

  function hookInput(transcriptPath: string): string {
    return JSON.stringify({ tool_info: { transcript_path: transcriptPath } });
  }

  it('appends the user message and cascade response (happy path)', () => {
    const transcript = writeTranscript([
      userInput('What is the architecture?'),
      plannerResponse('It has 4 layers.'),
    ]);
    const result = runHook(hookInput(transcript));
    expect(result.exitCode).toBe(0);
    expect(existsSync(convPath())).toBe(true);
    const content = readFileSync(convPath(), 'utf-8');
    expect(content).toContain('**User:** What is the architecture?');
    expect(content).toContain('**Cascade:** It has 4 layers.');
  });

  it('only the LAST exchange is appended when transcript has multiple user inputs', () => {
    const transcript = writeTranscript([
      userInput('First question about the CLI'),
      plannerResponse('First answer.'),
      userInput('Second question about the dashboard'),
      plannerResponse('Second answer.'),
    ]);
    const result = runHook(hookInput(transcript));
    expect(result.exitCode).toBe(0);
    const content = readFileSync(convPath(), 'utf-8');
    expect(content).not.toContain('First question about the CLI');
    expect(content).not.toContain('First answer.');
    expect(content).toContain('**User:** Second question about the dashboard');
    expect(content).toContain('Second answer.');
  });

  it('joins multiple planner responses after the last user input with a blank line', () => {
    const transcript = writeTranscript([
      userInput('Explain the scan pipeline'),
      plannerResponse('Phase 1 is static analysis.'),
      plannerResponse('Phase 2 adds LLM enrichment.'),
    ]);
    const result = runHook(hookInput(transcript));
    expect(result.exitCode).toBe(0);
    const content = readFileSync(convPath(), 'utf-8');
    expect(content).toContain('Phase 1 is static analysis.\n\nPhase 2 adds LLM enrichment.');
  });

  it('appends to the existing conversation file across multiple runs', () => {
    const first = writeTranscript(
      [userInput('Question one'), plannerResponse('Answer one')],
      'transcript-1.jsonl'
    );
    const second = writeTranscript(
      [userInput('Question two'), plannerResponse('Answer two')],
      'transcript-2.jsonl'
    );
    expect(runHook(hookInput(first)).exitCode).toBe(0);
    expect(runHook(hookInput(second)).exitCode).toBe(0);
    const content = readFileSync(convPath(), 'utf-8');
    expect(content).toContain('Question one');
    expect(content).toContain('Question two');
    expect(content.match(/\*\*User:\*\*/g)).toHaveLength(2);
  });

  it('exits 0 and writes nothing when the transcript path does not exist', () => {
    const result = runHook(hookInput(join(tmpDir, 'does-not-exist.jsonl')));
    expect(result.exitCode).toBe(0);
    expect(existsSync(convPath())).toBe(false);
  });

  it('exits 0 and writes nothing on malformed stdin', () => {
    const result = runHook('this is definitely not json {');
    expect(result.exitCode).toBe(0);
    expect(existsSync(convPath())).toBe(false);
  });

  it('exits 0 and writes nothing when WINDSURF_WORKSPACE_ROOT is unset', () => {
    const transcript = writeTranscript([
      userInput('Hello'),
      plannerResponse('Hi there.'),
    ]);
    const result = runHook(hookInput(transcript), { workspaceRoot: null });
    expect(result.exitCode).toBe(0);
    expect(existsSync(convPath())).toBe(false);
  });

  it('writes nothing when the transcript has a user input but no planner response', () => {
    const transcript = writeTranscript([userInput('Unanswered question')]);
    const result = runHook(hookInput(transcript));
    expect(result.exitCode).toBe(0);
    expect(existsSync(convPath())).toBe(false);
  });
});
