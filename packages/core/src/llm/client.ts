export interface LLMMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface LLMOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

/**
 * LLMClient is a simple interface for optional LLM enrichment.
 *
 * In production, your AI agent (Claude Code, Windsurf, Copilot) IS the LLM — it reads
 * the knowledge graph via MCP tools and applies its own intelligence. This client is only
 * used when an
 * explicit enrichment pass is requested with a custom implementation.
 *
 * The default NullLLMClient returns empty strings (graceful no-op).
 */
export abstract class LLMClient {
  protected totalTokensUsed = 0;

  abstract complete(messages: LLMMessage[], opts?: LLMOptions): Promise<string>;

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

/** Default no-op client. All agents fall back to heuristics when this is used. */
export class NullLLMClient extends LLMClient {
  async complete(_messages: LLMMessage[], _opts?: LLMOptions): Promise<string> {
    return '';
  }
}
