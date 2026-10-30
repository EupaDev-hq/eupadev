// Steps of the attachment scenarios, through the detail screen's file input.
import { readFile } from 'node:fs/promises';
import { expect } from '@playwright/test';
import { exampleFile } from '@eupadev/core/kit/sec.js';
import { Then, When, visit } from './fixtures.js';

const TYPES = { png: 'image/png', jpg: 'image/jpeg', pdf: 'application/pdf' };

/** Opens the scenario's request as `who` and picks a file in its attachment form. */
async function attach(/** @type {any} */ as, /** @type {import('./fixtures.js').World} */ world, /** @type {string} */ who, /** @type {{ name: string, mimeType: string, buffer: Buffer }} */ file) {
  const page = await as(who);
  await visit(page, `/requests/${world.id}`, /** @type {string} */ (world.title));
  await page.getByLabel(/Photo or PDF/).setInputFiles(file);
  await page.getByRole('button', { name: 'Attach', exact: true }).click();
  return page;
}

When('{word} attaches the file {string}', async ({ as, world }, who, name) => {
  const mimeType = TYPES[/** @type {keyof TYPES} */ (name.split('.').pop())];
  const page = await attach(as, world, who, { name, mimeType, buffer: exampleFile(mimeType, 4096) });
  await expect(page.getByText('Attached.', { exact: true })).toBeVisible();
});
When('{word} attaches an HTML page named {string}', async ({ as, world }, who, name) => {
  await attach(as, world, who, { name, mimeType: 'image/png', buffer: Buffer.from('<!doctype html><script>alert(1)</script>') });
});
When('{word} attaches a photo of {int} MiB', async ({ as, world }, who, mib) => {
  await attach(as, world, who, { name: 'big.png', mimeType: 'image/png', buffer: exampleFile('image/png', mib * 1_048_576) });
});

// 119 letters, then an emoji (two UTF-16 units) as the 120th character: a cut by code units would split it.
const LONG = `${'a'.repeat(119)}\u{1F4F7}-kitchen.png`;
When('{word} attaches a photo whose name has an emoji as its 120th character', async ({ as, world }, who) => {
  const page = await attach(as, world, who, { name: LONG, mimeType: 'image/png', buffer: exampleFile('image/png', 4096) });
  await expect(page.getByText('Attached.', { exact: true })).toBeVisible();
});
Then('{word} sees the attachment under its first 120 characters', async ({ as }, who) => {
  await expect((await as(who)).getByRole('link', { name: `Download ${[...LONG].slice(0, 120).join('')}`, exact: true })).toHaveCount(1);
});
Then('{word} sees the attachment {string} and downloads it', async ({ as }, who, name) => {
  const page = await as(who);
  await expect(page.getByRole('link', { name: /^Download / })).toHaveCount(1);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: `Download ${name}` }).click()]);
  expect(download.suggestedFilename()).toBe(name);
  const mimeType = TYPES[/** @type {keyof TYPES} */ (name.split('.').pop())];
  expect(await readFile(await download.path())).toEqual(exampleFile(mimeType, 4096));
});
Then('{word} is told {string}', async ({ as }, who, text) => {
  await expect((await as(who)).locator('#attachment-state')).toContainText(text);
});
