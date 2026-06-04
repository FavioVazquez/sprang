import { join } from 'node:path';
import * as path from 'node:path';
import { fork } from 'node:child_process';
import { execSync } from 'node:child_process';
import { NullLLMClient } from '../llm/client.js';
import { runPhase1 } from './phase1.js';
import { saveGraph } from '../graph/store.js';
import type { KnowledgeGraph } from '../schema/types.js';
import type { SprangOptions } from '../agents/base.js';
import { SPRANG_DIR } from '../schema/constants.js';

function getCurrentGitHash(projectRoot: string): string | undefined {
  try {
    return execSync('git rev-parse HEAD', { cwd: projectRoot, encoding: 'utf-8' }).trim();
  } catch { return undefined; }
}

export async function resolveSprangDir(projectRoot: string, sprangDir: string): Promise<string> {
  try {
    // git rev-parse --git-common-dir returns .git for main worktree,
    // or a relative path like ../../.git for a worktree
    const gitCommonDir = execSync('git rev-parse --git-common-dir', {
      cwd: projectRoot, encoding: 'utf-8'
    }).trim();
    const absGitCommonDir = path.isAbsolute(gitCommonDir)
      ? gitCommonDir
      : path.resolve(projectRoot, gitCommonDir);
    const mainRepoRoot = path.dirname(absGitCommonDir);
    if (mainRepoRoot !== projectRoot) {
      // We're in a worktree — redirect to main repo
      const redirectedDir = path.join(mainRepoRoot, SPRANG_DIR);
      const log = (msg: string) => process.stdout.write(msg + '\n');
      log(`[sprang] Worktree detected — using main repo's .sprang at ${redirectedDir}`);
      return redirectedDir;
    }
  } catch { /* not a git repo or git not available */ }
  return sprangDir;
}

export async function runSprangAnalysis(
  projectRoot: string,
  options: SprangOptions & { background?: boolean }
): Promise<void> {
  const baseSprangDir = join(projectRoot, SPRANG_DIR);
  const sprangDir = await resolveSprangDir(projectRoot, baseSprangDir);
  const llm = new NullLLMClient();

  const log = (msg: string) => process.stdout.write(msg + '\n');

  log('[sprang] Starting Phase 1 analysis...');
  let skeletonGraph = await runPhase1(
    projectRoot,
    sprangDir,
    options,
    llm,
    log
  );

  // Record the current git commit hash in the graph stats
  const gitHash = getCurrentGitHash(projectRoot);
  if (gitHash) {
    skeletonGraph = {
      ...skeletonGraph,
      stats: { ...skeletonGraph.stats, gitCommitHash: gitHash },
    };
    await saveGraph(sprangDir, skeletonGraph);
  }

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
        // Whitelist only what the child process needs — do not inherit the full env
        PATH: process.env['PATH'],
        HOME: process.env['HOME'],
        NODE_ENV: process.env['NODE_ENV'],
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
  const baseSprangDir = join(projectRoot, SPRANG_DIR);
  const sprangDir = await resolveSprangDir(projectRoot, baseSprangDir);
  const llm = new NullLLMClient();
  const log = (msg: string) => process.stdout.write(msg + '\n');

  let graph = await runPhase1(projectRoot, sprangDir, options ?? {}, llm, log);

  // Record the current git commit hash in the graph stats
  const gitHash = getCurrentGitHash(projectRoot);
  if (gitHash) {
    graph = {
      ...graph,
      stats: { ...graph.stats, gitCommitHash: gitHash },
    };
    await saveGraph(sprangDir, graph);
  }

  return graph;
}
