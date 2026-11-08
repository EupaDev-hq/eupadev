// Reading of the openapi.yaml contract: file, YAML, then the linter of contract-lint.js (re-exported whole from
// here, the module every import of the core names).
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { parseContract } from './contract-lint.js';

export * from './contract-lint.js';
/** @typedef {import('./contract-lint.js').Contract} Contract */
/** @typedef {import('./contract-lint.js').Operation} Operation */
/** @typedef {import('./contract-lint.js').Schema} Schema */

/** @param {string} path */
export function readContract(path) {
  return parseContract(parse(readFileSync(path, 'utf8')));
}
