// Standalone entry point forked by runner.ts for background Phase 2 execution.
// Receives config via environment variables set by the parent process.
import { runPhase2 } from './phase2.js';

const projectRoot = process.env['SPRANG_PROJECT_ROOT'];
const sprangDir = process.env['SPRANG_DIR'];
const rawOptions = process.env['SPRANG_OPTIONS'];

if (!projectRoot || !sprangDir) {
  process.stderr.write('[sprang phase2-runner] Missing SPRANG_PROJECT_ROOT or SPRANG_DIR\n');
  process.exit(1);
}

const options = rawOptions ? JSON.parse(rawOptions) : {};

const log = (msg: string) => process.stderr.write(`[sprang phase2] ${msg}\n`);

runPhase2(projectRoot, sprangDir, options, log)
  .then(() => {
    log('complete');
    process.exit(0);
  })
  .catch((err: unknown) => {
    log('failed: ' + (err instanceof Error ? err.message : String(err)));
    process.exit(1);
  });
