/**
 * Local API of the engine (ROADMAP §8.16 M8): `node:http`, no extra dependency, bound to 127.0.0.1 by default; the
 * admin calls it through an SSH tunnel (`scripts/eupadev.py`), until the gate pages exist.
 *
 * Guard-rails, in order:
 * 1. `Host`: only localhost, 127.0.0.1 or [::1] (any port) and the name of `DASHBOARD_URL` (the page, chat
 *    step 5) — otherwise 421; a web page that points its own name at 127.0.0.1 (DNS rebinding) does not reach the API.
 * 2. Header `X-EupaDev: 1` required — otherwise 403; a browser cannot send it without a preflight request (CORS),
 *    to which nothing answers favourably.
 * 3. I0 (ADR-017): `Authorization: Bearer <Keycloak access token>` required on everything except `GET /health` (the
 *    container's health check) — missing or refused: 401 + `WWW-Authenticate`; the person is resolved into an actor by
 *    `(issuer, subject)`; missing hat or authorisation rule: 403. The identity NEVER comes from the body.
 * 4. POST: `Content-Type: application/json`, body ≤ 64 KiB, strictly validated (Ajv, unknown properties refused),
 *    `Idempotency-Key` required, used with the actor as the id of the DBOS workflow (`Orchestrator.requestByKey`):
 *    a replay returns the same result, with no duplicate.
 * 5. `POST /actors/merges` (hat `admin`, migration 0010): "actor B is the same person as A"; `decided_by` is the
 *    token's actor, never the body. Idempotent by its natural key (an actor is absorbed only once): the same merge
 *    replayed → 200 with the existing row; other target, self-merge, cycle, machine, own identity → 409.
 * 6. Reads: `GET /requests/<cycle>` and `GET /requests/<cycle>/messages?since=<id>`
 *    only for the tool's requester or an admin (`hatOnTool`, the same rule as opinions) — 404 if the cycle does not
 *    exist, 403 otherwise, like `POST /messages`; `GET /requests`: one's own requests, all of them for an admin.
 * 7. Browser sign-in (ADR-024, `web-session.ts`): `GET /auth/login` → Keycloak (code + PKCE, client
 *    `eupadev-web`), `GET /auth/callback` → `__Host-session` cookie, `POST /auth/logout` → session deleted, cookie
 *    cleared, Keycloak's end-session page. The cookie authenticates like a Bearer (same `Actor`, same hats; a Bearer
 *    wins when both are sent); an unknown or expired cookie is 401 and cleared. Only these three browser navigations
 *    are exempt from `X-EupaDev: 1`: every API call made with the cookie still needs it (the CSRF control stays), and
 *    a cross-site form cannot reach `/auth/logout` with the cookie (SameSite=Lax). Without `OIDC_WEB_CLIENT_ID`: 503 on
 *    `/auth/*`, the rest of the API unchanged.
 * 8. The requester's page (ADR-024, `static.ts`): `GET /`, `/cycles/<id>`, `/app.js`, `/app.css`,
 *    `/lang/*.json` and the vendored deep-chat bundle are served from a fixed table before the header check (a browser
 *    navigation cannot send `X-EupaDev`), with the page's own CSP; the page then calls the API above with the cookie.
 * 9. `POST /requests/<cycle>/intent` (ADR-031, `intent.ts`): what a typed sentence means among the actions the state
 *    allows for the person's hat, or `unclear`, and whether it needs a click (paid or irreversible); same readers as the cycle (requester or admin),
 *    the sentence checked like a message text, at most `INTENT_RATE.calls` sentences a minute per person (429 +
 *    `Retry-After`). It never posts anything: the page sends the message itself through `POST /messages`.
 * Every error is returned in the RFC 9457 format (`application/problem+json`).
 */
import http from 'node:http';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { Authenticator, TokenRefused, bearerToken } from './auth.ts';
import { STATES, gateOutcomes, type StateId } from './machine/states.ts';
import { DIGEST_FORMAT, UUID_FORMAT, MAX_TOP_UP_USD, SLUG_FORMAT, SLUG_MAX_LENGTH, type Message } from './messages.ts';
import { IdempotencyConflict, AuthorizationError, type Actor, type ToolRequest, hatOnTool, type Orchestrator } from './orchestrator.ts';
import { cycleWorkflowId } from './workflows/deps.ts';
import { clearCookie, cookies, LOGIN_COOKIE, SESSION_COOKIE, SESSION_MAX_MS, setCookie, SignInRefused, WebSignIn } from './web-session.ts';
import { buildStatic, cspPage, staticFile, serveStatic, type StaticFile } from './static.ts';
import { allowedIntents, INTENT_RATE, needsClick, RateLimiter, replyOf, revalidate, UNCLEAR, wordsReader, type Intent, type IntentReader } from './intent.ts';
import { invisibleCharacter } from './text.ts';
import { DBOS } from '@dbos-inc/dbos-sdk';

const HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const MAX_BODY = 64 * 1024;
const KEY = /^"?([A-Za-z0-9._~:-]{1,200})"?$/;
const GATES = new Set<string>(STATES.filter((e) => e.kind === 'gate').map((e) => e.id));

const text = { type: 'string', minLength: 1, maxLength: 10_000, pattern: '\\S' } as const;
const court = { type: 'string', minLength: 1, maxLength: 200, pattern: '\\S' } as const;
const slug = { type: 'string', pattern: SLUG_FORMAT.source, maxLength: SLUG_MAX_LENGTH } as const;
const object = (required: string[], properties: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, required: required, properties: properties });

/**
 * Body of `POST /requests` (the content is checked again by `validateRequest`). The requester = the authenticated person.
 * `need` (required, for a creation as for an evolution): what they want, first message of the cycle's chat (read by scoping).
 */
export const REQUEST_SCHEMA = {
  type: 'object', required: ['type'], properties: { type: { enum: ['creation', 'evolution'] } }, discriminator: { propertyName: 'type' },
  oneOf: [
    object(['type', 'name', 'slug', 'owner_service', 'need'], {
      type: { const: 'creation' }, name: court, slug: slug, owner_service: court, need: text,
    }),
    object(['type', 'tool_id', 'need'], { type: { const: 'evolution' }, tool_id: { type: 'integer', minimum: 1 }, need: text }),
  ],
};

/**
 * Body of `POST /messages`: only the humans' messages (feedback, decisions, cancellation), WITHOUT identity (it comes
 * from the token: `actor_id`, `hat`, `four_eyes_exemption` and `visit` are set by the server, refused from the
 * client). The forge's signals (`ci_finished`, `preview_pipeline_finished`) never come in through the API: nobody can
 * declare a green CI there.
 */
export const MESSAGE_SCHEMA = object(['cycle_id', 'message'], {
  cycle_id: { type: 'integer', minimum: 1 },
  message: {
    type: 'object', required: ['type'], discriminator: { propertyName: 'type' },
    properties: { type: { enum: ['scoping_feedback', 'preview_feedback', 'requester_abandonment', 'requester_message', 'decision', 'cancellation'] } },
    oneOf: [
      object(['type', 'outcome'], { type: { const: 'scoping_feedback' }, outcome: { enum: ['satisfied', 'correction'] }, text: text }),
      object(['type', 'outcome'], { type: { const: 'preview_feedback' }, outcome: { enum: ['satisfied', 'bug', 'new_capability'] }, text: text }),
      object(['type'], { type: { const: 'requester_abandonment' } }),
      object(['type', 'text'], { type: { const: 'requester_message' }, text: text }),
      object(['type', 'gate', 'outcome'], {
        type: { const: 'decision' }, gate: { enum: [...GATES] }, outcome: { enum: ['approved', 'correction', 'refused', 'scope_change'] },
        comment: text, budget_top_up_usd: { type: 'number', exclusiveMinimum: 0, maximum: MAX_TOP_UP_USD }, digest: { type: 'string', pattern: DIGEST_FORMAT.source },
        // Rename at Gate 1 (correction): checked again by `validateMessage` (gate and outcome) and by `send` (slug free).
        name: court, slug: slug,
      }),
      object(['type'], { type: { const: 'cancellation' } }),
    ],
  },
});

/** Body of `POST /actors/merges`: the absorbed actor, its target and the reason; the deciding admin comes from the token. */
const uuid = { type: 'string', pattern: UUID_FORMAT.source } as const;
export const MERGE_SCHEMA = object(['absorbed_actor', 'target_actor', 'reason'], { absorbed_actor: uuid, target_actor: uuid, reason: text });

/**
 * Body of `POST /requests/<cycle>/intent` (ADR-031): the sentence as typed, the page's language and, when the page is
 * showing a question, its key. The hat and the state come from the server, never from the body.
 */
export const INTENT_SCHEMA = object(['text', 'lang'], { text: text, lang: { enum: ['fr', 'en'] }, pending_question: court });

type ReceivedMessage = Omit<Extract<Message, { actor_id: string }>, 'actor_id' | 'hat' | 'four_eyes_exemption' | 'visit'>;
const ajv = new Ajv2020({ allErrors: true, strict: true, discriminator: true });
const validateRequest = ajv.compile<ToolRequest>(REQUEST_SCHEMA);
const validateMessage = ajv.compile<{ cycle_id: number; message: ReceivedMessage }>(MESSAGE_SCHEMA);
const validateMerge = ajv.compile<{ absorbed_actor: string; target_actor: string; reason: string }>(MERGE_SCHEMA);
const validateIntent = ajv.compile<{ text: string; lang: 'fr' | 'en'; pending_question?: string }>(INTENT_SCHEMA);

class Problem extends Error {
  readonly status: number;
  readonly extra: Record<string, unknown>;
  /** Response headers that do not belong in the problem body (`Set-Cookie`). */
  readonly headers: http.OutgoingHttpHeaders;
  constructor(status: number, detail: string, extra: Record<string, unknown> = {}, headers: http.OutgoingHttpHeaders = {}) {
    super(detail);
    this.status = status;
    this.extra = extra;
    this.headers = headers;
  }
}

function respond(res: http.ServerResponse, status: number, body: unknown, headers: http.OutgoingHttpHeaders = {}): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
  res.end(JSON.stringify(body));
}

/** Browser navigation (sign-in flow): a redirect with no body, never cached. */
function redirect(res: http.ServerResponse, location: string, headers: http.OutgoingHttpHeaders = {}): void {
  res.writeHead(303, { Location: location, 'Cache-Control': 'no-store', ...headers });
  res.end();
}

function problem(res: http.ServerResponse, p: Problem, headers: http.OutgoingHttpHeaders = {}): void {
  respond(res, p.status, { type: 'about:blank', title: http.STATUS_CODES[p.status] ?? 'Error', status: p.status, detail: p.message, ...p.extra }, { ...headers, 'Content-Type': 'application/problem+json; charset=utf-8' });
}

async function readJson(req: http.IncomingMessage): Promise<unknown> {
  if (!/^application\/json\s*(;|$)/i.test(req.headers['content-type'] ?? '')) throw new Problem(415, 'Content-Type: application/json expected');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const m of req) {
    size += (m as Buffer).length;
    if (size > MAX_BODY) throw new Problem(413, `body limited to ${MAX_BODY} bytes`);
    chunks.push(m as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Problem(400, 'body: invalid JSON');
  }
}

function validate<T>(validator: { (x: unknown): x is T; errors?: { instancePath: string; message?: string }[] | null }, body: unknown): T {
  if (validator(body)) return body;
  const errors = (validator.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message ?? ''}`.trim());
  throw new Problem(400, `invalid body: ${errors.join('; ')}`, { errors: errors });
}

function idempotencyKey(req: http.IncomingMessage): string {
  const brute = req.headers['idempotency-key'];
  const m = typeof brute === 'string' ? KEY.exec(brute.trim()) : null;
  if (m === null) throw new Problem(400, 'Idempotency-Key header required (1 to 200 characters among A-Z a-z 0-9 . _ ~ : -)');
  return m[1]!;
}

/** Engine error (business refusal, incompatible state): 403 authorisation, 404 if the cycle does not exist, 409 otherwise; the exact text is returned. */
function refusal(e: unknown): Problem {
  if (e instanceof Problem) return e;
  const detail = e instanceof Error ? e.message : String(e);
  if (e instanceof IdempotencyConflict) return new Problem(422, detail);
  // The error may have gone through DBOS (workflow `apiMessage`, serialize-error): the class is lost, the name remains.
  if (e instanceof AuthorizationError || (e instanceof Error && e.name === 'AuthorizationError')) return new Problem(403, detail);
  return new Problem(/^unknown cycle \d+$/.test(detail) ? 404 : 409, detail);
}

const WWW_AUTHENTICATE = 'WWW-Authenticate';
/** Verified access token → principal (401 otherwise): the CLI's Bearer, and the token Keycloak hands the web sign-in. */
async function principalFromToken(auth: Authenticator, token: string) {
  try {
    return await auth.verifier(token);
  } catch (e) {
    if (!(e instanceof TokenRefused)) throw e;
    throw new Problem(401, `access token refused: ${e.message}`, { [WWW_AUTHENTICATE]: 'Bearer realm="eupadev-api", error="invalid_token"' });
  }
}
/** Missing hat = 403, whatever the authentication path. */
function actorWithHat(actor: Actor): Actor {
  if (actor.roles.length === 0) throw new Problem(403, 'no EupaDev hat (requester or admin roles of the eupadev-api client) in the token');
  return actor;
}
/**
 * I0: the person behind the request, resolved from their access token (Bearer, the CLI) or their web session (cookie
 * `__Host-session`, the page) — the same actor by the same key `(issuer, subject)`; 401 otherwise; no hat = 403.
 */
async function authenticate(orch: Orchestrator, auth: Authenticator, req: http.IncomingMessage): Promise<Actor> {
  const token = bearerToken(req.headers.authorization);
  if (token !== null) {
    const principal = await principalFromToken(auth, token);
    return actorWithHat({ id: await orch.base.resolveActor(principal), roles: principal.roles });
  }
  const cookie = cookies(req)[SESSION_COOKIE];
  if (cookie !== undefined) {
    const session = await orch.base.readSession(cookie);
    if (session === null) throw new Problem(401, 'session unknown or expired: sign in again at /auth/login', {}, { 'Set-Cookie': clearCookie(SESSION_COOKIE) });
    return actorWithHat({ id: session.actorId, roles: session.roles });
  }
  throw new Problem(401, 'access token required (Authorization: Bearer <token>)', { [WWW_AUTHENTICATE]: 'Bearer realm="eupadev-api"' });
}

/** `/auth/*`: the sign-in flow, served only when the web client is configured (503 otherwise, fail closed). */
async function handleAuth(orch: Orchestrator, auth: Authenticator, web: WebSignIn | null, req: http.IncomingMessage, res: http.ServerResponse, url: URL, route: (...m: string[]) => void): Promise<void> {
  if (web === null) throw new Problem(503, 'web sign-in is not configured (OIDC_WEB_CLIENT_ID, OIDC_WEB_CLIENT_SECRET, OIDC_WEB_REDIRECT_URL)');
  const cookie = cookies(req);
  if (url.pathname === '/auth/login') {
    route('GET');
    // Chat step 5: the page's language follows to Keycloak's login page (`ui_locales`); fr or en only, anything else ignored.
    const lang = url.searchParams.get('lang');
    const { location, cookie: transaction } = await web.start(url.searchParams.get('next') ?? '/', lang === 'fr' || lang === 'en' ? lang : undefined);
    return redirect(res, location, { 'Set-Cookie': transaction });
  }
  if (url.pathname === '/auth/callback') {
    route('GET');
    let end;
    try {
      end = await web.finish(cookie[LOGIN_COOKIE], url.searchParams);
    } catch (e) {
      if (!(e instanceof SignInRefused)) throw e;
      throw new Problem(400, e.message, {}, { 'Set-Cookie': clearCookie(LOGIN_COOKIE) });
    }
    // The token Keycloak issued to the web client is checked like a CLI token: same issuer, audience and hats (ADR-017).
    const principal = await principalFromToken(auth, end.accessToken);
    const actor = actorWithHat({ id: await orch.base.resolveActor(principal), roles: principal.roles });
    // ASVS 7.2.4: a different session identifier before and after sign-in.
    await orch.base.destroySession(cookie[SESSION_COOKIE]);
    const token = await orch.base.createSession(actor.id, actor.roles);
    return redirect(res, end.returnPath, { 'Set-Cookie': [setCookie(SESSION_COOKIE, token, SESSION_MAX_MS / 1000), clearCookie(LOGIN_COOKIE)] });
  }
  if (url.pathname === '/auth/logout') {
    route('POST');
    await orch.base.destroySession(cookie[SESSION_COOKIE]);
    return redirect(res, web.endSessionUrl(), { 'Set-Cookie': clearCookie(SESSION_COOKIE) });
  }
  throw new Problem(404, `${url.pathname}: unknown route (GET /auth/login, GET /auth/callback, POST /auth/logout)`);
}

/** Loopback names plus the page's own name (`DASHBOARD_URL`, chat step 5); nothing else, ever. */
function acceptedHosts(dashboardUrl: string): Set<string> {
  const hosts = new Set(HOSTS);
  if (URL.canParse(dashboardUrl)) hosts.add(new URL(dashboardUrl).hostname.toLowerCase());
  return hosts;
}

function expectedHost(host: string | undefined, hosts: Set<string>): boolean {
  if (host === undefined) return false;
  const name = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0]!;
  return hosts.has(name.toLowerCase());
}

/** The cycle, if it exists (404 otherwise) and `actor` may read it: the tool's requester or an admin (403 otherwise, same rule as opinions). */
async function readableCycle(orch: Orchestrator, id: number, actor: Actor) {
  const c = await orch.base.readCycle(id);
  hatOnTool(c, actor.id, actor.roles, `reading cycle ${id}`);
  return c;
}

async function requestState(orch: Orchestrator, id: number, actor: Actor): Promise<Record<string, unknown>> {
  const c = await readableCycle(orch, id, actor);
  const memory = await orch.base.readMemory(id);
  const w1 = await DBOS.getWorkflowStatus(cycleWorkflowId(id));
  return {
    cycle_id: c.id, tool_id: c.tool_id, slug: c.slug, name: c.name, type: c.type, state: c.state, visit: c.visit,
    finished_at: c.finished_at, gate_reason: memory.gateReason || null, candidate_digest: await orch.base.candidateDigest(id),
    possible_decisions: GATES.has(c.state) ? [...gateOutcomes(c.state as StateId)] : [], workflow: w1?.status ?? null,
    // D-E5: at Gate 1, the names the admin needs for the tool's core-tools.yml entry (the page builds the entry).
    registration: c.state === 'gate_1' ? memory.registration : null,
  };
}

/**
 * ADR-031 (S1): what the person means by a typed sentence, among the actions the cycle's state allows for their hat —
 * never a decision: the page then posts the message itself (`POST /messages`), under the same checks as a click. The
 * reader is not called when nothing is expected from this hat (empty set); its answer is re-validated whatever it is;
 * a reader that fails yields `unclear` with `fallback: true` (the page goes back to the word lists and buttons; the
 * admin's notification comes with the model reader, S3). Every sentence is recorded in `intents`, its reading too.
 * `needs_click`: the intent is paid or irreversible, the page asks for one "Approve" click before posting it. `reply`:
 * the reader's own words when it has some (`replyOf`, capped), shown by the page as plain text next to its own line.
 */
async function readIntent(orch: Orchestrator, reader: IntentReader, limiter: RateLimiter, id: number, actor: Actor, body: { text: string; lang: 'fr' | 'en'; pending_question?: string }): Promise<Record<string, unknown>> {
  const wait = limiter.take(actor.id);
  if (wait > 0) throw new Problem(429, `intent: at most ${INTENT_RATE.calls} sentences a minute per person`, {}, { 'Retry-After': String(Math.ceil(wait / 1000)) });
  const invisible = invisibleCharacter(body.text);
  if (invisible !== null) throw new Problem(400, `text: invisible character refused (${invisible})`);
  const c = await readableCycle(orch, id, actor);
  const hat = hatOnTool(c, actor.id, actor.roles, `intent on cycle ${id}`);
  const allowed = allowedIntents(c.state, hat);
  const started = Date.now();
  let answer: Intent = UNCLEAR;
  let tokens: { input: number; output: number } | null = null;
  let fallback = false;
  let reply: string | undefined;
  if (allowed.size > 0) {
    try {
      const reading = await reader.read({ hat, state: c.state, allowed, lang: body.lang, text: body.text, ...(body.pending_question === undefined ? {} : { pendingQuestion: body.pending_question }) });
      answer = revalidate(reading, allowed, c.state);
      tokens = reading.tokens ?? null;
      reply = replyOf(reading);
    } catch (e) {
      DBOS.logger.warn(`cycle ${c.id}: intent reader ${reader.id} failed, fallback (${e instanceof Error ? e.message : String(e)})`);
      fallback = true;
    }
  }
  const needs_click = answer.intent !== 'unclear' && needsClick(answer.intent, c.state);
  await orch.base.writeIntent({
    cycle: c, actorId: actor.id, hat, allowed: [...allowed], text: body.text, lang: body.lang, pendingQuestion: body.pending_question ?? null,
    intent: answer.intent, amountUsd: answer.amount_usd ?? null, reader: reader.id, tokens, latencyMs: Date.now() - started, fallback,
  });
  return { cycle_id: c.id, state: c.state, hat, allowed: [...allowed], ...answer, needs_click, fallback, ...(reply === undefined ? {} : { reply }) };
}

async function handle(orch: Orchestrator, auth: Authenticator, web: WebSignIn | null, page: Page, hosts: Set<string>, intents: { reader: IntentReader; limiter: RateLimiter }, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (!expectedHost(req.headers.host, hosts)) throw new Problem(421, `unexpected Host: ${[...hosts].join(', ')} only`);
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname;
  // The requester's page (`static.ts`): public files, no identity needed — the data comes by API calls.
  const staticFiles = req.method === 'GET' || req.method === 'HEAD' ? staticFile(page.files, path) : undefined;
  if (staticFiles !== undefined) return serveStatic(staticFiles, page.csp, req, res);
  // The sign-in flow is browser navigations (no custom header possible); everything else, cookie or Bearer, needs it.
  if (req.headers['x-eupadev'] !== '1' && !path.startsWith('/auth/')) throw new Problem(403, 'header X-EupaDev: 1 required');
  const route = (...methods: string[]) => {
    if (!methods.includes(req.method ?? '')) throw new Problem(405, `method ${req.method ?? '?'} not allowed on ${path} (${methods.join(' or ')} expected)`, { allow: methods.join(', ') });
  };
  if (path.startsWith('/auth/')) return handleAuth(orch, auth, web, req, res, url, route);
  if (path === '/health') {
    route('GET');
    const reason = await orch.health();
    if (reason !== null) throw new Problem(503, reason);
    return respond(res, 200, { status: 'ok', pause_agents: orch.config.pauseAgents });
  }
  const actor = await authenticate(orch, auth, req);
  if (path === '/requests') {
    route('GET', 'POST');
    // "My requests": an admin sees all, a requester the tools they requested.
    if (req.method === 'GET') return respond(res, 200, { me: { name: await orch.base.displayName(actor.id), roles: actor.roles }, requests: await orch.base.requests(actor.roles.includes('admin') ? null : actor.id) });
    const key = idempotencyKey(req);
    const d = validate(validateRequest, await readJson(req));
    const r = await orch.requestByKey(key, d, actor).catch((e: unknown) => { throw refusal(e); });
    return respond(res, 201, r, { Location: `/requests/${r.cycle_id}` });
  }
  const m = /^\/requests\/([1-9][0-9]{0,15})(\/messages|\/intent)?$/.exec(path);
  if (m !== null) {
    const id = Number(m[1]);
    if (m[2] === '/intent') {
      route('POST');
      const body = validate(validateIntent, await readJson(req));
      return respond(res, 200, await readIntent(orch, intents.reader, intents.limiter, id, actor, body).catch((e: unknown) => { throw refusal(e); }));
    }
    route('GET');
    if (m[2] === undefined) return respond(res, 200, await requestState(orch, id, actor).catch((e: unknown) => { throw refusal(e); }));
    // The cycle's chat (table `messages`, what the scoping agent reads); `since` = last id received, for the polling page.
    const since = url.searchParams.get('since') ?? '0';
    if (!/^(0|[1-9][0-9]{0,15})$/.test(since)) throw new Problem(400, 'since parameter: a message id (integer >= 0) expected');
    await readableCycle(orch, id, actor).catch((e: unknown) => { throw refusal(e); });
    return respond(res, 200, { cycle_id: id, messages: await orch.base.messagesSince(id, Number(since)) });
  }
  if (path === '/messages') {
    route('POST');
    const key = idempotencyKey(req);
    const { cycle_id, message } = validate(validateMessage, await readJson(req));
    const r = await orch.messageByKey(key, cycle_id, { ...message, actor_id: actor.id } as Message, actor).catch((e: unknown) => { throw refusal(e); });
    if (!r.transmitted) throw new Problem(409, r.reason);
    return respond(res, 202, r);
  }
  if (path === '/actors/merges') {
    route('POST');
    if (!actor.roles.includes('admin')) throw new Problem(403, 'actor merge refused: admin hat required');
    const f = validate(validateMerge, await readJson(req));
    const r = await orch.base.mergeActors(f.absorbed_actor, f.target_actor, f.reason, actor.id).catch((e: unknown) => { throw refusal(e); });
    if (r.new) DBOS.logger.warn(`actor merge: ${f.absorbed_actor} absorbed by ${f.target_actor}, decided by ${actor.id} (${f.reason})`);
    return respond(res, r.new ? 201 : 200, r.merge);
  }
  throw new Problem(404, `${path}: unknown route (GET /health, GET|POST /requests, GET /requests/<cycle>, GET /requests/<cycle>/messages, POST /requests/<cycle>/intent, POST /messages, POST /actors/merges, /auth/login|callback|logout)`);
}

interface Page { files: Map<string, StaticFile>; csp: string }

/**
 * Server of the local API; the caller chooses the address and the port (`config.api`); the IdP comes from `config.oidc`
 * (and `config.oidcWeb` for the page). `reader`: how a typed sentence is understood (ADR-031) — the word lists until the
 * model reader exists (S3).
 */
export function createApi(orch: Orchestrator, auth = new Authenticator(orch.config.oidc), reader: IntentReader = wordsReader): http.Server {
  const web = orch.config.oidcWeb === null ? null : new WebSignIn(orch.config.oidcWeb, orch.config.oidc.issuer);
  const page: Page = { files: buildStatic(orch.config.webPath, orch.config.deepChatPath), csp: cspPage(new URL(orch.config.oidc.issuer).origin) };
  const hosts = acceptedHosts(orch.config.dashboardUrl);
  const intents = { reader, limiter: new RateLimiter() };
  return http.createServer((req, res) => {
    handle(orch, auth, web, page, hosts, intents, req, res).catch((e: unknown) => {
      const p = e instanceof Problem ? e : new Problem(500, 'internal error (see the engine log)');
      if (!(e instanceof Problem)) console.error(`API ${req.method ?? '?'} ${req.url ?? '?'} : ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
      const headers: http.OutgoingHttpHeaders = { ...p.headers, ...(p.status === 405 ? { Allow: String(p.extra['allow']) } : {}) };
      if (typeof p.extra[WWW_AUTHENTICATE] === 'string') headers[WWW_AUTHENTICATE] = p.extra[WWW_AUTHENTICATE];
      problem(res, p, headers);
    });
  });
}
