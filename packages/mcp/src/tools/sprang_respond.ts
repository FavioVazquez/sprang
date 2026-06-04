import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface SprangRespondInput {
  response: string;
  question?: string;
}

export interface SprangRespondResult {
  success: true;
  path: string;
  written_at: string;
}

/**
 * Write a response to .sprang/cascade-response.json so the Sprang dashboard
 * can poll and display it. This is the return path for the cascade-bridge
 * integration: dashboard → /cascade-ask → .cascade-trigger → Cascade →
 * sprang_respond → .sprang/cascade-response.json → dashboard polls → displays.
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

  return {
    success: true,
    path: '.sprang/cascade-response.json',
    written_at: writtenAt,
  };
}
