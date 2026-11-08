/**
 * Check of the contract role's deliverable (`openapi.yaml` at the root of its branch) with the core's own linter:
 * `parseContract` of `core/src/contract-lint.js`, the check the tool's CI runs first (`pnpm run verify` →
 * `readContract`). A contract the core refuses used to be found by that CI, after the tests and builder rounds it
 * had already paid for (cycle 9 of the lab); the launcher now fails the contract task itself, with the linter's
 * message, as soon as the task finishes (`claude-engine.ts`). The YAML is parsed here (the linter reads a parsed
 * document): a parse error is reported with its line.
 *
 * The linter file is read at its place in the repository, and copied there in the engine image (Dockerfile): no
 * dependency on the published core, whose version the tool chooses — this check is the engine's, the CI's stays.
 */
import { parse } from 'yaml';
// @ts-expect-error -- JavaScript module of the core, without type declarations (like the template's in fixed-image.test.ts)
import { parseContract } from '../../../core/src/contract-lint.js';

/** Why the core would refuse this `openapi.yaml`, or null when it reads it. Pure: tested without Git. */
export function contractRefused(text: string): string | null {
  let doc: unknown;
  try {
    doc = parse(text);
  } catch (e) {
    return `openapi.yaml does not parse: ${(e as Error).message}`;
  }
  try {
    parseContract(doc);
  } catch (e) {
    return `openapi.yaml: ${(e as Error).message}`;
  }
  return null;
}
