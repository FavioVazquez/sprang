import { describe, it, expect } from 'vitest';
import { LLMClient, NullLLMClient } from '../../src/llm/client.js';
import type { LLMMessage, LLMOptions } from '../../src/llm/client.js';

/**
 * These exist because Sprang's own evidence matrix found the gap.
 *
 * `llm/client.ts` had twenty referrers — including `agents/base.ts` and both
 * orchestrator phases — changed five times recently, and no test file at all.
 * Static analysis alone would not have flagged it (it is well connected),
 * coverage alone would not have flagged it (plenty of files are uncovered);
 * the intersection of "widely used", "recently changed" and "not executed" is
 * what made it stand out. Acting on the finding is the point of having it.
 *
 * The class matters more than its size suggests: `NullLLMClient` is the
 * default everywhere, so every agent's heuristic fallback path runs through
 * it. If it ever threw, or returned something other than an empty string, the
 * entire deterministic pipeline would change behaviour silently.
 */

/** A recording client, so the base class's orchestration can be observed. */
class RecordingClient extends LLMClient {
  readonly calls: Array<{ messages: LLMMessage[]; opts?: LLMOptions }> = [];
  constructor(private readonly reply: (n: number) => string = (n) => `reply-${n}`) {
    super();
  }
  async complete(messages: LLMMessage[], opts?: LLMOptions): Promise<string> {
    this.calls.push(opts === undefined ? { messages } : { messages, opts });
    return this.reply(this.calls.length);
  }
  /** Expose the protected counter so token accounting can be tested. */
  addTokens(n: number): void {
    this.totalTokensUsed += n;
  }
}

class ThrowingClient extends LLMClient {
  async complete(): Promise<string> {
    throw new Error('provider unavailable');
  }
}

describe('NullLLMClient', () => {
  it('returns an empty string rather than throwing', async () => {
    // This is the default client. Every agent falls back to heuristics when it
    // is in use, and that fallback depends on an empty string, not on an error.
    await expect(new NullLLMClient().complete([{ role: 'user', content: 'hi' }])).resolves.toBe('');
  });

  it('returns an empty string for an empty conversation', async () => {
    await expect(new NullLLMClient().complete([])).resolves.toBe('');
  });

  it('ignores options without complaining about them', async () => {
    await expect(
      new NullLLMClient().complete([{ role: 'user', content: 'hi' }], {
        model: 'anything',
        maxTokens: 10,
        temperature: 0,
      }),
    ).resolves.toBe('');
  });

  it('reports zero tokens used, because it uses none', async () => {
    const client = new NullLLMClient();
    await client.complete([{ role: 'user', content: 'hi' }]);
    expect(client.getTokenUsage()).toBe(0);
  });

  it('returns an array of empty strings from completeBatch', async () => {
    await expect(new NullLLMClient().completeBatch(['a', 'b', 'c'])).resolves.toEqual(['', '', '']);
  });

  it('is an LLMClient, so anything typed against the base accepts it', () => {
    expect(new NullLLMClient()).toBeInstanceOf(LLMClient);
  });
});

describe('LLMClient.completeBatch', () => {
  it('returns one result per prompt, in order', async () => {
    const client = new RecordingClient((n) => `r${n}`);
    await expect(client.completeBatch(['a', 'b', 'c'])).resolves.toEqual(['r1', 'r2', 'r3']);
  });

  it('wraps each prompt as a single user message', async () => {
    const client = new RecordingClient();
    await client.completeBatch(['first']);
    expect(client.calls[0]?.messages).toEqual([{ role: 'user', content: 'first' }]);
  });

  it('issues one call per prompt', async () => {
    const client = new RecordingClient();
    await client.completeBatch(['a', 'b', 'c', 'd']);
    expect(client.calls).toHaveLength(4);
  });

  it('runs sequentially, not in parallel', async () => {
    // Sequential is deliberate: these calls hit a rate-limited provider, and
    // firing a whole batch at once is how a scan gets throttled.
    const order: string[] = [];
    class OrderedClient extends LLMClient {
      async complete(messages: LLMMessage[]): Promise<string> {
        const content = messages[0]?.content ?? '';
        order.push(`start:${content}`);
        await new Promise((r) => setTimeout(r, 1));
        order.push(`end:${content}`);
        return content;
      }
    }
    await new OrderedClient().completeBatch(['a', 'b']);
    expect(order).toEqual(['start:a', 'end:a', 'start:b', 'end:b']);
  });

  it('returns an empty array for no prompts, without calling complete', async () => {
    const client = new RecordingClient();
    await expect(client.completeBatch([])).resolves.toEqual([]);
    expect(client.calls).toHaveLength(0);
  });

  it('preserves an empty-string prompt rather than skipping it', async () => {
    const client = new RecordingClient();
    await client.completeBatch(['']);
    expect(client.calls[0]?.messages).toEqual([{ role: 'user', content: '' }]);
  });

  it('propagates a provider failure rather than returning partial results', async () => {
    // Silently returning three of five results would corrupt an enrichment
    // pass in a way the caller could not detect.
    await expect(new ThrowingClient().completeBatch(['a', 'b'])).rejects.toThrow(
      'provider unavailable',
    );
  });

  it('does not pass options through, so per-call defaults apply', async () => {
    const client = new RecordingClient();
    await client.completeBatch(['a']);
    expect(client.calls[0]?.opts).toBeUndefined();
  });
});

describe('LLMClient.getTokenUsage', () => {
  it('starts at zero', () => {
    expect(new RecordingClient().getTokenUsage()).toBe(0);
  });

  it('reflects what an implementation has recorded', () => {
    const client = new RecordingClient();
    client.addTokens(120);
    client.addTokens(30);
    expect(client.getTokenUsage()).toBe(150);
  });

  it('is per-instance, not shared across clients', () => {
    const a = new RecordingClient();
    const b = new RecordingClient();
    a.addTokens(100);
    expect(b.getTokenUsage()).toBe(0);
  });
});

describe('the LLMClient contract', () => {
  it('lets a subclass satisfy it by implementing only complete', async () => {
    class Minimal extends LLMClient {
      async complete(): Promise<string> {
        return 'ok';
      }
    }
    const client = new Minimal();
    await expect(client.complete([])).resolves.toBe('ok');
    await expect(client.completeBatch(['x'])).resolves.toEqual(['ok']);
    expect(client.getTokenUsage()).toBe(0);
  });

  it('accepts assistant messages, so a conversation can be continued', async () => {
    const client = new RecordingClient();
    const conversation: LLMMessage[] = [
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'a' },
      { role: 'user', content: 'follow up' },
    ];
    await client.complete(conversation);
    expect(client.calls[0]?.messages).toHaveLength(3);
  });

  it('passes options through on a direct complete call', async () => {
    const client = new RecordingClient();
    await client.complete([{ role: 'user', content: 'q' }], { model: 'm', temperature: 0.2 });
    expect(client.calls[0]?.opts).toEqual({ model: 'm', temperature: 0.2 });
  });
});
