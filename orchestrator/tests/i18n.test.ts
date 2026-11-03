// End-user texts of the engine (ADR-025): both dictionaries hold the same keys with the same placeholders, every key the
// code names exists, and the deployment language falls back to English. No database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DICTIONARIES, LANGUAGES, text } from '../src/i18n.ts';
import { STATES } from '../src/machine/states.ts';
import { readConfig } from '../src/config.ts';

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

test('i18n: the en and fr dictionaries have the same keys, each with the same placeholders', () => {
  assert.deepEqual(Object.keys(DICTIONARIES.fr).sort(), Object.keys(DICTIONARIES.en).sort());
  for (const [key, en] of Object.entries(DICTIONARIES.en)) assert.deepEqual(placeholders(DICTIONARIES.fr[key]!), placeholders(en), key);
});

test('i18n: every key named by the code exists, the end of each final state included', () => {
  const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(`${dir}/${e.name}`) : e.name.endsWith('.ts') ? [`${dir}/${e.name}`] : []));
  const keys = new Set<string>();
  for (const f of files('src')) {
    for (const m of readFileSync(f, 'utf8').matchAll(/(?:\btr|#text|\btext\(language|\btext\(config\.language)\(?\s*,?\s*'([a-zA-Z0-9_.]+)'|key: '([a-zA-Z0-9_.]+)'/g)) keys.add((m[1] ?? m[2])!);
  }
  assert.ok(keys.size > 50, `only ${keys.size} keys found: the scan is broken`);
  for (const key of keys) assert.ok(Object.hasOwn(DICTIONARIES.en, key), `${key} missing from lang/en.json`);
  for (const s of STATES.filter((e) => e.kind === 'end')) assert.ok(Object.hasOwn(DICTIONARIES.en, `end.${s.id}`), `end.${s.id}`);
});

test('i18n: values fill the placeholders; an unknown key is a bug', () => {
  assert.equal(text('en', 'mail.dashboardLink', { url: 'https://d/cycles/1' }), 'Dashboard: https://d/cycles/1');
  assert.equal(text('fr', 'mail.dashboardLink', { url: 'https://d/cycles/1' }), 'Tableau de bord : https://d/cycles/1');
  assert.throws(() => text('en', 'no.such.key'), /unknown text key: no\.such\.key/);
});

test('i18n: EUPADEV_LANGUAGE chooses the language, English by default, anything else refused', () => {
  const env = { ORCH_DATABASE_URL: 'postgres://x', ADMIN_ESCALATION_ADDRESS: 'admin@example.test', TOOL_DOMAIN: 'example.test', DASHBOARD_URL: 'https://d', OIDC_ISSUER: 'https://i/realms/r', OIDC_JWKS_URL: 'https://i/certs' };
  assert.equal(readConfig(env).language, 'en');
  for (const l of LANGUAGES) assert.equal(readConfig({ ...env, EUPADEV_LANGUAGE: l }).language, l);
  assert.throws(() => readConfig({ ...env, EUPADEV_LANGUAGE: 'de' }), /EUPADEV_LANGUAGE invalid: "de"/);
});

test('i18n: the page’s dictionaries (web/lang) have the same keys in fr and en', () => {
  const web = (l: string) => Object.keys(JSON.parse(readFileSync(new URL(`../web/lang/${l}.json`, import.meta.url), 'utf8')) as Record<string, string>).sort();
  assert.deepEqual(web('fr'), web('en'));
});
