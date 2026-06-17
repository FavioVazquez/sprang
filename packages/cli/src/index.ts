#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Command } from 'commander';
import { makeScanCommand } from './commands/scan.js';
import { makeHealthCommand } from './commands/health.js';
import { makeQueryCommand } from './commands/query.js';
import { makeWatchCommand } from './commands/watch.js';
import { makeStatusCommand } from './commands/status.js';
import { makeInstallHooksCommand } from './commands/install-hooks.js';
import { makeMergeCommand } from './commands/merge.js';
import { makeOpenCommand } from './commands/open.js';
import { makeDiagramCommand } from './commands/diagram.js';
import { makeInitCommand } from './commands/init.js';

// Read version from package.json so it never drifts from the published version.
const pkg = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../package.json'), 'utf8'),
) as { version: string };

const program = new Command();

program
  .name('sprang')
  .description('The qualitative leap — Sprang knowledge graph CLI')
  .version(pkg.version);

program.addCommand(makeScanCommand());
program.addCommand(makeMergeCommand());
program.addCommand(makeHealthCommand());
program.addCommand(makeQueryCommand());
program.addCommand(makeWatchCommand());
program.addCommand(makeStatusCommand());
program.addCommand(makeInstallHooksCommand());
program.addCommand(makeOpenCommand());
program.addCommand(makeDiagramCommand());
program.addCommand(makeInitCommand());

program.parse(process.argv);
