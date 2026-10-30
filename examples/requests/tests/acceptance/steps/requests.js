// Steps of the request scenarios. "Given" steps prepare data through the API, as the person would through the
// screens; "When" and "Then" steps act and look through the screens only.
import { readFile } from 'node:fs/promises';
import { expect } from '@playwright/test';
import { Given, Then, When, call, visit } from './fixtures.js';

/** @typedef {import('./fixtures.js').World} World */
/** @typedef {(name: string) => Promise<import('@playwright/test').Page>} As */

/** The scenario's category for a name of the feature, created by the admin on first use. @param {As} as @param {World} world @param {string} name */
async function category(as, world, name) {
  let c = world.categories.get(name);
  if (!c) {
    c = { code: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${world.suffix}`, label: `${name} ${world.suffix}` };
    await call(await as('admin'), 'POST', '/api/categories', c);
    world.categories.set(name, c);
  }
  return c;
}

/** Creates a draft as `who` and moves it through `statuses` (each as the person allowed to). @param {As} as @param {World} world */
async function request(as, world, /** @type {string} */ who, /** @type {string} */ title, /** @type {string[]} */ statuses = [], categoryName = 'General', description = '') {
  const c = await category(as, world, categoryName);
  let r = await call(await as(who), 'POST', '/api/requests', { title: `${title} ${world.suffix}`, location: 'Dock 3', category: c.code, urgency: 'normal', description });
  for (const status of statuses) {
    const actor = ['submitted', 'cancelled'].includes(status) ? who : 'manager';
    const note = ['resolved', 'rejected'].includes(status) ? { note: 'Done' } : {};
    r = await call(await as(actor), 'PATCH', `/api/requests/${r.id}`, { version: r.version, status, ...note });
  }
  world.id = r.id;
  world.title = r.title;
  return r;
}

/** Opens the scenario's request as `who`. @param {As} as @param {World} world @param {string} who */
async function detail(as, world, who) {
  const page = await as(who);
  await visit(page, `/requests/${world.id}`, /** @type {string} */ (world.title));
  return page;
}

/** Clicks a status button on the scenario's request and waits for the confirmation. */
async function act(/** @type {As} */ as, /** @type {World} */ world, /** @type {string} */ who, /** @type {string} */ button, /** @type {string} */ done) {
  const page = await detail(as, world, who);
  await page.getByRole('button', { name: button, exact: true }).click();
  await expect(page.getByText(done, { exact: true })).toBeVisible();
}

/** Waits until the list has loaded (rows or the empty message). @param {import('@playwright/test').Page} page */
async function list(page) {
  await visit(page, '/', 'Requests');
  await page.locator('#rows tr, #empty:visible').first().waitFor();
}

Given('the category {string} exists', async ({ as, world }, /** @type {string} */ name) => { await category(as, world, name); });
Given('{word} has a draft request {string}', async ({ as, world }, who, title) => { await request(as, world, who, title); });
Given('{word} has a draft request {string} in {string}', async ({ as, world }, who, title, cat) => { await request(as, world, who, title, [], cat); });
Given('{word} has a draft request {string} described as {string}', async ({ as, world }, who, title, description) => { await request(as, world, who, title, [], 'General', description); });
Given('{word} has a submitted request {string}', async ({ as, world }, who, title) => { await request(as, world, who, title, ['submitted']); });
Given('{word} has a submitted request {string} in {string}', async ({ as, world }, who, title, cat) => { await request(as, world, who, title, ['submitted'], cat); });
Given('{word} has a request {string} in progress', async ({ as, world }, who, title) => { await request(as, world, who, title, ['submitted', 'in_progress']); });
Given('{word} has a resolved request {string}', async ({ as, world }, who, title) => { await request(as, world, who, title, ['submitted', 'in_progress', 'resolved']); });

When('{word} creates the request {string} in {string} with {word} urgency', async ({ as, world }, who, title, cat, urgency) => {
  const c = await category(as, world, cat);
  const page = await as(who);
  await visit(page, '/requests/new', 'New request');
  world.title = `${title} ${world.suffix}`;
  await page.getByLabel('Title').fill(world.title);
  await page.getByLabel('Location').fill('Dock 3');
  await page.getByLabel('Category').selectOption({ label: c.label });
  await page.getByLabel('Urgency').selectOption({ label: urgency[0]?.toUpperCase() + urgency.slice(1) });
  await page.getByRole('button', { name: 'Save draft' }).click();
  await page.waitForURL(/#\/requests\/[0-9a-f-]{36}$/);
  world.id = page.url().split('/').pop();
});
/** Opens the edit screen of the scenario's draft as `who`, lets `change` fill it, saves, waits for the detail. */
async function edit(/** @type {As} */ as, /** @type {World} */ world, /** @type {string} */ who, /** @type {(page: import('@playwright/test').Page) => Promise<void>} */ change) {
  const page = await as(who);
  await visit(page, `/requests/${world.id}/edit`, 'Edit draft');
  await expect(page.getByLabel('Title')).toHaveValue(/** @type {string} */ (world.title));
  await change(page);
  await page.getByRole('button', { name: 'Save draft' }).click();
  await page.waitForURL(new RegExp(`#/requests/${world.id}$`));
}
When('{word} clears the description of her draft', async ({ as, world }, who) => {
  await edit(as, world, who, (page) => page.getByLabel('Description').fill(''));
});
When('{word} renames her draft {string}', async ({ as, world }, who, title) => {
  const renamed = `${title} ${world.suffix}`;
  await edit(as, world, who, (page) => page.getByLabel('Title').fill(renamed));
  world.title = renamed;
});
When('{word} submits it', async ({ as, world }, who) => { await act(as, world, who, 'Submit', 'Submitted.'); });
When('{word} takes it on', async ({ as, world }, who) => { await act(as, world, who, 'Take on', 'In progress.'); });
When('{word} cancels it', async ({ as, world }, who) => { await act(as, world, who, 'Cancel request', 'Cancelled.'); });
When('{word} resolves it with the note {string}', async ({ as, world }, who, note) => {
  const page = await detail(as, world, who);
  await page.getByLabel(/^Note/).fill(note);
  await page.getByRole('button', { name: 'Resolve' }).click();
  await expect(page.getByText('Resolved.', { exact: true })).toBeVisible();
});
When('{word} rejects it without a reason', async ({ as, world }, who) => {
  const page = await detail(as, world, who);
  await page.getByRole('button', { name: 'Reject' }).click();
});
When('{word} rejects it with the reason {string}', async ({ as, world }, who, reason) => {
  const page = await detail(as, world, who);
  await page.getByLabel(/^Note/).fill(reason);
  await page.getByRole('button', { name: 'Reject' }).click();
  await expect(page.getByText('Rejected.', { exact: true })).toBeVisible();
});
When('{word} deletes it', async ({ as, world }, who) => {
  const page = await detail(as, world, who);
  await page.getByRole('button', { name: 'Delete' }).click(); // the confirm() is accepted by the fixture
  await expect(page.getByRole('heading', { level: 1, name: 'Requests' })).toBeVisible();
});
When('{word} restores it from the deleted requests', async ({ as, world }, who) => {
  const page = await as(who);
  await visit(page, '/deleted', 'Deleted requests');
  await page.getByRole('row', { name: /** @type {string} */ (world.title) }).getByRole('button', { name: 'Restore' }).click();
  await expect(page.getByText('Restored.', { exact: true })).toBeVisible();
});
When('{word} filters the list on {string} and exports it', async ({ as, world }, who, cat) => {
  const page = await as(who);
  await list(page);
  const c = await category(as, world, cat);
  await page.getByLabel('Category').selectOption({ label: c.label });
  await expect(page.locator('#export')).toHaveAttribute('href', new RegExp(`category=${c.code}`));
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Export CSV', exact: true }).click()]);
  world.csv = await readFile(await download.path(), 'utf8');
});
When('{word} opens the list', async ({ as }, who) => { await list(await as(who)); });

Then('{word} sees the request {string} as {string}', async ({ as, world }, who, _title, status) => {
  const page = await detail(as, world, who);
  await expect(page.locator('main .status-badge')).toHaveText(status);
});
Then('{word} sees the request as {string}', async ({ as, world }, who, status) => {
  const page = await detail(as, world, who);
  await expect(page.locator('main .status-badge')).toHaveText(status);
});
Then('{word} sees the request as {string} with the closing note {string}', async ({ as, world }, who, status, note) => {
  const page = await detail(as, world, who);
  await expect(page.locator('main .status-badge')).toHaveText(status);
  await expect(page.locator('[data-field="closing_note"]')).toHaveText(note);
});
Then('{word} sees the draft without a description', async ({ as, world }, who) => {
  const page = await detail(as, world, who);
  await expect(page.locator('[data-field="description"]')).toHaveText('—');
});
Then('the history shows {string} by {string}', async ({ as, world }, status, by) => {
  const page = await detail(as, world, 'reader');
  await expect(page.locator('#history tr').filter({ hasText: status }).filter({ hasText: by })).toHaveCount(1);
});
Then('{word} does not find the request in the list', async ({ as, world }, who) => {
  const page = await as(who);
  await list(page);
  await expect(page.getByRole('link', { name: world.title })).toHaveCount(0);
});
Then('its address shows {string} to {word}', async ({ as, world }, heading, who) => {
  await visit(await as(who), `/requests/${world.id}`, heading);
});
Then('the rejection is refused', async ({ as, world }) => {
  const page = await as('manager');
  expect(await page.getByLabel(/^Note/).evaluate((/** @type {HTMLTextAreaElement} */ t) => t.validity.valueMissing)).toBe(true);
  await detail(as, world, 'manager');
  await expect(page.locator('main .status-badge')).toHaveText('Submitted');
});
Then('{word} is offered no status change', async ({ as, world }, who) => {
  const page = await detail(as, world, who);
  await expect(page.locator('#actions button')).toHaveCount(0);
  await expect(page.locator('#close')).toBeHidden();
});
Then('{word} is not offered to {word} it', async ({ as, world }, who, action) => {
  const page = await detail(as, world, who);
  await expect(page.getByRole('button', { name: action === 'cancel' ? 'Cancel request' : 'Delete', exact: true })).toHaveCount(0);
});
Then('the file holds {string} and only {string} requests', async ({ world }, title, cat) => {
  const code = world.categories.get(cat)?.code;
  const lines = /** @type {string} */ (world.csv).replace(/^\uFEFF/, '').trim().split('\r\n');
  const at = (/** @type {string} */ line) => line.split(',')[5]?.replace(/"/g, '');
  expect(lines.length).toBeGreaterThan(1);
  expect(lines.slice(1).map(at).filter((c) => c !== code)).toEqual([]);
  expect(world.csv).toContain(`${title} ${world.suffix}`);
});
Then('{word} is not offered the export', async ({ as }, who) => {
  await expect((await as(who)).locator('#export')).toBeHidden();
});
