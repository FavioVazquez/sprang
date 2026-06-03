import { join } from 'node:path';
import { fork } from 'node:child_process';
import { LLMClient } from '../llm/client.js';
import { runPhase1 } from './phase1.js';
import type { KnowledgeGraph } from '../schema/types.js';
import type { SprangOptions } from '../agents/base.js';
import { SPRANG_DIR } from '../schema/constants.js';

export async function runSprangAnalysis(
  projectRoot: string,
  options: SprangOptions & { background?: boolean }
): Promise<void> {
  const sprangDir = join(projectRoot, SPRANG_DIR);
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  const llm = new LLMClient(apiKey);

  const log = (msg: string) => process.stdout.write(msg + '\n');

  log('[sprang] Starting Phase 1 analysis...');
  const skeletonGraph = await runPhase1(
    projectRoot,
    sprangDir,
    options,
    llm,
    log
  );
  log(
    `[sprang] Phase 1 complete. Nodes: ${skeletonGraph.nodes.length}, Edges: ${skeletonGraph.edges.length}`
  );

  if (options.skipLLM) {
    log('[sprang] skipLLM=true, skipping Phase 2.');
    return;
  }

  // Phase 2 — LLM enrichment
  if (options.background) {
    log('[sprang] Forking Phase 2 as background process...');
    const phase2ScriptPath = new URL('./phase2-runner.js', import.meta.url).pathname;
    const child = fork(phase2ScriptPath, [], {
      detached: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        SPRANG_PROJECT_ROOT: projectRoot,
        SPRANG_DIR: sprangDir,
        SPRANG_OPTIONS: JSON.stringify(options),
      },
    });
    child.unref();
    log('[sprang] Phase 2 process forked (detached). PID: ' + (child.pid ?? 'unknown'));
  } else {
    log('[sprang] Running Phase 2 inline (this may take a while)...');
    try {
      // Dynamically import phase2 to keep it optional
      const { runPhase2 } = await import('./phase2.js');
      await runPhase2(projectRoot, sprangDir, options, log);
      log('[sprang] Phase 2 complete.');
    } catch (err) {
      log(
        '[sprang] Phase 2 not available or failed: ' +
          (err instanceof Error ? err.message : String(err))
      );
    }
  }
}

export async function runPhase1Only(
  projectRoot: string,
  options?: SprangOptions
): Promise<KnowledgeGraph> {
  const sprangDir = join(projectRoot, SPRANG_DIR);
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  const llm = new LLMClient(apiKey);
  const log = (msg: string) => process.stdout.write(msg + '\n');

  return runPhase1(projectRoot, sprangDir, options ?? {}, llm, log);
}
