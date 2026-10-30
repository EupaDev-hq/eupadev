// Test realm of the kit (tests/keycloak/realm-test.json, R8): the people with their roles of the `trial-tool` client
// and that client's secret, read from the file (never copied), for the core's bench as for a tool's.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Default path: the realm of the repository's core (the package does not ship it yet: step 9). */
export const TEST_REALM = fileURLToPath(new URL('../tests/keycloak/realm-test.json', import.meta.url));

/** @typedef {{ clientId: string, secret: string }} RealmClient */
/** @typedef {{ username: string, groups: string[], credentials: { value: string }[] }} RealmUser */

/**
 * @param {string} [path]
 * @returns {{ people: import('./index.js').Person[], secret: string }}
 */
export function readRealm(path = TEST_REALM) {
  /** @type {{ clients: RealmClient[], users: RealmUser[], groups: { name: string, clientRoles?: Record<string, string[]> }[] }} */
  const realm = JSON.parse(readFileSync(path, 'utf8'));
  const client = realm.clients.find((c) => c.clientId === 'trial-tool');
  if (!client) throw new Error(`${path}: client trial-tool missing`);
  return {
    people: realm.users.map((u) => ({
      name: u.username,
      password: u.credentials[0]?.value ?? '',
      roles: u.groups.flatMap((g) => realm.groups.find((x) => `/${x.name}` === g)?.clientRoles?.['trial-tool'] ?? []),
    })),
    secret: client.secret,
  };
}
