import { join } from 'node:path';
import type { KnowledgeGraph } from '../schema/types.js';
import type { LLMClient, LLMOptions } from '../llm/client.js';
import { writeFileAtomic, readJsonFileOrNull, ensureDir } from '../utils/fs.js';

export interface AgentContext {
  projectRoot: string;
  sprangDir: string;
  intermediateDir: string;
  cacheDir: string;
  graph: KnowledgeGraph;
  llm: LLMClient;
  options: SprangOptions;
}

export interface AgentResult {
  agentId: string;
  success: boolean;
  error?: string;
  mutatedGraph: KnowledgeGraph;
  tokensUsed?: number;
}

export interface SprangOptions {
  phase?: 1 | 2 | 'all';
  skipLLM?: boolean;
  maxConcurrency?: number;
  excludePatterns?: string[];
}

export abstract class BaseAgent {
  abstract readonly id: string;
  abstract readonly phase: 1 | 2;
  abstract run(ctx: AgentContext): Promise<AgentResult>;

  protected success(ctx: AgentContext, mutatedGraph?: KnowledgeGraph): AgentResult {
    return {
      agentId: this.id,
      success: true,
      mutatedGraph: mutatedGraph ?? ctx.graph,
    };
  }

  protected failure(ctx: AgentContext, error: string): AgentResult {
    return {
      agentId: this.id,
      success: false,
      error,
      mutatedGraph: ctx.graph,
    };
  }

  protected async writeIntermediate(
    ctx: AgentContext,
    filename: string,
    data: unknown
  ): Promise<void> {
    await ensureDir(ctx.intermediateDir);
    const filePath = join(ctx.intermediateDir, filename);
    await writeFileAtomic(filePath, JSON.stringify(data, null, 2));
  }

  protected async readIntermediate<T>(
    ctx: AgentContext,
    filename: string
  ): Promise<T | null> {
    const filePath = join(ctx.intermediateDir, filename);
    return readJsonFileOrNull<T>(filePath);
  }
}
