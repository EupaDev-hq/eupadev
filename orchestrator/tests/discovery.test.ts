// ADR-028, discovery mode: the page carries the "not for production" notice only when the engine says so (static.ts),
// in both languages. Without a database or a browser (web.test.ts drives the real page).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildStatic } from '../src/static.ts';

const web = new URL('../web/', import.meta.url).pathname;
const bundle = new URL('../node_modules/deep-chat/dist/deepChat.bundle.js', import.meta.url).pathname;
const page = (discovery: boolean) => buildStatic(web, bundle, discovery).get('/')!.content.toString('utf8');

test('discovery notice: data-discovery="1" shows it, empty hides it, nothing else of the page changes', () => {
  const on = page(true);
  const off = page(false);
  assert.ok(on.includes('<body data-discovery="1">'), 'discovery mode fills the attribute');
  assert.ok(off.includes('<body data-discovery="">'), 'otherwise the attribute is empty');
  assert.ok(!on.includes('__DISCOVERY__') && !off.includes('__DISCOVERY__'), 'placeholder always filled');
  assert.ok(on.includes('class="discovery" role="status" data-i18n="discovery.notice"'), 'the notice is in the page, translated by the dictionary');
  assert.equal(on.replace('data-discovery="1"', 'data-discovery=""'), off);
  const css = readFileSync(`${web}app.css`, 'utf8');
  assert.match(css, /\.discovery \{ display: none;/);
  assert.match(css, /body\[data-discovery="1"\] \.discovery \{ display: block; \}/);
  for (const lang of ['en', 'fr']) assert.match((JSON.parse(readFileSync(`${web}lang/${lang}.json`, 'utf8')) as Record<string, string>)['discovery.notice'] ?? '', /production/, lang);
  // The footer: the AI notice (provider, key) gives way to "made-up agents, nothing leaves this machine" in discovery mode.
  assert.ok(on.includes('<p class="ai" data-i18n="ai.notice"></p><p class="made-up" data-i18n="discovery.footer"></p>'), 'both footers are in the page, one shown by CSS');
  assert.match(css, /\.notice \.made-up, body\[data-discovery="1"\] \.notice \.ai \{ display: none; \}/);
  assert.match(css, /body\[data-discovery="1"\] \.notice \.made-up \{ display: block; \}/);
  for (const lang of ['en', 'fr']) {
    const footer = (JSON.parse(readFileSync(`${web}lang/${lang}.json`, 'utf8')) as Record<string, string>)['discovery.footer'] ?? '';
    assert.match(footer, /machine/, lang);
    assert.doesNotMatch(footer, /\bkey\b|cl\u00e9/, `${lang}: no key in discovery mode`);
  }
});
