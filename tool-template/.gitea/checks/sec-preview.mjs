// The platform's SEC-* against the Preview: generated from the
// tool's contract by the core's kit (pinned by the tool's lockfile), written by nobody per tool. Run by acceptance.sh
// under node --test; protected (.gitea/**). The Preview database is not reachable from the job (no rate-limit reset)
// and every check spends the same per-minute windows: SEC-RATE checks run last, each at the start of a new minute.
// SEC-ERR's forced failures need a test double of the tool: only its unknown-route case runs.
import { test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { readRealm } from '@eupadev/core/kit/realm.js';
import { generateCases } from '@eupadev/core/kit/sec.js';

const base = /** @type {string} */ (process.env.ACCEPTANCE_BASE_URL);
// The Preview's IdP has its own host (auth.<domain>), unlike the test Compose: the CSP's form-action names the
// origin /auth/login redirects to.
const idp = (await fetch(`${base}/auth/login`, { redirect: 'manual' })).headers.get('location');
if (!idp) throw new Error(`${base}/auth/login does not redirect to the IdP`);
const cases = generateCases({
  contract: 'openapi.yaml',
  base,
  people: readRealm(process.env.KIT_REALM_FILE).people,
  idpOrigin: new URL(idp).origin,
});
for (const c of cases.filter((x) => x.sec !== 'SEC-RATE')) test(c.name, c.verify);
for (const c of cases.filter((x) => x.sec === 'SEC-RATE')) {
  test(c.name, async () => {
    await sleep(60_200 - (Date.now() % 60_000));
    await c.verify();
  });
}
