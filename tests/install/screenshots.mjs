// The README screenshots, taken from a running discovery installation (install.sh discovery) so that
// they stay what a visitor really sees: one whole cycle driven through the page by the two accounts,
// requester and admin, the way tests/install/discovery-smoke.sh drives it through the API. The
// passwords are read from the owner-only .env of the installation and never printed. Each language
// gets its own cycle: the engine is restarted with EUPADEV_LANGUAGE (the chat lines come from it),
// the browser speaks the language (the page follows navigator.language).
//   node tests/install/screenshots.mjs [DIR]   (DIR: ~/.eupadev/discovery; Playwright from orchestrator/node_modules)
// Writes docs/assets/screenshots/<shot>.png (English) and <shot>.fr.png (French), 1280x800, dark theme.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { chromium } = createRequire(join(ROOT, 'orchestrator', 'package.json'))('playwright');
const DIR = process.argv[2] ?? join(process.env.EUPADEV_HOME ?? join(process.env.HOME, '.eupadev'), 'discovery');
const OUT = join(ROOT, 'docs', 'assets', 'screenshots');
const env = Object.fromEntries(readFileSync(join(DIR, '.env'), 'utf8').split('\n').filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => l.split(/=(.*)/s).slice(0, 2)));
const ADDRESS = env.EUPADEV_ADDRESS || 'localhost';
const PAGE = `http://${ADDRESS}:8080`;
const MAIL = `http://${ADDRESS}:8025`;
const WAIT_MS = 90_000;
const API = { 'X-EupaDev': '1' };

/** One request per language: the name is what the sidebar shows, the need what the scoping agent reads. */
const REQUESTS = {
  en: { name: 'Equipment loans', service: 'Facilities', need: 'A page where colleagues book a projector, a camera or a laptop for a few days, see who has what, and get a reminder the day before the return.', catalogue: 'Booking and return of shared equipment (projectors, cameras, laptops).' },
  fr: { name: 'Prêts de matériel', service: 'Services généraux', need: 'Une page où les collègues réservent un vidéoprojecteur, un appareil photo ou un portable pour quelques jours, voient qui a quoi, et reçoivent un rappel la veille du retour.', catalogue: 'Réservation et retour du matériel partagé (vidéoprojecteurs, appareils photo, portables).' },
};

/** Recreates the engine with the chat language (a shell variable wins over .env in Compose); none = the installation's. */
const engineLanguage = (lang) => execFileSync('docker', ['compose', '-p', 'eupadev-discovery', '--project-directory', DIR, '-f', join(DIR, 'compose.yml'), 'up', '-d', '--wait', 'engine'],
  { stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, ...(lang ? { EUPADEV_LANGUAGE: lang } : {}) } });

/** Signs an account in through the page's own flow (the "Sign in" button, the issuer's form) and lands on `path`. */
async function signIn(browser, account, lang, path = '/') {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: 'dark', reducedMotion: 'reduce', locale: lang === 'fr' ? 'fr-FR' : 'en-US' });
  const page = await context.newPage();
  await page.goto(`${PAGE}${path}`);
  await page.locator('a.button.primary').click(); // "Sign in"
  await page.locator('#username').fill(account);
  await page.locator('#password').fill(env[`SIGNIN_${account.toUpperCase()}_PASSWORD`]);
  await page.locator('button[type=submit]').click();
  await page.waitForURL(`${PAGE}${path}`);
  return page;
}
async function stateIs(page, id, state) {
  const until = Date.now() + WAIT_MS;
  for (;;) {
    const r = await (await page.request.get(`${PAGE}/requests/${id}`, { headers: API })).json();
    if (r.state === state) return r;
    if (Date.now() > until) throw new Error(`cycle ${id} did not reach ${state} within ${WAIT_MS / 1000}s (last: ${r.state})`);
    await new Promise((f) => setTimeout(f, 1000));
  }
}
const shot = (page, name, lang) => page.screenshot({ path: join(OUT, `${name}${lang === 'fr' ? '.fr' : ''}.png`) });

async function cycle(browser, lang) {
  const req = REQUESTS[lang];
  const requester = await signIn(browser, 'requester', lang);
  await requester.request.delete(`${MAIL}/api/v1/messages`); // Mailpit shows this cycle's mails only
  await requester.locator('#new-name').fill(req.name);
  await requester.locator('#new-owner_service').fill(req.service);
  await requester.locator('#new-need').fill(req.need);
  await shot(requester, 'request', lang);
  await requester.locator('form.fields button[type=submit]').click();
  await requester.waitForURL(/\/cycles\/\d+$/);
  const id = Number(requester.url().split('/').at(-1));

  // 1. The mock-up: the fake scoping deploys it; the requester reads the link and approves.
  await stateIs(requester, id, 'waiting_scoping_feedback');
  await requester.reload();
  const approveMockup = requester.locator('.opinions button.primary'); // "Approve this mock-up"
  await approveMockup.waitFor();
  await requester.waitForTimeout(500);
  await shot(requester, 'mockup', lang);
  await approveMockup.click();

  // 2. Gate 1: the admin writes the catalogue description and approves.
  await stateIs(requester, id, 'gate_1');
  const admin = await signIn(browser, 'admin', lang, `/cycles/${id}`);
  await admin.locator('#decision-comment').fill(req.catalogue);
  await admin.waitForTimeout(500);
  await shot(admin, 'gate1', lang);
  await admin.locator('.decision button.primary').click();

  // 3. The Preview: accepted by the requester. 4. Gate 2: approved by the admin (the card carries the digest).
  await stateIs(requester, id, 'waiting_preview_feedback');
  await requester.reload();
  await requester.locator('.opinions button.primary').click(); // "Approve this Preview"
  await stateIs(requester, id, 'gate_2');
  await admin.reload();
  await admin.locator('.decision button.primary').click();

  // 5. The tool "in production": the end of the cycle, seen by the requester; the mails of the cycle in Mailpit.
  await stateIs(requester, id, 'end_success');
  await requester.reload();
  await requester.locator('.badge.done').waitFor();
  await requester.waitForTimeout(500);
  await shot(requester, 'production', lang);
  await admin.goto(`${MAIL}/`);
  await admin.getByText(/Gate 2|Porte 2/).first().waitFor(); // the Gate 2 mail, named in plain words
  await admin.waitForTimeout(500);
  await shot(admin, 'mails', lang);
  await requester.context().close();
  await admin.context().close();
  console.log(`${lang}: cycle ${id} shot (request, mockup, gate1, production, mails)`);
}

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
try {
  for (const lang of ['en', 'fr']) {
    engineLanguage(lang);
    await cycle(browser, lang);
  }
} finally {
  await browser.close();
  engineLanguage();
}
