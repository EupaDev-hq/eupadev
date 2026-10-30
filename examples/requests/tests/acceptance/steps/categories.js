// Steps of the category scenarios, through the admin screen and the request form.
import { expect } from '@playwright/test';
import { Then, When, visit } from './fixtures.js';

When('{word} adds the category {string}', async ({ as, world }, who, name) => {
  const c = { code: `${name.toLowerCase()}_${world.suffix}`, label: `${name} ${world.suffix}` };
  const page = await as(who);
  await visit(page, '/categories', 'Categories');
  await page.getByLabel('Code').fill(c.code);
  await page.getByLabel('Label').fill(c.label);
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByRole('cell', { name: c.label })).toBeVisible();
  world.categories.set(name, c);
});
When('{word} deactivates the category {string}', async ({ as, world }, who, name) => {
  const c = /** @type {{ code: string }} */ (world.categories.get(name));
  const page = await as(who);
  await visit(page, '/categories', 'Categories');
  const row = page.getByRole('row').filter({ hasText: c.code });
  await row.getByRole('button', { name: 'Deactivate' }).click();
  await expect(row.getByRole('cell', { name: 'Inactive' })).toBeVisible();
});

/** Labels offered by the request form. @param {import('@playwright/test').Page} page */
async function offered(page) {
  await visit(page, '/requests/new', 'New request');
  return page.getByLabel('Category').locator('option').allTextContents();
}
Then('{word} is offered {string} when creating a request', async ({ as, world }, who, name) => {
  expect(await offered(await as(who))).toContain(world.categories.get(name)?.label);
});
Then('{word} is not offered {string} when creating a request', async ({ as, world }, who, name) => {
  expect(await offered(await as(who))).not.toContain(world.categories.get(name)?.label);
});
Then('{word} still sees {string} on the request', async ({ as, world }, who, name) => {
  const page = await as(who);
  await visit(page, `/requests/${world.id}`, /** @type {string} */ (world.title));
  await expect(page.locator('[data-field="category"]')).toHaveText(/** @type {string} */ (world.categories.get(name)?.label));
});
