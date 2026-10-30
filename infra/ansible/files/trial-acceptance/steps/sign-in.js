// Steps of the test tool's scenario: the n-th person holding a role (never a name), signed in through the real
// Keycloak form of the Preview, then its API read with that session.
import { expect } from '@playwright/test';
import { createBdd } from 'playwright-bdd';
import { readRealm } from '@eupadev/core/kit/realm.js';
import { callFrom, signedInContext } from '@eupadev/core/kit/two-users.js';

const BASE = /** @type {string} */ (process.env.ACCEPTANCE_BASE_URL);
const { people } = readRealm(process.env.KIT_REALM_FILE);
const person = (/** @type {string} */ role, n = 1) => people.filter((p) => p.roles.includes(role))[n - 1];
const { Given, Then } = createBdd();
/** @type {import('@playwright/test').BrowserContext} */ let session;

Given('a {string} signs in', async ({ browser }, /** @type {string} */ role) => {
  session = await signedInContext(browser, BASE, person(role));
});

Then('their roles are {string}', async ({}, /** @type {string} */ role) => {
  const r = await callFrom(session, BASE, 'GET', '/api/me');
  expect(r.status, r.text).toBe(200);
  expect(r.json.roles).toEqual([role]);
});
