// Throwaway Keycloak: same version and same digest as the base of the lab image (images/keycloak/Dockerfile,
// ADR-005), dev mode (file database, HTTP), realm `tools` imported from tests/keycloak/realm-test.json, free port on
// 127.0.0.1, removed at the end, even on failure.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as wait } from 'node:timers/promises';

export const IMAGE = 'quay.io/keycloak/keycloak:26.8.1@sha256:79c623a22abacf3fe6c00a5fb30f5b7843d717b234033b80995891c06116d244';
const DIR = fileURLToPath(new URL('../keycloak/', import.meta.url));
export const TEST_REALM = `${DIR}realm-test.json`;
const docker = (/** @type {string[]} */ ...args) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();

/** @typedef {{ base: string, issuer: string, container: string, remove(): void }} ThrowawayKeycloak */

/** @returns {Promise<ThrowawayKeycloak>} */
export async function startKeycloak() {
  // Folder tests/keycloak/ copied into the container before it starts: no mount (rights of user 1000).
  // host.docker.internal → the host machine: the back-channel logout of the test realm targets http://host.docker.internal:3000.
  let container = docker('create', '--rm', '-p', '127.0.0.1::8080', '--add-host', 'host.docker.internal:host-gateway', IMAGE, 'start-dev', '--import-realm');
  const remove = () => {
    if (container === '') return;
    try { execFileSync('docker', ['rm', '-f', '-v', container], { stdio: 'ignore' }); } catch { /* already gone */ }
    container = '';
  };
  process.once('SIGINT', () => { remove(); process.exit(130); });
  process.once('SIGTERM', () => { remove(); process.exit(143); });
  process.once('exit', remove);
  try {
    docker('cp', `${DIR}.`, `${container}:/opt/keycloak/data/import`);
    docker('start', container);
    const port = docker('port', container, '8080/tcp').split('\n')[0]?.split(':').pop();
    const base = `http://127.0.0.1:${port}`;
    const limit = Date.now() + 180_000;
    for (;;) {
      try {
        const r = await fetch(`${base}/realms/tools/.well-known/openid-configuration`);
        if (r.ok) return { base, issuer: /** @type {{ issuer: string }} */ (await r.json()).issuer, container, remove };
      } catch { /* not listening yet */ }
      if (Date.now() > limit) throw new Error(`Keycloak unreachable; log:\n${docker('logs', '--tail', '40', container)}`);
      await wait(1000);
    }
  } catch (e) {
    remove();
    throw e;
  }
}
