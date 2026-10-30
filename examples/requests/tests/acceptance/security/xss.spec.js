// SEC-XSS (template tests.md): every free-text field the screens show (attachment name included), written through the API with a script-bearing
// <img>, then every screen that shows it opened. Expected: window.__xss undefined, no dialog (the fixture fails the
// test on one), no <img> inside <main>; the request is deleted afterwards. Category labels refuse < and > in the
// contract, display names come from the identity provider: neither is writable here.
import { expect } from '@playwright/test';
import { REQUEST_HEADERS } from '@eupadev/core/kit';
import { exampleFile } from '@eupadev/core/kit/sec.js';
import { BASE } from '../../stack.js';
import { audit, call, test, visit } from '../steps/fixtures.js';

const PAYLOAD = '<img src=x onerror="window.__xss=1">';

test('SEC-XSS: title, description, location, closing note and attachment name are shown as text on every screen', async ({ as }) => {
  const [reader, manager, admin] = [await as('reader'), await as('manager'), await as('admin')];
  const code = `xss_${Date.now().toString(36)}`;
  await call(admin, 'POST', '/api/categories', { code, label: 'XSS check' });
  const title = `T ${code} ${PAYLOAD}`;
  let r = await call(reader, 'POST', '/api/requests', { title, description: `D ${PAYLOAD}`, location: `L ${PAYLOAD}`, category: code, urgency: 'low' });
  const put = await reader.context().request.fetch(`${BASE}/api/requests/${r.id}/attachment?name=${encodeURIComponent(`${PAYLOAD}.png`)}`,
    { method: 'PUT', headers: { ...REQUEST_HEADERS, 'content-type': 'image/png' }, data: exampleFile('image/png') });
  expect(put.status(), await put.text()).toBe(200);
  r = await call(reader, 'PATCH', `/api/requests/${r.id}`, { version: r.version, status: 'submitted' });
  r = await call(manager, 'PATCH', `/api/requests/${r.id}`, { version: r.version, status: 'rejected', note: `N ${PAYLOAD}` });

  /** @param {import('@playwright/test').Page} page */
  const clean = async (page) => {
    await expect(page.locator('main img')).toHaveCount(0);
    expect(await page.evaluate(() => /** @type {any} */ (window).__xss)).toBeUndefined();
    await audit(page);
  };
  let deleted = false;
  try {
    for (const page of [reader, manager]) {
      await visit(page, '/', 'Requests');
      await expect(page.getByRole('link', { name: title })).toBeVisible();
      await clean(page);
      await visit(page, `/requests/${r.id}`, title);
      await expect(page.locator('[data-field="closing_note"]')).toHaveText(`N ${PAYLOAD}`);
      await expect(page.locator('#attachment-link')).toHaveText(`Download ${PAYLOAD}.png`);
      await clean(page);
    }
    await call(admin, 'DELETE', `/api/requests/${r.id}`);
    deleted = true;
    await visit(admin, '/deleted', 'Deleted requests');
    await expect(admin.getByRole('cell', { name: title })).toBeVisible();
    await clean(admin);
  } finally {
    if (!deleted) await admin.context().request.fetch(`${BASE}/api/requests/${r.id}`, { method: 'DELETE', headers: { ...REQUEST_HEADERS } });
  }
});
