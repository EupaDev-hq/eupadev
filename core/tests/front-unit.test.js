// Pure functions of the front modules, under Node (without a DOM): escaping, `html` template, routes, form
// constraints and conversion, chart scale, messages in both languages of the dictionaries.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { ApiError, errorMessage, retryAfterSeconds } from '../web/api.js';
import { escapeHtml } from '../web/escape-html.js';
import { constraints, values } from '../web/form.js';
import { SafeHtml, html } from '../web/render.js';
import { fragmentPath, match } from '../web/router.js';
import { scale } from '../web/svg-chart.js';

describe('escape-html', () => {
  test('the five characters, null and undefined', () => {
    assert.equal(escapeHtml(`<a href="x" title='y'>&</a>`), '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
    assert.equal(escapeHtml(null), '');
    assert.equal(escapeHtml(undefined), '');
    assert.equal(escapeHtml(12), '12');
  });
});

describe('render: html template', () => {
  test('escapes the values, not the template', () => {
    const name = '<img src=x onerror="window.__xss=1">';
    assert.equal(String(html`<p class="a">${name}</p>`), '<p class="a">&lt;img src=x onerror=&quot;window.__xss=1&quot;&gt;</p>');
  });
  test('nesting, arrays, null', () => {
    const rows = ['a<b', 'c'].map((t) => html`<li>${t}</li>`);
    const r = html`<ul>${rows}</ul>${null}${undefined}${0}`;
    assert.ok(r instanceof SafeHtml);
    assert.equal(r.text, '<ul><li>a&lt;b</li><li>c</li></ul>0');
  });
  test('a string that looks like safe HTML stays escaped (only SafeHtml passes)', () => {
    assert.equal(String(html`${'<b>x</b>'}`), '&lt;b&gt;x&lt;/b&gt;');
    assert.equal(String(html`${String(html`<b>x</b>`)}`), '&lt;b&gt;x&lt;/b&gt;');
  });
});

describe('router: matching', () => {
  test('patterns, decoded parameters, refusals', () => {
    assert.deepEqual(match('/', '/'), {});
    assert.deepEqual(match('/items/:id', '/items/42'), { id: '42' });
    assert.deepEqual(match('/items/:id', '/items/a%2Fb'), { id: 'a/b' });
    assert.equal(match('/items/:id', '/items'), null);
    assert.equal(match('/items/:id', '/items/'), null);
    assert.equal(match('/items/:id', '/items/42/x'), null);
    assert.equal(match('/items/:id', '/items/%E0%A4%A'), null);
    assert.equal(match('/a', '/b'), null);
  });
  test('fragment → path', () => {
    assert.equal(fragmentPath(''), '/');
    assert.equal(fragmentPath('#'), '/');
    assert.equal(fragmentPath('#/items/1?x=2'), '/items/1');
    assert.equal(fragmentPath('#javascript:alert(1)'), '/');
  });
});

describe('form: constraints and values from the schema', () => {
  const schema = {
    type: 'object', required: ['name', 'active'],
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 80, pattern: '^[^<>]*$' },
      qty: { type: 'integer', minimum: 1, maximum: 100 },
      price: { type: 'number' },
      active: { type: 'boolean' },
      status: { type: ['string', 'null'], enum: ['open', 'closed'] },
    },
  };
  test('HTML attributes', () => {
    assert.deepEqual(constraints(schema.properties.name, true), { required: '', minlength: '1', maxlength: '80', pattern: '^[^<>]*$' });
    assert.deepEqual(constraints(schema.properties.qty, false), { min: '1', max: '100', step: '1' });
    assert.deepEqual(constraints(schema.properties.price, false), { step: 'any' });
    assert.deepEqual(constraints(schema.properties.status, false), {});
  });
  test('conversion: types, empty ones absent, outside the schema ignored, required boolean', () => {
    const body = values(schema, [['name', '  Screw  '], ['qty', '3'], ['price', '1.5'], ['status', ''], ['role', 'admin']]);
    assert.deepEqual(body, { name: 'Screw', qty: 3, price: 1.5, active: false });
    assert.deepEqual(values(schema, [['name', 'a'], ['active', 'on']]), { name: 'a', active: true });
  });
  test('emptied field: the empty value its schema accepts, so an optional text can be cleared', () => {
    const s = {
      type: 'object',
      properties: {
        description: { type: 'string', maxLength: 4000 },
        title: { type: 'string', minLength: 1 },
        code: { type: 'string', pattern: '^[a-z]+$' },
        note: { type: ['string', 'null'], minLength: 1 },
        qty: { type: 'integer' },
        deadline: { type: ['integer', 'null'] },
      },
    };
    const empties = ['description', 'title', 'code', 'note', 'qty', 'deadline'].map((n) => /** @type {[string, string]} */ ([n, '  ']));
    assert.deepEqual(values(s, empties), { description: '', note: null, deadline: null });
  });
});

describe('svg-chart: scale', () => {
  test('step 1-2-5 and rounded top', () => {
    assert.deepEqual(scale(7), { top: 8, step: 2 });
    assert.deepEqual(scale(23), { top: 30, step: 10 });
    assert.deepEqual(scale(1000), { top: 1000, step: 500 });
    assert.deepEqual(scale(1000, 10), { top: 1000, step: 100 });
    assert.deepEqual(scale(0.3), { top: 0.3, step: 0.1 });
    assert.deepEqual(scale(0), { top: 1, step: 1 });
    assert.deepEqual(scale(Number.NaN), { top: 1, step: 1 });
  });
});

describe('api: Retry-After and messages', () => {
  test('seconds, HTTP date, missing, unreadable', () => {
    assert.equal(retryAfterSeconds('30'), 30);
    assert.equal(retryAfterSeconds('0'), 1);
    assert.equal(retryAfterSeconds('Wed, 21 Oct 2026 07:28:00 GMT', Date.parse('Wed, 21 Oct 2026 07:27:30 GMT')), 30);
    assert.equal(retryAfterSeconds(null), null);
    assert.equal(retryAfterSeconds('soon'), null);
  });
  test('messages: 429, problem with a reference, timeout, network (English without a page language)', () => {
    assert.equal(errorMessage(new ApiError(429, { code: 'RATE_LIMITED', detail: 'Too many requests' }, 12)), 'Too many requests. Try again in 12 s.');
    assert.equal(errorMessage(new ApiError(404, { detail: 'Item x not found', error_id: 'abc' })), 'Item x not found (ref. abc)');
    assert.equal(errorMessage(new ApiError(502, null)), 'HTTP error 502');
    assert.equal(errorMessage(Object.assign(new Error('x'), { name: 'TimeoutError' })), 'The server is not responding. Try again.');
    assert.equal(errorMessage(new TypeError('fetch failed')), 'Network error. Try again.');
  });
  test('messages in French when the page says `lang="fr"` (lang/fr.json)', () => {
    const fr = JSON.parse(readFileSync(new URL('../web/lang/fr.json', import.meta.url), 'utf8'));
    const g = /** @type {any} */ (globalThis);
    g.document = { documentElement: { lang: 'fr-FR' } };
    try {
      assert.equal(errorMessage(new ApiError(429, null, 12)), fr['api.tooManyRequests'].replace('{seconds}', '12'));
      assert.equal(errorMessage(new ApiError(404, { detail: 'x', error_id: 'abc' })), fr['api.withReference'].replace('{detail}', 'x').replace('{id}', 'abc'));
    } finally { delete g.document; }
  });
});
