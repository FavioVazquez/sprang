#!/usr/bin/env node
import { Command } from 'commander';
import { makeScanCommand } from './commands/scan.js';
import { makeHealthCommand } from './commands/health.js';
import { makeQueryCommand } from './commands/query.js';
import { makeWatchCommand } from './commands/watch.js';
import { makeStatusCommand } from './commands/status.js';
import { makeInstallHooksCommand } from './commands/install-hooks.js';
import { makeOpenCommand } from './commands/open.js';
import { makeDiagramCommand } from './commands/diagram.js';

const program = new Command();

program
  .name('sprang')
  .description('The qualitative leap — Sprang knowledge graph CLI')
  .version('0.1.0');

program.addCommand(makeScanCommand());
program.addCommand(makeHealthCommand());
program.addCommand(makeQueryCommand());
program.addCommand(makeWatchCommand());
program.addCommand(makeStatusCommand());
program.addCommand(makeInstallHooksCommand());
program.addCommand(makeOpenCommand());
program.addCommand(makeDiagramCommand());

program.parse(process.argv);
