// Screens of the maintenance-request tool, on the core's front modules: every call goes through an operationId of
// the contract, every text through textContent (clone, fill, list), no innerHTML, no inline style. What a button
// offers is a hint for the caller; the server and the database still judge every change.
import { api, errorMessage } from '/core/api.js';
import { bindForm } from '/core/form.js';
import { clone, fill, list } from '/core/render.js';
import { createRouter } from '/core/router.js';

const STATUS = { draft: 'Draft', submitted: 'Submitted', in_progress: 'In progress', resolved: 'Resolved', rejected: 'Rejected', cancelled: 'Cancelled' };
const BADGE = { draft: 'badge-info', submitted: 'badge-warning', in_progress: 'badge-info', resolved: 'badge-success', rejected: 'badge-error', cancelled: '' };
const URGENCY = { low: 'Low', normal: 'Normal', high: 'High' };
/** Next statuses the database accepts (trigger requests_transition), and who asks for them (api/lib/transitions.js). */
const NEXT = { draft: ['submitted', 'cancelled'], submitted: ['in_progress', 'rejected', 'cancelled'], in_progress: ['resolved', 'rejected'] };
const BY_AUTHOR = ['submitted', 'cancelled'];
const WITH_NOTE = ['resolved', 'rejected'];
const ACTION = { submitted: 'Submit', cancelled: 'Cancel request', in_progress: 'Take on', resolved: 'Resolve', rejected: 'Reject' };

const main = /** @type {HTMLElement} */ (document.getElementById('main'));
/** @type {{ id: string, name: string, roles: string[] }} */
const me = await api.call('getMe');
const isAdmin = me.roles.includes('admin');
const manages = isAdmin || me.roles.includes('manager');
/** @type {Map<string, string>} code → label, inactive categories included (an old request keeps its label) */
const categories = new Map();

/** @param {string} iso */
const when = (iso) => new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
/** @param {ParentNode} root */
function showRoles(root) {
  for (const el of root.querySelectorAll('[data-role]')) {
    const role = el.getAttribute('data-role');
    /** @type {HTMLElement} */ (el).hidden = !(role === 'admin' ? isAdmin : manages);
  }
}
/** @param {Element} el @param {'in-progress' | 'success' | 'error' | ''} state @param {string} text */
function announce(el, state, text) {
  el.setAttribute('data-state', state);
  el.textContent = text;
}
/** @param {HTMLSelectElement} select @param {Record<string, string> | Map<string, string>} options */
function addOptions(select, options) {
  for (const [value, label] of options instanceof Map ? options : Object.entries(options)) select.append(new Option(label, value));
}
/** @param {Element} el @param {string} status */
function badge(el, status) {
  el.textContent = STATUS[/** @type {keyof STATUS} */ (status)] ?? status;
  el.className = `status-badge ${BADGE[/** @type {keyof BADGE} */ (status)] ?? ''}`;
}
/** @param {string} heading @param {string} text */
function message(heading, text) {
  main.replaceChildren(clone('tpl-message', { heading, text }));
}
/** Readable fields of a request, for the templates. @param {any} r */
const shown = (r) => ({
  ...r,
  category: categories.get(r.category) ?? r.category,
  urgency: URGENCY[/** @type {keyof URGENCY} */ (r.urgency)] ?? r.urgency,
  created_at: when(r.created_at),
  updated_at: when(r.updated_at),
  closing_note: r.closing_note ?? '—',
  description: r.description || '—',
});

async function loadCategories() {
  const { items } = await api.call('listCategories', { query: { active: false } });
  categories.clear();
  for (const c of items) categories.set(c.code, c.label);
  return items;
}

async function viewList() {
  const section = clone('tpl-list');
  main.replaceChildren(section);
  showRoles(section);
  const filters = /** @type {HTMLFormElement} */ (section.querySelector('#filters'));
  const rows = /** @type {HTMLElement} */ (section.querySelector('#rows'));
  const more = /** @type {HTMLButtonElement} */ (section.querySelector('#more'));
  const empty = /** @type {HTMLElement} */ (section.querySelector('#empty'));
  const state = /** @type {HTMLElement} */ (section.querySelector('[data-state]'));
  addOptions(/** @type {HTMLSelectElement} */ (filters.elements.namedItem('status')), STATUS);
  addOptions(/** @type {HTMLSelectElement} */ (filters.elements.namedItem('category')), categories);
  /** @type {any[]} */ let items = [];
  /** @type {string | null} */ let next = null;

  const query = () => Object.fromEntries(new FormData(filters));
  /** @param {boolean} append */
  async function load(append) {
    try {
      const page = await api.call('listRequests', { query: { ...query(), ...(append && next ? { cursor: next } : {}) } });
      items = append ? [...items, ...page.items] : page.items;
      next = page.next;
      list(rows, items, {
        key: (r) => r.id,
        render: (r) => {
          const tr = clone('tpl-row', shown(r));
          /** @type {HTMLAnchorElement} */ (tr.querySelector('[data-link="detail"]')).href = `#/requests/${encodeURIComponent(r.id)}`;
          badge(/** @type {Element} */ (tr.querySelector('.status-badge')), r.status);
          return tr;
        },
      });
      empty.hidden = items.length > 0;
      more.hidden = next === null;
      if (manages) {
        // Downloads are same-origin links (navigation), never fetch: the server answers Content-Disposition: attachment.
        /** @type {HTMLAnchorElement} */ (section.querySelector('#export')).href = await api.link('exportRequests', { query: query() });
        /** @type {HTMLAnchorElement} */ (section.querySelector('#export-semicolon')).href = await api.link('exportRequests', { query: { ...query(), separator: 'semicolon' } });
      }
      announce(state, '', '');
    } catch (e) { announce(state, 'error', errorMessage(e)); }
  }
  filters.addEventListener('change', () => { void load(false); });
  more.addEventListener('click', () => { void load(true); });
  await load(false);
}

/** @param {Record<string, string>} params */
async function viewDetail(params) {
  /** @type {any} */ let r;
  try { r = await api.call('getRequest', { params }); } catch (e) { message('Request not available', errorMessage(e)); return; }
  const section = clone('tpl-detail', shown(r));
  main.replaceChildren(section);
  document.title = `${r.title} — Maintenance requests`;
  badge(/** @type {Element} */ (section.querySelector('.status-badge')), r.status);
  list(/** @type {Element} */ (section.querySelector('#history')), r.history ?? [], {
    key: (h) => h.at + h.to_status,
    render: (h) => clone('tpl-history', { ...h, to_status: STATUS[/** @type {keyof STATUS} */ (h.to_status)] ?? h.to_status, at: when(h.at) }),
  });

  const state = /** @type {HTMLElement} */ (section.querySelector('#detail-state'));
  const actions = /** @type {HTMLElement} */ (section.querySelector('#actions'));
  const close = /** @type {HTMLFormElement} */ (section.querySelector('#close'));
  const closeActions = /** @type {HTMLElement} */ (section.querySelector('#close-actions'));
  const author = r.requester_id === me.id;
  const allowed = (NEXT[/** @type {keyof NEXT} */ (r.status)] ?? []).filter((s) => (BY_AUTHOR.includes(s) ? author : manages));
  /** @param {HTMLElement} parent @param {string} label @param {string} [status] */
  const button = (parent, label, status) => {
    const b = document.createElement('button');
    b.type = parent === closeActions ? 'submit' : 'button';
    b.textContent = label;
    if (status) b.value = status;
    parent.append(b);
    return b;
  };
  /** @param {object} body @param {string} done */
  async function change(body, done) {
    for (const b of section.querySelectorAll('button')) /** @type {HTMLButtonElement} */ (b).disabled = true;
    announce(state, 'in-progress', 'Saving…');
    try {
      await api.call('updateRequest', { params, body: { version: r.version, ...body } });
      await viewDetail(params);
      announce(/** @type {HTMLElement} */ (main.querySelector('#detail-state')), 'success', done);
    } catch (e) {
      announce(state, 'error', errorMessage(e));
      for (const b of section.querySelectorAll('button')) /** @type {HTMLButtonElement} */ (b).disabled = false;
    }
  }

  await attachment(section, r, params, author);

  if (author && r.status === 'draft') {
    const a = document.createElement('a');
    a.href = `#/requests/${encodeURIComponent(r.id)}/edit`;
    a.textContent = 'Edit draft';
    actions.append(a);
  }
  for (const s of allowed.filter((x) => !WITH_NOTE.includes(x))) {
    button(actions, ACTION[/** @type {keyof ACTION} */ (s)]).addEventListener('click', () => { void change({ status: s }, `${STATUS[/** @type {keyof STATUS} */ (s)]}.`); });
  }
  const withNote = allowed.filter((x) => WITH_NOTE.includes(x));
  if (withNote.length > 0) {
    close.hidden = false;
    for (const s of withNote) button(closeActions, ACTION[/** @type {keyof ACTION} */ (s)], s);
    close.addEventListener('submit', (ev) => {
      ev.preventDefault();
      if (!close.reportValidity()) return;
      const s = /** @type {HTMLButtonElement | null} */ (ev.submitter)?.value ?? '';
      void change({ status: s, note: /** @type {HTMLTextAreaElement} */ (close.elements.namedItem('note')).value.trim() }, `${STATUS[/** @type {keyof STATUS} */ (s)]}.`);
    });
  }
  if (isAdmin) {
    button(actions, 'Delete').addEventListener('click', async () => {
      if (!confirm('Delete this request? It can be restored until its retention delay is over.')) return;
      try {
        await api.call('deleteRequest', { params });
        await router.go('/');
      } catch (e) { announce(state, 'error', errorMessage(e)); }
    });
  }
}

/**
 * The attachment block of the detail screen: download link, upload form and remove button for whoever may use them
 * (api/lib/attachments.js; the server judges again).
 * @param {Element} section @param {any} r @param {Record<string, string>} params @param {boolean} author
 */
async function attachment(section, r, params, author) {
  const el = (/** @type {string} */ id) => /** @type {HTMLElement} */ (section.querySelector(`#${id}`));
  const state = el('attachment-state');
  const editable = author && ['draft', 'submitted'].includes(r.status);
  const a = r.attachment;
  if (a) {
    el('attachment-none').hidden = true;
    el('attachment-file').hidden = false;
    const link = /** @type {HTMLAnchorElement} */ (el('attachment-link'));
    link.href = await api.link('downloadAttachment', { params });
    link.textContent = `Download ${a.name}`;
    el('attachment-size').textContent = `${Math.max(1, Math.round(a.size / 1024))} KiB`;
    const remove = /** @type {HTMLButtonElement} */ (el('attachment-remove'));
    remove.hidden = !(isAdmin || editable);
    remove.addEventListener('click', async () => {
      if (!confirm('Remove the attachment? It is erased.')) return;
      try {
        await api.call('deleteAttachment', { params });
        await viewDetail(params);
        announce(/** @type {HTMLElement} */ (main.querySelector('#attachment-state')), 'success', 'Attachment removed.');
      } catch (e) { announce(state, 'error', errorMessage(e)); }
    });
  }
  if (!(manages || editable)) return;
  const form = /** @type {HTMLFormElement} */ (el('attachment-form'));
  const input = /** @type {HTMLInputElement} */ (form.elements.namedItem('file'));
  input.accept = (await api.contract()).uploadAttachment?.upload?.types.join(',') ?? '';
  form.hidden = false;
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const file = input.files?.[0];
    if (!file || !form.reportValidity()) return;
    const button = /** @type {HTMLButtonElement} */ (form.querySelector('button'));
    button.disabled = true;
    announce(state, 'in-progress', 'Sending…');
    try {
      await api.upload('uploadAttachment', { params, query: { name: [...file.name].slice(0, 120).join('') }, file });
      await viewDetail(params);
      announce(/** @type {HTMLElement} */ (main.querySelector('#attachment-state')), 'success', 'Attached.');
    } catch (e) {
      announce(state, 'error', errorMessage(e));
      button.disabled = false;
    }
  });
}

/** @param {Record<string, string>} params */
async function viewForm(params) {
  /** @type {any} */ let r = null;
  if (params.id) {
    try { r = await api.call('getRequest', { params }); } catch (e) { message('Request not available', errorMessage(e)); return; }
  }
  const section = clone('tpl-request-form', { heading: r ? 'Edit draft' : 'New request' });
  main.replaceChildren(section);
  const form = /** @type {HTMLFormElement} */ (section.querySelector('form'));
  const field = (/** @type {string} */ name) => /** @type {HTMLInputElement} */ (form.elements.namedItem(name));
  addOptions(/** @type {HTMLSelectElement} */ (field('category')), new Map((await loadCategories()).filter((c) => c.active || c.code === r?.category).map((c) => [c.code, c.label])));
  addOptions(/** @type {HTMLSelectElement} */ (field('urgency')), URGENCY);
  if (r) {
    for (const name of ['title', 'location', 'category', 'urgency', 'description', 'version']) field(name).value = String(r[name] ?? '');
  } else {
    field('urgency').value = 'normal';
    field('version').remove(); // createRequest takes no version
  }
  await bindForm(form, r ? 'updateRequest' : 'createRequest', {
    ...(r ? { params } : {}),
    after: (saved) => router.go(`/requests/${encodeURIComponent(saved.id)}`),
  });
}

async function viewCategories() {
  const section = clone('tpl-categories');
  main.replaceChildren(section);
  const tbody = /** @type {HTMLElement} */ (section.querySelector('#categories'));
  const state = /** @type {HTMLElement} */ (section.querySelector('#categories-state'));
  /** @type {any[]} */ let items = [];
  const row = (/** @type {any} */ c) => ({ ...c, state: c.active ? 'Active' : 'Inactive', toggle: c.active ? 'Deactivate' : 'Activate' });
  async function load() {
    items = await loadCategories();
    list(tbody, items, { key: (c) => c.code, render: (c) => clone('tpl-category', row(c)), update: (el, c) => fill(el, row(c)) });
  }
  tbody.addEventListener('click', async (ev) => {
    const code = /** @type {HTMLElement} */ (ev.target).closest('[data-action="toggle"]')?.closest('[data-key]')?.getAttribute('data-key');
    const c = items.find((x) => x.code === code);
    if (!c) return;
    try {
      await api.call('updateCategory', { params: { code }, body: { active: !c.active, version: c.version } });
      await load();
      announce(state, '', '');
    } catch (e) { announce(state, 'error', errorMessage(e)); }
  });
  await bindForm(/** @type {HTMLFormElement} */ (section.querySelector('form')), 'createCategory', { after: load });
  await load();
}

async function viewDeleted() {
  const section = clone('tpl-deleted');
  main.replaceChildren(section);
  const tbody = /** @type {HTMLElement} */ (section.querySelector('#deleted'));
  const state = /** @type {HTMLElement} */ (section.querySelector('[data-state]'));
  /** @type {any[]} */ let items = [];
  async function load() {
    items = (await api.call('listRequests', { query: { deleted: true, limit: 200 } })).items;
    list(tbody, items, {
      key: (r) => r.id,
      render: (r) => clone('tpl-deleted-row', { ...r, status: STATUS[/** @type {keyof STATUS} */ (r.status)] ?? r.status }),
    });
    /** @type {HTMLElement} */ (section.querySelector('#empty')).hidden = items.length > 0;
  }
  tbody.addEventListener('click', async (ev) => {
    const id = /** @type {HTMLElement} */ (ev.target).closest('[data-action="restore"]')?.closest('[data-key]')?.getAttribute('data-key');
    const r = items.find((x) => x.id === id);
    if (!r) return;
    try {
      await api.call('updateRequest', { params: { id }, body: { restore: true, version: r.version } });
      await load();
      announce(state, 'success', 'Restored.');
    } catch (e) { announce(state, 'error', errorMessage(e)); }
  });
  try { await load(); } catch (e) { announce(state, 'error', errorMessage(e)); }
}

/** Page title and active menu entry, then the view. @param {string} title @param {(p: Record<string, string>) => Promise<void>} view */
const page = (title, view) => async (/** @type {Record<string, string>} */ p, /** @type {string} */ path) => {
  document.title = `${title} — Maintenance requests`;
  for (const a of document.querySelectorAll('[data-nav]')) a.classList.toggle('active', a.getAttribute('data-nav') === path);
  try { await loadCategories(); } catch (e) { message('Not available', errorMessage(e)); return; } // an admin may have just added one
  await view(p);
};
/** @param {(p: Record<string, string>) => Promise<void>} view */
const adminOnly = (view) => (isAdmin ? view : async () => message('Not allowed', 'This page is for administrators.'));

/** @type {HTMLElement} */ (document.getElementById('me-name')).textContent = me.name;
showRoles(document);
/** @type {HTMLElement} */ (document.getElementById('logout')).addEventListener('click', () => api.signOut());

const router = createRouter({
  '/': page('Requests', viewList),
  '/requests/new': page('New request', viewForm),
  '/requests/:id': page('Request', viewDetail),
  '/requests/:id/edit': page('Edit draft', viewForm),
  '/categories': page('Categories', adminOnly(viewCategories)),
  '/deleted': page('Deleted requests', adminOnly(viewDeleted)),
  '*': page('Page not found', async () => message('Page not found', 'This address does not exist.')),
});
await router.start();
