import Anthropic from '@anthropic-ai/sdk';

export interface LLMMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface LLMOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isOverloadError(err: unknown): boolean {
  if (err instanceof Anthropic.APIError) {
    return err.status === 529 || err.status === 503;
  }
  return false;
}

export class LLMClient {
  private client: Anthropic;
  private defaultModel: string;
  private totalTokensUsed = 0;

  constructor(apiKey?: string, defaultModel?: string) {
    this.client = new Anthropic({
      apiKey: apiKey ?? process.env['ANTHROPIC_API_KEY'],
    });
    this.defaultModel = defaultModel ?? DEFAULT_MODEL;
  }

  async complete(messages: LLMMessage[], opts?: LLMOptions): Promise<string> {
    const model = opts?.model ?? this.defaultModel;
    const maxTokens = opts?.maxTokens ?? 1024;

    let lastError: unknown;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const response = await this.client.messages.create({
          model,
          max_tokens: maxTokens,
          temperature: opts?.temperature,
          messages: messages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
        });

        const inputTokens = response.usage.input_tokens;
        const outputTokens = response.usage.output_tokens;
        this.totalTokensUsed += inputTokens + outputTokens;

        const block = response.content[0];
        if (block?.type === 'text') {
          return block.text;
        }
        return '';
      } catch (err) {
        lastError = err;
        if (isOverloadError(err) && attempt < MAX_RETRIES - 1) {
          await sleep(RETRY_DELAY_MS * (attempt + 1));
          continue;
        }
        throw err;
      }
    }

    throw lastError;
  }

  async completeBatch(prompts: string[]): Promise<string[]> {
    const results: string[] = [];

    for (const prompt of prompts) {
      const result = await this.complete([{ role: 'user', content: prompt }]);
      results.push(result);
    }

    return results;
  }

  getTokenUsage(): number {
    return this.totalTokensUsed;
  }
}
