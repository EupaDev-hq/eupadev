// Demonstration page of the example tool: each module of the core is used once. No direct innerHTML, no inline
// style, no API URL written by hand outside `api.get/delete` (the router and the form go through `operationId`).
import { api, errorMessage } from '/core/api.js';
import { bindForm } from '/core/form.js';
import { clone, html, list, fill, render } from '/core/render.js';
import { createRouter } from '/core/router.js';
import { barChart } from '/core/svg-chart.js';
import DOMPurify from '/core/vendor/purify.js';

/** @typedef {{ id: string, name: string, status: string, note?: string }} Item */

const main = /** @type {HTMLElement} */ (document.getElementById('main'));
/** @type {Item[]} */
let items = [];

async function load() {
  items = (await api.get('/api/items', { query: { limit: 100 } })).items;
  return items;
}

async function listView() {
  const section = clone('tpl-list');
  main.replaceChildren(section);
  const ul = /** @type {HTMLElement} */ (section.querySelector('#items'));
  const state = /** @type {HTMLElement} */ (section.querySelector('[data-state]'));
  const empty = /** @type {HTMLElement} */ (section.querySelector('#empty'));
  const show = () => {
    list(ul, items, {
      key: (i) => i.id,
      render: (i) => {
        const li = clone('tpl-item', i);
        /** @type {HTMLAnchorElement} */ (li.querySelector('[data-link="detail"]')).href = `#/items/${encodeURIComponent(i.id)}`;
        return li;
      },
    });
    empty.hidden = items.length > 0;
  };
  ul.addEventListener('click', async (ev) => {
    const button = /** @type {HTMLElement} */ (ev.target).closest('[data-action="delete"]');
    const id = button?.closest('[data-key]')?.getAttribute('data-key');
    if (!id) return;
    try {
      await api.call('deleteItem', { params: { id } });
      await load();
      show();
    } catch (e) {
      state.setAttribute('data-state', 'error');
      state.textContent = errorMessage(e);
    }
  });
  try {
    // Download: a same-origin link (navigation), never a fetch.
    /** @type {HTMLAnchorElement} */ (section.querySelector('#export')).href = await api.link('exportItems');
    await load();
    show();
  } catch (e) { state.setAttribute('data-state', 'error'); state.textContent = errorMessage(e); }
}

/** @param {Record<string, string>} params */
async function detailView(params) {
  try {
    const item = await api.call('getItem', { params });
    main.replaceChildren(clone('tpl-detail', item));
  } catch (e) {
    const p = document.createElement('p');
    p.textContent = errorMessage(e);
    main.replaceChildren(p);
  }
}

async function newView() {
  const section = clone('tpl-new');
  main.replaceChildren(section);
  await bindForm(/** @type {HTMLFormElement} */ (section.querySelector('form')), 'createItem', {
    after: () => router.go('/'),
  });
}

async function statsView() {
  const section = clone('tpl-stats');
  main.replaceChildren(section);
  await load();
  const count = (/** @type {string} */ s) => items.filter((i) => i.status === s).length;
  barChart(/** @type {Element} */ (section.querySelector('#chart')), {
    title: 'Items by status',
    categories: ['Open', 'Closed'],
    series: [{ name: 'Items', values: [count('open'), count('closed')] }],
  });
}

async function richView() {
  const section = clone('tpl-rich');
  main.replaceChildren(section);
  await load();
  const note = items.findLast((i) => i.note !== undefined)?.note ?? '(no note)';
  render(/** @type {Element} */ (section.querySelector('#escaped')), html`<p>Note: <strong>${note}</strong></p>`);
  // Rich text without images: an `<img>` from a user has neither a reliable `alt` nor a safe origin.
  render(/** @type {Element} */ (section.querySelector('#sanitized')), DOMPurify.sanitize(note, { RETURN_TRUSTED_TYPE: true, FORBID_TAGS: ['img'] }));
}

const router = createRouter({
  '/': listView,
  '/items/:id': detailView,
  '/new': newView,
  '/stats': statsView,
  '/rich': richView,
  '*': (_p, path) => { const s = clone('tpl-not-found'); fill(s, { path }); main.replaceChildren(s); },
});
await router.start();
