// The requester's page (ADR-024). Vanilla JS, no build step: the list of my requests, one
// conversation per cycle in <deep-chat>, the opinions the state allows, a new-request form, FR/EN from one flat
// dictionary per language. Rules: deep-chat is configured by JS properties only (never attributes), messages are plain
// `text` (never the `html` type), every string we insert ourselves goes through `textContent`, every API call carries
// `X-EupaDev: 1` and the session cookie, and a double click sends one request (one Idempotency-Key per button).
const POLL_MS = 10_000;
const main = document.getElementById('main');
/** The dictionary of the current language (`lang/<l>.json`). */
let t = {};
let lang = 'en';

class ApiError extends Error {
  constructor(status, detail) { super(detail); this.status = status; }
}

/** One API call; a JSON body means a POST with its Idempotency-Key. RFC 9457 problems become ApiError(status, detail). */
async function api(method, path, body, key) {
  const headers = { 'X-EupaDev': '1' };
  if (body !== undefined) Object.assign(headers, { 'Content-Type': 'application/json', 'Idempotency-Key': key });
  let res;
  try {
    res = await fetch(path, { method, headers, credentials: 'same-origin', body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, t['error.network']);
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && signedIn) sessionExpired();
  if (!res.ok) throw new ApiError(res.status, res.status === 401 && signedIn ? t['error.session'] : typeof data.detail === 'string' ? data.detail : res.statusText);
  return data;
}
/** Set once the first API call succeeded: a later 401 is an expired session (30 min idle, 8 h at most), not a visitor. */
let signedIn = false;
/** A banner on top of the page, kept as is (the unsent text stays in the chat to be copied), with the sign-in link. */
function sessionExpired() {
  if (document.getElementById('expired')) return;
  main.prepend(el('p', { id: 'expired', class: 'error', role: 'alert' }, [
    `${t['error.session']} `,
    el('a', { href: `/auth/login?next=${encodeURIComponent(location.pathname)}&lang=${lang}`, text: t['auth.signin'] }),
  ]));
}

// ── Language ──────────────────────────────────────────────────────────────────────────────────────
function pickLang() {
  let saved = null;
  try { saved = localStorage.getItem('lang'); } catch { /* storage unavailable: the browser's language */ }
  if (saved === 'fr' || saved === 'en') return saved;
  return (navigator.language || 'en').toLowerCase().startsWith('fr') ? 'fr' : 'en';
}
async function loadLang(l) {
  t = await (await fetch(`/lang/${l}.json`, { credentials: 'same-origin' })).json();
  lang = l;
  document.documentElement.lang = l;
  document.getElementById('lang').value = l;
  for (const e of document.querySelectorAll('[data-i18n]')) e.textContent = t[e.dataset.i18n] ?? e.dataset.i18n;
}

// ── Small DOM helpers (text only) ─────────────────────────────────────────────────────────────────
function el(tag, attrs = {}, children = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'text') e.textContent = v;
    else if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  e.append(...children);
  return e;
}
const REQUESTER_STATES = new Set(['waiting_scoping_feedback', 'scoping_pause', 'waiting_preview_feedback']);
function stateLabel(state) {
  if (t[`state.${state}`]) return t[`state.${state}`];
  return state.startsWith('gate_') ? t['state.gate'] : t['state.working'];
}
function badge(state) {
  const kind = REQUESTER_STATES.has(state) ? ' you' : state.startsWith('end_') ? ' done' : state.startsWith('gate_') ? ' gate' : '';
  return el('span', { class: `badge${kind}`, text: stateLabel(state) });
}
function showError(container, e) {
  container.querySelector('.error')?.remove();
  container.append(el('p', { class: 'error', role: 'alert', text: e.message }));
}

// ── Views ─────────────────────────────────────────────────────────────────────────────────────────
function viewSignIn() {
  main.replaceChildren(el('section', { class: 'card' }, [
    el('h1', { text: t['app.title'] }),
    el('p', { text: t['auth.signin.text'] }),
    el('a', { class: 'button primary', href: `/auth/login?next=${encodeURIComponent(location.pathname)}&lang=${lang}`, text: t['auth.signin'] }),
  ]));
}

function viewError(e) {
  const text = e.status === 403 ? t['error.forbidden'] : e.status === 404 ? t['error.notFound'] : e.message;
  main.replaceChildren(el('section', { class: 'card' }, [
    el('h1', { text: t['error.title'] }),
    el('p', { role: 'alert', text }),
    el('a', { href: '/', text: t['conv.back'] }),
  ]));
}

/** The signed-in person (`GET /requests`): their hats decide what the page offers (the admin's gates). */
let me = { roles: [] };
const isAdmin = () => me.roles.includes('admin');
/** The left column: "New request", for an admin the requests waiting at a gate, then my requests (the open one marked as the current page). */
function renderSide(requests, currentId) {
  const nav = document.getElementById('requests');
  const link = (r) => el('a', { href: `/cycles/${r.cycle_id}`, ...(r.cycle_id === currentId ? { 'aria-current': 'page' } : {}) }, [
    el('span', { text: r.name }),
    el('span', { class: 'sub', text: stateLabel(r.state) }),
  ]);
  const waiting = isAdmin() ? requests.filter((r) => r.state.startsWith('gate_')) : null;
  const links = requests.map(link);
  nav.replaceChildren(
    el('a', { href: '/', class: 'new', text: t['new.title'], ...(currentId === undefined ? { 'aria-current': 'page' } : {}) }),
    ...(waiting === null ? [] : [el('h2', { text: t['list.waiting'] }), ...(waiting.length > 0 ? waiting.map(link) : [el('p', { class: 'empty', text: t['list.nothingWaiting'] })])]),
    el('h2', { text: t['list.title'] }),
    ...(links.length > 0 ? links : [el('p', { class: 'empty', text: t['list.empty'] })]),
  );
  nav.hidden = false;
}

/** Home, like Claude's: the new-request form in the middle. */
function viewHome() {
  main.replaceChildren(el('section', { class: 'home' }, [el('h1', { text: t['new.title'] }), newRequestForm()]));
}

/** `POST /requests` (type creation). One Idempotency-Key per displayed form: a double submit is one request. */
function newRequestForm() {
  const key = crypto.randomUUID();
  const field = (name, label, input) => {
    Object.assign(input, { name, id: `new-${name}`, required: true });
    return el('label', { for: input.id }, [el('span', { text: t[label] }), input]);
  };
  const name = el('input', { type: 'text', maxlength: '200' });
  const slug = el('input', { type: 'text', maxlength: '63', pattern: '[a-z0-9]+(-[a-z0-9]+)*', autocapitalize: 'off', spellcheck: 'false' });
  const service = el('input', { type: 'text', maxlength: '200' });
  const need = el('textarea', { maxlength: '10000' });
  let slugEdited = false;
  slug.addEventListener('input', () => { slugEdited = true; });
  name.addEventListener('input', () => {
    if (!slugEdited) slug.value = name.value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63).replace(/-+$/, '');
  });
  const submit = el('button', { type: 'submit', class: 'primary', text: t['new.submit'] });
  const form = el('form', { class: 'fields card', novalidate: '' }, [
    field('name', 'new.name', name), field('slug', 'new.slug', slug), field('owner_service', 'new.service', service), field('need', 'new.need', need), el('div', { class: 'row' }, [submit]),
  ]);
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (!form.reportValidity()) return;
    submit.disabled = true;
    submit.textContent = t['new.sending'];
    try {
      const r = await api('POST', '/requests', { type: 'creation', name: name.value.trim(), slug: slug.value.trim(), owner_service: service.value.trim(), need: need.value.trim() }, key);
      location.assign(`/cycles/${r.cycle_id}`);
    } catch (e) {
      showError(form, e);
      submit.disabled = false;
      submit.textContent = t['new.submit'];
    }
  });
  return form;
}

/** What a text typed in the chat means in this state (the only states where the engine accepts one). */
const TYPED = {
  waiting_scoping_feedback: (text) => ({ type: 'scoping_feedback', outcome: 'correction', text }),
  scoping_pause: (text) => ({ type: 'requester_message', text }),
  waiting_preview_feedback: (text) => ({ type: 'preview_feedback', outcome: 'bug', text }),
};
/**
 * The requester just talks: a short acceptance ("ok", "c'est bon"… the whole message, nothing else) is confirmed before
 * it is sent as `satisfied`; at the Preview, anything else is a bug or a new capability, which the page asks first.
 */
const ACCEPT = /^(ok|okay|yes|oui|accepted|approved?|looks good|lgtm|satisfied|c['’]est bon|d['’]accord|valid[eé]|validée|parfait|perfect|good|fine|great)[\s!.]*$/i;
const FEEDBACK = {
  waiting_scoping_feedback: { type: 'scoping_feedback', ok: 'btn.scoping.ok' },
  waiting_preview_feedback: { type: 'preview_feedback', ok: 'btn.preview.ok', kinds: [['btn.preview.bug', 'bug'], ['btn.preview.capability', 'new_capability']] },
};
/** States where the requester may still abandon (after the merge only the admin cancels). */
const ABANDON = new Set(['waiting_scoping_feedback', 'scoping_pause']);
/** Gate decisions in plain words; `decision.<gate>.<outcome>` wins over `decision.<outcome>` (the incident's "retry"). */
const decisionLabel = (gate, outcome) => t[`decision.${gate}.${outcome}`] ?? t[`decision.${outcome}`] ?? outcome;
const NEEDS_COMMENT = new Set(['correction', 'scope_change', 'refused']);
/** A new answer appears a few words at a time (instant for my own messages, or when the viewer asks for reduced motion). */
async function typeIn(chat, msg) {
  const words = msg.text.split(/(?<=\s)/);
  if (msg.role === 'user' || words.length < 2 || matchMedia('(prefers-reduced-motion: reduce)').matches) return chat.addMessage(msg);
  chat.addMessage({ ...msg, text: words[0] });
  const index = chat.getMessages().length - 1;
  for (let i = 1; i < words.length; i += 2) {
    await new Promise((r) => setTimeout(r, 30));
    chat.updateMessage({ text: words.slice(0, i + 2).join('') }, index);
  }
}
const toMessage = (m) => ({ role: m.author_type === 'requester' ? 'user' : m.author_type, text: m.content });

async function viewConversation(id) {
  let state = await api('GET', `/requests/${id}`);
  const { messages } = await api('GET', `/requests/${id}/messages`);
  let lastId = messages.at(-1)?.id ?? 0;
  /** Texts sent from this page: deep-chat shows them at once, so their row is skipped once when the poll returns it. */
  const sent = new Set();

  await customElements.whenDefined('deep-chat');
  const chat = document.createElement('deep-chat');
  chat.chatStyle = { width: '100%', height: '100%', border: 'none', backgroundColor: 'var(--bg)', fontFamily: 'inherit', fontSize: '1rem' };
  // iMessage-like bubbles: mine on the right, the others on the left, a small corner on the speaker's side.
  const theirs = { backgroundColor: 'var(--theirs)', color: 'var(--theirs-text)', borderRadius: '18px 18px 18px 4px' };
  chat.messageStyles = {
    default: {
      shared: { bubble: { maxWidth: '75%', lineHeight: '1.45', padding: '0.5rem 0.85rem' } },
      user: { bubble: { backgroundColor: 'var(--mine)', color: 'var(--mine-text)', borderRadius: '18px 18px 4px 18px' } },
      agent: { bubble: theirs },
      admin: { bubble: theirs },
      orchestrator: { bubble: { ...theirs, fontSize: '0.92rem' } },
    },
    error: { bubble: { backgroundColor: 'transparent', color: 'var(--danger)', border: '1px solid var(--danger)' } },
  };
  chat.textInput = {
    characterLimit: 10_000,
    placeholder: { text: placeholder() },
    styles: { container: { backgroundColor: 'var(--surface)', border: '1px solid var(--border)', boxShadow: '0 2px 8px rgba(0, 0, 0, 0.06)', borderRadius: '18px', color: 'var(--text)', width: '100%', minHeight: '3.2rem' }, text: { color: 'var(--text)', padding: '0.85rem 3rem 0.85rem 1rem' } },
  };
  chat.submitButtonStyles = { submit: { svg: { styles: { default: { filter: 'none' } } } } };
  chat.remarkable = { html: false, breaks: true, linkTarget: '_blank' };
  chat.errorMessages = { displayServiceErrorMessages: true, overrides: { default: t['error.title'] } };
  // deep-chat's a11y is weak: its submit button has no name, its input no label — given here, in its open shadow root.
  // Its methods (placeholder, submit button) only act once rendered: the first state is applied here, the next ones by the poll.
  chat.onComponentRender = (ref) => {
    ref.shadowRoot?.querySelector('.input-button')?.setAttribute('aria-label', t['chat.send']);
    ref.shadowRoot?.querySelector('#text-input')?.setAttribute('aria-label', t['chat.input']);
    applyInput();
  };
  chat.history = messages.map(toMessage);
  chat.connect = {
    handler: async (body, signals) => {
      const text = (body?.messages?.[0]?.text ?? '').trim();
      const typed = TYPED[state.state];
      if (text === '' || typed === undefined) return signals.onResponse({ error: t['conv.noInput'] });
      const fb = FEEDBACK[state.state];
      const kinds = fb?.kinds?.map(([label, outcome]) => [label, { type: fb.type, outcome, text }]);
      if (fb && ACCEPT.test(text)) {
        ask('conv.askAccept', [[fb.ok, { type: fb.type, outcome: 'satisfied' }, 'primary'], ['conv.notAccept', kinds ? () => ask('conv.askKind', kinds) : typed(text)]]);
        return signals.onResponse({ text: t['conv.askAccept'], role: 'orchestrator' });
      }
      if (kinds) {
        ask('conv.askKind', kinds);
        return signals.onResponse({ text: t['conv.askKind'], role: 'orchestrator' });
      }
      try {
        await post(typed(text));
        await signals.onResponse({ text: t['conv.sent'], role: 'orchestrator' });
      } catch (e) {
        await signals.onResponse({ error: e.message });
      }
    },
  };
  /** `POST /messages` (one Idempotency-Key per call site), the text remembered for the poll, then the state refreshed. */
  async function post(message, key = crypto.randomUUID()) {
    await api('POST', '/messages', { cycle_id: id, message }, key);
    if (message.text) sent.add(message.text);
    await poll();
  }

  const badgeSlot = el('span');
  const opinions = el('div', { class: 'opinions' });
  main.replaceChildren(
    el('div', { class: 'conv-head' }, [el('h1', { text: `${state.name} ` }, [el('span', { class: 'slug', text: state.slug })]), badgeSlot]),
    chat,
    opinions,
  );

  function placeholder() {
    if (state.state.startsWith('end_')) return t['conv.placeholder.closed'];
    return t[`conv.placeholder.${state.state}`] ?? t['conv.placeholder.wait'];
  }
  function applyInput() {
    chat.setPlaceholderText(placeholder());
    chat.disableSubmitButton(TYPED[state.state] === undefined);
  }
  function renderState() {
    Object.assign(main.dataset, { state: state.state, visit: state.visit });
    badgeSlot.replaceChildren(badge(state.state));
    applyInput();
    renderOpinions();
  }
  /**
   * Buttons that send one message each (one Idempotency-Key per button), all disabled while one is in flight. An option
   * is `[label key, message or () => message | undefined, class]`: a function builds the message on click, or asks
   * something else first and returns nothing.
   */
  function senders(container, options) {
    const buttons = options.map(([label, action, kind]) => {
      const key = crypto.randomUUID();
      const b = el('button', { type: 'button', class: kind ?? '', text: t[label] ?? label });
      b.addEventListener('click', async () => {
        const message = typeof action === 'function' ? action() : action;
        if (message === undefined) return;
        for (const x of buttons) x.disabled = true;
        try {
          await post(message, key);
          chat.addMessage({ text: t['conv.sent'], role: 'orchestrator' });
          if (container.classList.contains('ask')) container.remove();
        } catch (e) {
          showError(container, e);
          for (const x of buttons) x.disabled = false;
        }
      });
      return b;
    });
    return buttons;
  }
  /** A question above the input (the chat shows it too) with its answers; replaced by the next state or question. */
  function ask(question, options) {
    const box = el('div', { class: 'ask', role: 'group', 'aria-label': t[question] });
    box.append(el('div', { class: 'row' }, senders(box, options)));
    renderOpinions(box);
  }
  function renderOpinions(pending) {
    opinions.replaceChildren();
    if (pending) opinions.append(pending);
    else if (isAdmin() && state.possible_decisions.length > 0) opinions.append(decisionCard());
    if (ABANDON.has(state.state)) opinions.append(el('button', { type: 'button', class: 'ghost abandon', text: t['btn.abandon'], onclick: async () => {
      if (!confirm(t['conv.confirmAbandon'])) return;
      try { await post({ type: 'requester_abandonment' }, abandonKey); } catch (e) { showError(opinions, e); }
    } }));
  }
  const abandonKey = crypto.randomUUID();
  /**
   * The admin's decision at a gate: the gate in plain words, the engine's reason, at Gate 2 the candidate digest (the
   * full one is cited in the decision), a comment (required to correct, change the scope or refuse; at Gate 1 the
   * approval's comment becomes the tool's catalogue description), one button per possible decision.
   */
  function decisionCard() {
    const gate = state.state;
    const comment = el('textarea', { id: 'decision-comment', maxlength: '10000', rows: '2' });
    const card = el('section', { class: 'card decision', 'aria-label': t['gate.title'] }, [
      el('h2', { text: t[`gate.${gate}`] ?? t['state.gate'] }),
      ...(state.gate_reason ? [el('p', { class: 'reason', text: state.gate_reason })] : []),
      ...(gate === 'gate_2' && state.candidate_digest ? [el('p', { text: `${t['gate.digest']} ` }, [el('code', { text: state.candidate_digest.slice(0, 12), title: state.candidate_digest })])] : []),
      el('label', { for: comment.id }, [el('span', { text: t[gate === 'gate_1' ? 'gate.comment.gate_1' : 'gate.comment'] }), comment]),
    ]);
    const decide = (outcome) => () => {
      const c = comment.value.trim();
      if (c === '' && NEEDS_COMMENT.has(outcome)) {
        showError(card, new Error(t['gate.commentRequired']));
        comment.focus();
        return undefined;
      }
      const digest = gate === 'gate_2' && outcome === 'approved' && state.candidate_digest ? { digest: state.candidate_digest } : {};
      return { type: 'decision', gate, outcome, ...(c === '' ? {} : { comment: c }), ...digest };
    };
    const options = state.possible_decisions.map((outcome) => [decisionLabel(gate, outcome), decide(outcome), outcome === 'approved' ? 'primary' : outcome === 'refused' ? 'danger' : '']);
    card.append(el('div', { class: 'row' }, senders(card, options)));
    return card;
  }
  /** New rows since the last id (the engine's answers, the agents' questions) and the state, every POLL_MS. */
  let polling = false;
  async function poll() {
    if (polling) return;
    polling = true;
    try {
      const page = await api('GET', `/requests/${id}/messages?since=${lastId}`);
      for (const m of page.messages) {
        lastId = m.id;
        if (m.author_type === 'requester' && sent.delete(m.content)) continue;
        await typeIn(chat, toMessage(m));
      }
      const fresh = await api('GET', `/requests/${id}`);
      if (fresh.state !== state.state || fresh.visit !== state.visit) {
        state = fresh;
        renderState();
        renderSide((await api('GET', '/requests')).requests, id);
      }
    } catch { /* the next poll will try again */ } finally { polling = false; }
  }
  renderState();
  setInterval(poll, POLL_MS);
}

// ── Theme: auto (the system's), light or dark; remembered like the language ─────────────────────
function applyTheme(v) {
  if (v === 'light' || v === 'dark') document.documentElement.dataset.theme = v;
  else delete document.documentElement.dataset.theme;
}

async function start() {
  let theme = 'auto';
  try { theme = localStorage.getItem('theme') ?? 'auto'; } catch { /* storage unavailable: the system's theme */ }
  applyTheme(theme);
  await loadLang(pickLang());
  const themeSelect = document.getElementById('theme');
  themeSelect.value = ['light', 'dark'].includes(theme) ? theme : 'auto';
  themeSelect.addEventListener('change', (ev) => {
    applyTheme(ev.target.value);
    try { localStorage.setItem('theme', ev.target.value); } catch { /* not remembered, applied for this page */ }
  });
  document.getElementById('lang').addEventListener('change', (ev) => {
    try { localStorage.setItem('lang', ev.target.value); } catch { /* not remembered, applied once */ }
    location.reload();
  });
  const m = /^\/cycles\/([1-9][0-9]*)$/.exec(location.pathname);
  try {
    const { me: who, requests } = await api('GET', '/requests');
    me = who;
    signedIn = true;
    document.getElementById('account').replaceChildren(me.name, el('span', { class: 'roles', text: ` · ${me.roles.map((r) => t[`hat.${r}`] ?? r).join(', ')}` }));
    renderSide(requests, m ? Number(m[1]) : undefined);
    if (m) await viewConversation(Number(m[1]));
    else viewHome();
    document.getElementById('logout').hidden = false;
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) viewSignIn();
    else viewError(e instanceof ApiError ? e : new ApiError(0, String(e?.message ?? e)));
  }
}
start();
