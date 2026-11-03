// Chat step 4 (ADR-024): the requester's page in a real Chromium for the @web scenarios. The engine's
// API of the scenario's bench is served on a local port, the fake IdP is played in-process (the same trick as
// tests/web.test.ts: Playwright does not route the hops of a redirect chain, so `/auth/login` is fetched here and answered
// with the callback URL Keycloak would send the requester back to), one browser for the session, one context per scenario.
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { chromium, type Browser, type BrowserContext } from 'playwright';
import { createApi } from '../../src/api.ts';
import { REQUESTER, REQUESTER_MAIL, SUBJECTS } from '../../tests/helpers/bench.ts';
import { CLIENT_WEB_TEST, startFakeOidc, TEST_ISSUER, WEB_TEST_PASSWORD, type Account, type FakeOidc } from '../../tests/helpers/fake-oidc.ts';
import type { World } from './world.ts';

/** The requester of the scenarios (REQUESTER), as the fake IdP signs her in. */
const REQUESTER_ACCOUNT: Account = { subject: SUBJECTS[REQUESTER.id]!, mail: REQUESTER_MAIL, name: REQUESTER_MAIL, roles: ['requester'] };
let oidc: FakeOidc | undefined;
let browser: Browser | undefined;
let api: http.Server | undefined;
let context: BrowserContext | undefined;

/** Engine variables of a @web scenario: the fake IdP (started once), the web client, human delays long enough for a browser. */
export async function envWeb(): Promise<Record<string, string>> {
  oidc ??= await startFakeOidc();
  return { OIDC_JWKS_URL: oidc.jwksUrl, OIDC_WEB_CLIENT_ID: CLIENT_WEB_TEST, OIDC_WEB_CLIENT_SECRET: WEB_TEST_PASSWORD, OIDC_WEB_REDIRECT_URL: 'http://localhost:8080/auth/callback', REMINDER_DELAY_MS: '60000', PAUSE_ARCHIVE_DELAY_MS: '600000' };
}

/** The API of the scenario's bench on a free port, an English browser tab signed in as the requester when it reaches the IdP. */
export async function startWeb(world: World): Promise<void> {
  api = createApi(world.bench.orch).listen(0, '127.0.0.1');
  await once(api, 'listening');
  const base = `http://localhost:${(api.address() as AddressInfo).port}`;
  browser ??= await chromium.launch();
  context = await browser.newContext({ baseURL: base, locale: 'en-GB' });
  await context.route('**/auth/login**', async (route) => {
    const r = await route.fetch({ maxRedirects: 0 });
    const location = r.headers()['location'] ?? '';
    assert.ok(location.startsWith(`${TEST_ISSUER}/protocol/openid-connect/auth?`), `the engine sends the browser to Keycloak: ${r.status()} ${location}`);
    const back = oidc!.authorize(location, REQUESTER_ACCOUNT);
    await route.fulfill({ response: r, status: 303, headers: { ...r.headers(), location: new URL(back.pathname + back.search, base).href } });
  });
  world.page = await context.newPage();
}

export async function stopWeb(): Promise<void> {
  await context?.close();
  context = undefined;
  api?.close();
  api = undefined;
}

export async function closeWeb(): Promise<void> {
  await browser?.close();
  await oidc?.stop();
}
