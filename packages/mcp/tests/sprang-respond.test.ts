import { describe, it, expect } from 'vitest';
import { sprangRespond } from '../src/tools/sprang_respond.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdir, readFile } from 'node:fs/promises';

async function makeTestDir(): Promise<string> {
  const dir = join(tmpdir(), `sprang-respond-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

describe('sprangRespond', () => {
  it('writes cascade-response.json with response and question', async () => {
    const root = await makeTestDir();
    const result = await sprangRespond(
      { response: 'The auth module uses JWT.', question: 'How does auth work?' },
      root,
    );
    expect(result).toMatchObject({ success: true, path: '.sprang/cascade-response.json' });
    const raw = JSON.parse(await readFile(join(root, '.sprang', 'cascade-response.json'), 'utf-8'));
    expect(raw.response).toBe('The auth module uses JWT.');
    expect(raw.question).toBe('How does auth work?');
    expect(typeof raw.written_at).toBe('string');
  });

  it('writes null for question when omitted', async () => {
    const root = await makeTestDir();
    await sprangRespond({ response: 'No question given.' }, root);
    const raw = JSON.parse(await readFile(join(root, '.sprang', 'cascade-response.json'), 'utf-8'));
    expect(raw.question).toBeNull();
    expect(raw.response).toBe('No question given.');
  });

  it('trims whitespace from response', async () => {
    const root = await makeTestDir();
    await sprangRespond({ response: '  trimmed  ' }, root);
    const raw = JSON.parse(await readFile(join(root, '.sprang', 'cascade-response.json'), 'utf-8'));
    expect(raw.response).toBe('trimmed');
  });

  it('returns error for empty response', async () => {
    const root = await makeTestDir();
    const result = await sprangRespond({ response: '' }, root);
    expect(result).toMatchObject({ error: 'response field is required', code: 'MISSING_RESPONSE' });
  });

  it('returns error for whitespace-only response', async () => {
    const root = await makeTestDir();
    const result = await sprangRespond({ response: '   ' }, root);
    expect(result).toMatchObject({ error: 'response field is required', code: 'MISSING_RESPONSE' });
  });

  it('creates .sprang directory if it does not exist', async () => {
    const root = await makeTestDir();
    const nestedRoot = join(root, 'nested', 'project');
    const result = await sprangRespond({ response: 'hello' }, nestedRoot);
    expect(result).toMatchObject({ success: true });
    const raw = JSON.parse(
      await readFile(join(nestedRoot, '.sprang', 'cascade-response.json'), 'utf-8'),
    );
    expect(raw.response).toBe('hello');
  });

  it('overwrites previous response on second call', async () => {
    const root = await makeTestDir();
    await sprangRespond({ response: 'first answer' }, root);
    await sprangRespond({ response: 'second answer' }, root);
    const raw = JSON.parse(await readFile(join(root, '.sprang', 'cascade-response.json'), 'utf-8'));
    expect(raw.response).toBe('second answer');
  });

  it('written_at is a valid ISO-8601 timestamp', async () => {
    const root = await makeTestDir();
    const before = Date.now();
    const result = await sprangRespond({ response: 'check timestamp' }, root) as { written_at: string };
    const after = Date.now();
    const ts = new Date(result.written_at).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });
});
