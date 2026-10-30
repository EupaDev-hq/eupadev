#!/usr/bin/env node
// Fixed entry point of the tools (D21): `node node_modules/@eupadev/core/bin/start.js` from the tool's root.
// `--verify`: contract and handlers only (CI), without a database or a port.
import { start } from '../src/index.js';

try {
  await start({ verifyOnly: process.argv.includes('--verify') });
} catch (e) {
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
}
