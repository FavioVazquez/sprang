#!/usr/bin/env node
import { Command } from 'commander';
import { makeScanCommand } from './commands/scan.js';
import { makeHealthCommand } from './commands/health.js';
import { makeQueryCommand } from './commands/query.js';

const program = new Command();

program
  .name('sprang')
  .description('The qualitative leap — Sprang knowledge graph CLI')
  .version('0.1.0');

program.addCommand(makeScanCommand());
program.addCommand(makeHealthCommand());
program.addCommand(makeQueryCommand());

program.parse(process.argv);
