// Chat step 4 (features/chat.feature): the requester acts in her browser on the engine's page (features/support/web.ts);
// what the engine does with it is checked in the database, as everywhere else (checks.ts).
import { Then, When } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { World } from '../support/world.ts';

const PAGE_TIMEOUT_MS = 15_000;

/** Opens a path of the page, signing in at the fake IdP when the page asks for it (the session cookie then holds for the scenario). */
async function open(m: World, path: string): Promise<void> {
  await m.page.goto(path);
  // The page asks for a sign-in, or already lists my requests (session cookie of an earlier step).
  const connection = m.page.getByRole('link', { name: 'Sign in' });
  await connection.or(m.page.locator('#requests')).first().waitFor({ timeout: PAGE_TIMEOUT_MS });
  if (await connection.isVisible()) await connection.click();
  await m.page.waitForURL(`**${path}`, { timeout: PAGE_TIMEOUT_MS });
}
/** The conversation of a cycle is open once its tool's short name heads the page and the chat holds its first message. */
async function openConversation(m: World, cycleId: number): Promise<void> {
  const c = await m.base.readCycle(cycleId);
  await m.page.locator('.conv-head .slug', { hasText: c.slug }).waitFor({ timeout: PAGE_TIMEOUT_MS });
  await m.page.locator('deep-chat .message-bubble').first().waitFor({ timeout: PAGE_TIMEOUT_MS });
}

When('the requester opens the cycle\'s conversation in their browser', async function (this: World) {
  await open(this, `/cycles/${this.cycleId}`);
  await openConversation(this, this.cycleId);
});
When('the requester opens their page in their browser', async function (this: World) {
  await open(this, '/');
  await this.page.getByRole('heading', { name: 'My requests' }).waitFor({ timeout: PAGE_TIMEOUT_MS });
});
When('the requester opens the conversation of tool {string}', async function (this: World, slug: string) {
  const id = this.cycleOf(slug);
  await this.page.locator(`#requests a[href="/cycles/${id}"]`).click();
  await openConversation(this, id);
});
When('the requester types {string} in the chat', async function (this: World, text: string) {
  const input = this.page.locator('deep-chat #text-input');
  await input.click();
  await input.fill(text);
  await input.press('Enter');
  // The engine accepted it: the page's own acknowledgement follows the typed text.
  await this.page.locator('deep-chat').getByText('Sent. The agents are on it.').waitFor({ timeout: PAGE_TIMEOUT_MS });
});

Then('the page shows message {string}', async function (this: World, text: string) {
  await this.page.locator('deep-chat').getByText(text, { exact: false }).first().waitFor({ timeout: PAGE_TIMEOUT_MS });
});
Then('the page does not show message {string}', async function (this: World, text: string) {
  assert.equal(await this.page.locator('deep-chat').getByText(text, { exact: false }).count(), 0);
});
Then('the page says {string}', async function (this: World, text: string) {
  await this.page.locator('.conv-head').getByText(text, { exact: true }).waitFor({ timeout: PAGE_TIMEOUT_MS });
});
Then('their list of requests contains exactly tools {string} and {string}', async function (this: World, a: string, b: string) {
  for (const slug of [a, b]) await this.page.locator(`#requests a[href="/cycles/${this.cycleOf(slug)}"]`).waitFor({ timeout: PAGE_TIMEOUT_MS });
  assert.equal(await this.page.locator('#requests a[href^="/cycles/"]').count(), 2);
});
