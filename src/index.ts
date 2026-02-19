#!/usr/bin/env node

import { createCli } from './cli/index.js';

process.on('SIGINT', () => process.exit(130));

const program = createCli();
program.parse();
