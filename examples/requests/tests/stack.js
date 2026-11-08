// The core's test stack (Compose: two tool instances behind Caddy, PostgreSQL, Keycloak with the test realm)
// described for this tool; shared by tests/kit.test.js and the acceptance suite (playwright.config.js).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { query } from '@eupadev/core/kit/throwaway-postgres.js';
import { readRealm } from '@eupadev/core/kit/realm.js';

// ponytail: Compose and realm taken from the repository's core (the package does not ship the realm, decision E12).
export const CORE = fileURLToPath(new URL('../../../core/', import.meta.url));
export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const BASE = 'http://localhost:3000';
const { people: realmPeople, secret } = readRealm(`${CORE}tests/keycloak/realm-test.json`);
export const people = realmPeople;
/** The n-th person holding `role`: people are found by role, never by name, so the
 * same suite runs against the kit stack and against a Preview's personas. */
export const person = (/** @type {string} */ role, n = 1) => realmPeople.filter((p) => p.roles.includes(role))[n - 1] ?? assert.fail(`no person #${n} with role ${role}`);

/** `docker compose` on the kit stack, described for this tool (TOOL_* variables of kit/compose.test.yml). @param {string[]} args */
export function compose(args) {
  return execFileSync('docker', ['compose', '-f', `${CORE}kit/compose.test.yml`, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'],
    env: {
      ...process.env, OIDC_CLIENT_SECRET: secret, TOOL_NAME: 'requests', TOOL_DIR: ROOT,
      TOOL_ROOT: '/tool', TOOL_CORE: '/tool/node_modules/@eupadev/core', TOOL_VARS: `${ROOT}tests/stack.vars`,
    },
  }).trim();
}

/** Starts the stack (no-op when already up) and returns the PostgreSQL admin URL. */
export function startStack() {
  compose(['up', '-d', '--wait', '--wait-timeout', '300']);
  return adminUrl();
}

/** PostgreSQL admin URL of the running stack (test harness only: rate limits reset, never the tool's code). */
export const adminUrl = () => `postgres://postgres:test-admin@127.0.0.1:${compose(['port', 'postgres', '5432']).split(':').pop()}/requests`;

/** Stops and removes the stack, unless KIT_KEEP=1. */
export function stopStack() {
  if (process.env.KIT_KEEP !== '1') compose(['down', '-v', '--remove-orphans']);
}

/** Clears the rate-limit counters, so a run's own calls never hit 429. @param {string} admin */
export const resetRateLimits = (admin) => query(admin, 'DELETE FROM app.rate_limits');
