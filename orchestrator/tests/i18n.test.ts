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

test('i18n: mail subjects name the gate in plain words (every gate has a name) and each chat message notified to the requester has its own subject, URL and digest left to the body', () => {
  const gates = STATES.filter((e) => e.kind === 'gate').map((e) => e.id);
  for (const l of LANGUAGES) for (const g of gates) assert.ok(Object.hasOwn(DICTIONARIES[l], `gate.name.${g}`), `gate.name.${g} missing from lang/${l}.json`);
  for (const k of ['mail.decision.subject', 'mail.decision.reminder.subject', 'mail.decision.weekly.subject']) assert.ok(!DICTIONARIES.en[k]!.includes('{state}'), `${k} still exposes the state id`);
  assert.equal(text('en', 'mail.decision.subject', { gate: text('en', 'gate.name.gate_1'), tool: 'Equipment loans' }), 'Decision required — Gate 1: name and domain of the tool (Equipment loans)');
  // The requester's subject is `<tool> — <subject of the message>`, never the message cut at 60 characters (a URL, a digest).
  const workflow = readFileSync(new URL('../src/workflows/toolCycle.ts', import.meta.url), 'utf8');
  const notified = [...workflow.matchAll(/notifyRequester\(c, \{ key: '([a-zA-Z0-9_.]+)'/g)].map((m) => m[1]!);
  assert.ok(notified.length >= 6, `only ${notified.length} notified messages found: the scan is broken`);
  for (const k of [...notified, 'chat.cycleEnd']) {
    assert.ok(Object.hasOwn(DICTIONARIES.en, `${k}.subject`), `${k}.subject missing from lang/en.json`);
    assert.ok(!/\{(url|digest)\}/.test(DICTIONARIES.en[`${k}.subject`]!), `${k}.subject carries a URL or a digest`);
  }
  assert.equal(text('en', 'mail.requester.subject', { tool: 'Equipment loans', summary: text('en', 'chat.mockupAvailable.subject') }), 'Equipment loans — Mock-up available');
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
