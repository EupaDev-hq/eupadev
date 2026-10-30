// Steps that read what the tool mailed, in the stack's Mailpit (test double of the SMTP relay).
import { expect } from '@playwright/test';
import { mailpit } from '@eupadev/core/kit/mailpit.js';
import { mailpitUrl, person } from '../../stack.js';
import { Then } from './fixtures.js';

/** @param {import('./fixtures.js').World} world @param {string} to @param {string} subject */
const received = (world, to, subject) => mailpit(mailpitUrl()).waitFor((m) => m.to.includes(to) && m.subject === `${subject}: ${world.title}`);

Then('{word} receives a mail {string}', async ({ world }, who, subject) => {
  const m = await received(world, `${person(who).name}@example.test`, subject);
  expect(m.text).toContain(`/#/requests/${world.id}`);
});
Then('{word} receives a mail {string} saying {string}', async ({ world }, who, subject, text) => {
  expect((await received(world, `${person(who).name}@example.test`, subject)).text).toContain(text);
});
Then('the managers\' mailbox receives a mail {string}', async ({ world }, subject) => {
  await received(world, 'maintenance@example.test', subject);
});
