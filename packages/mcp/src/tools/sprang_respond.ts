import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface SprangRespondInput {
  response: string;
  question?: string;
}

export interface SprangRespondResult {
  success: true;
  path: string;
  written_at: string;
  timestamp: string;
}

/**
 * Write a response to .sprang/cascade-response.json so the Sprang dashboard
 * can poll and display it. This is the return path for the agent bridge:
 * dashboard → /agent-ask → AI agent → sprang_respond → cascade-response.json → dashboard.
 */
export async function sprangRespond(
  input: SprangRespondInput,
  sprangRoot: string
): Promise<SprangRespondResult | { error: string; code: string }> {
  if (!input.response || typeof input.response !== 'string' || input.response.trim() === '') {
    return { error: 'response field is required', code: 'MISSING_RESPONSE' };
  }

  const sprangDir = join(sprangRoot, '.sprang');
  const filePath = join(sprangDir, 'cascade-response.json');
  const writtenAt = new Date().toISOString();

  const payload = {
    response: input.response.trim(),
    question: input.question?.trim() ?? null,
    written_at: writtenAt,
  };

  await mkdir(sprangDir, { recursive: true });
  await writeFile(filePath, JSON.stringify(payload, null, 2), 'utf-8');

  // Append to the running conversation log. This used to be produced by a
  // Windsurf-era `post_cascade_response_with_transcript` hook, an event no
  // current runtime fires — so the log silently stopped updating. Writing it
  // here makes it deterministic and identical on every platform.
  await appendFile(
    join(sprangDir, 'agent-conversation.md'),
    `\n## ${writtenAt}\n\n**Q:** ${payload.question ?? '(not recorded)'}\n\n**A:** ${payload.response}\n`,
    'utf-8',
  ).catch(() => { /* the log is best-effort; never fail the response on it */ });

  return {
    success: true,
    path: '.sprang/cascade-response.json',
    written_at: writtenAt,
    timestamp: writtenAt,
  };
}
