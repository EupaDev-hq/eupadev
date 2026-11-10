// E1: real notifications — the SMTP adapter against a real server (throwaway Mailpit,
// the lab's one) and a throwaway migrated PostgreSQL (idempotency table, migration 0007); then the engine killed right after
// sending the Gate 1 mail: on restart, the step is replayed with the same key and no 2nd mail goes out.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import pg from 'pg';
import { PermanentError } from '../src/db.ts';
import { NotificationsSmtp } from '../src/external/smtp-notifications.ts';
import { ADMIN, ADMIN_MAIL, REQUESTER, REQUESTER_MAIL, ENV_TEST, insertTestActors } from './helpers/bench.ts';
import { startMailpit, type ThrowawayMailpit } from './helpers/throwaway-mailpit.ts';
import { migratedDatabase, startPostgres, urlBase, type ThrowawayPostgres } from './helpers/throwaway-postgres.ts';

const SENDER = 'eupadev@example.test';
let postgres: ThrowawayPostgres;
let mailpit: ThrowawayMailpit;
let engine: pg.Pool;
const children: ChildProcess[] = [];

before(async () => {
  [postgres, mailpit] = await Promise.all([startPostgres(), startMailpit()]);
  engine = new pg.Pool({ connectionString: postgres.engineUrl });
  await insertTestActors(engine);
}, { timeout: 180_000 });

after(async () => {
  for (const e of children) if (e.exitCode === null && e.signalCode === null) e.kill('SIGKILL');
  await engine?.end();
  mailpit?.remove();
  postgres?.remove();
});

const adapter = (url = mailpit.smtpUrl, databaseUrl = postgres.engineUrl) => new NotificationsSmtp({ url, sender: SENDER, admin: ADMIN_MAIL, databaseUrl });
let number = 0;
/** Tool and cycle written with the engine account; `requesterId`: the requester actor (I0: the address is read from `actors.mail`). */
async function createCycle(requesterId = REQUESTER.id): Promise<number> {
  const slug = `mails-${++number}`;
  const tool = (await engine.query<{ id: number }>(`INSERT INTO tools (name, slug, requester_id, owner_service) VALUES ($1, $2, $3, 'lab') RETURNING id::int AS id`, [`Tool ${number}`, slug, requesterId])).rows[0]!.id;
  return (await engine.query<{ id: number }>(`INSERT INTO cycles (tool_id, type, scoping_budget_usd, hardening_budget_usd, last_actor_id) VALUES ($1, 'creation', 10, 20, $2) RETURNING id::int AS id`, [tool, requesterId])).rows[0]!.id;
}
const lines = async (key: string) => (await engine.query('SELECT cycle_id::int AS cycle_id, recipient FROM sent_notifications WHERE key = $1', [key])).rows;

test('E1 SMTP: one mail per notification — admin and requester (address read from the database), Message-ID derived from the key, no header injected by the subject', async () => {
  await mailpit.empty();
  const n = adapter();
  const cycle = await createCycle();
  await n.notify('admin', cycle, 'Decision required: gate_1 (Tool)', 'Reason: test\nDashboard: https://t.example.test', 'admin-key');
  await n.notify('requester', cycle, 'Tool: Mock-up ready\nBcc: intruder@example.test', 'Your mock-up is ready.', 'requester-key');
  const mails = await mailpit.mails();
  assert.equal(mails.length, 2);
  const admin = mails.find((m) => m.To[0]?.Address === ADMIN_MAIL);
  const requester = mails.find((m) => m.To[0]?.Address === REQUESTER_MAIL);
  assert.ok(admin !== undefined && requester !== undefined, JSON.stringify(mails.map((m) => m.To)));
  assert.equal(admin.Subject, 'Decision required: gate_1 (Tool)');
  assert.deepEqual(admin.From, { Name: 'EupaDev', Address: SENDER });
  assert.match(admin.MessageID, /^[0-9a-f]{64}@example\.test$/);
  assert.notEqual(admin.MessageID, requester.MessageID);
  // The newline in the subject creates no header: no blind copy, no 2nd recipient.
  assert.deepEqual(requester.Bcc ?? [], []);
  assert.deepEqual(requester.To.map((t) => t.Address), [REQUESTER_MAIL]);
  assert.equal((await mailpit.headers(requester.ID))['Bcc'], undefined);
  assert.deepEqual(await lines('admin-key'), [{ cycle_id: cycle, recipient: 'admin' }]);
  assert.deepEqual(await lines('requester-key'), [{ cycle_id: cycle, recipient: 'requester' }]);
});

test('E1 SMTP: a key already sent never goes out again, even through two simultaneous calls (M9); a failed send leaves the key free', async () => {
  await mailpit.empty();
  const n = adapter();
  const other = adapter(); // a 2nd process (separate pool): serialisation comes from the database, not from memory
  const cycle = await createCycle();
  await n.notify('admin', cycle, 'Reminder', 'text', 'replayed-key');
  await n.notify('admin', cycle, 'Reminder', 'text', 'replayed-key');
  await other.notify('admin', cycle, 'Reminder', 'text', 'replayed-key');
  await Promise.all([n.notify('admin', cycle, 'Simultaneous', 'text', 'simultaneous-key'), other.notify('admin', cycle, 'Simultaneous', 'text', 'simultaneous-key')]);
  assert.deepEqual((await mailpit.mails()).map((m) => m.Subject).sort(), ['Reminder', 'Simultaneous']);
  // SMTP server unreachable: the step fails (DBOS will retry), nothing is kept; the retry sends.
  const fault = adapter('smtp://127.0.0.1:1');
  await assert.rejects(fault.notify('admin', cycle, 'After a fault', 'text', 'fault-key'), /ECONNREFUSED/);
  assert.deepEqual(await lines('fault-key'), []);
  await n.notify('admin', cycle, 'After a fault', 'text', 'fault-key');
  assert.equal((await mailpit.mails()).filter((m) => m.Subject === 'After a fault').length, 1);
});

test('E1 SMTP: a requester without a mail address (token without email) → permanent error, nothing sent, no key kept', async () => {
  await mailpit.empty();
  const alice = (await engine.query<{ id: string }>(`INSERT INTO actors (type, display_name) VALUES ('human', 'Alice') RETURNING id`)).rows[0]!.id;
  const cycle = await createCycle(alice);
  await assert.rejects(adapter().notify('requester', cycle, 'Subject', 'text', 'alice-key'), (e: Error) => e instanceof PermanentError && /requester without a mail address/.test(e.message));
  assert.deepEqual(await mailpit.mails(), []);
  assert.deepEqual(await lines('alice-key'), []);
});

test('E1 SMTP: the tool\'s requester was absorbed by a merge (0010) → the mail goes to the canonical actor\'s address', async () => {
  await mailpit.empty();
  const bis = (await engine.query<{ id: string }>(`INSERT INTO actors (type, mail, display_name) VALUES ('human', 'old-mailbox@example.test', 'Requester bis') RETURNING id`)).rows[0]!.id;
  const cycle = await createCycle(bis);
  await engine.query(`INSERT INTO actor_merges (absorbed_actor, target_actor, reason, decided_by) VALUES ($1, $2, 'sub changed', $3)`, [bis, REQUESTER.id, ADMIN.id]);
  await adapter().notify('requester', cycle, 'Tool: Mock-up ready', 'Your mock-up is ready.', 'merge-key');
  assert.deepEqual((await mailpit.mails()).map((m) => m.To[0]?.Address), [REQUESTER_MAIL]);
});

// ── Engine killed right after sending ───────────────────────────────────────────────────────────

function launch(env: Record<string, string>, base: string, log: string): { childProcess: ChildProcess; output: string[] } {
  const childProcess = spawn(process.execPath, ['tests/resume/child-mails.ts'], {
    env: {
      ...process.env, ...ENV_TEST, REMINDER_DELAY_MS: '600000', ORCH_DATABASE_URL: base, DBOS__VMID: 'mails-test', LOG: log,
      EUPADEV_EXTERNAL: 'notifications=smtp', SMTP_URL: mailpit.smtpUrl, MAIL_FROM: SENDER, ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(childProcess);
  const output: string[] = [];
  childProcess.stdout!.on('data', (d: Buffer) => output.push(...d.toString().split('\n').filter((l) => l !== '')));
  childProcess.stderr!.on('data', (d: Buffer) => output.push(...d.toString().split('\n').filter((l) => /rror/.test(l))));
  return { childProcess, output: output };
}
const log = join(process.env['TMPDIR'] ?? '/tmp', `mails-${process.pid}.log`);
const calls = () => readFileSync(log, 'utf8').trim().split('\n').filter((l) => l !== '');
async function waitUntil(description: string, condition: () => Promise<boolean> | boolean, output: string[], timeoutMs = 60_000): Promise<void> {
  const limit = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > limit) throw new Error(`timeout: ${description}; output: ${output.join(' | ')}; notifications: ${calls().join(' / ')}`);
    await sleep(50);
  }
}

test('E1 resume: engine killed right after sending the Gate 1 mail (DBOS step not recorded) → step replayed, no 2nd mail', { timeout: 180_000 }, async () => {
  await mailpit.empty();
  const base = await migratedDatabase(postgres, 'mails_resume');
  writeFileSync(log, '');
  const GATE = /\|Decision required — Gate 1: /;

  const first = launch({ MODE: 'create', KILL_AFTER: '^Decision required — Gate 1: ' }, base, log);
  await waitUntil('the 1st engine kills itself after the Gate 1 mail', () => first.childProcess.signalCode === 'SIGKILL', first.output, 40_000);
  const key = calls().find((l) => GATE.test(l))!.split('|')[0]!;
  const gate = () => mailpit.mails().then((ms) => ms.filter((m) => m.Subject.startsWith('Decision required — Gate 1: ')));
  assert.equal((await gate()).length, 1, 'the mail went out before the stop');
  assert.deepEqual(await engineDatabase(base, key), ['admin'], 'key kept before the stop');

  const second = launch({ MODE: 'resume' }, base, log);
  // Proof that the step really was replayed (otherwise the test would prove nothing): 2nd call of notify with the same key.
  await waitUntil('the "notify admin" step of Gate 1 is replayed', () => calls().filter((l) => GATE.test(l)).length === 2, second.output);
  const state = new pg.Pool({ connectionString: urlBase(postgres.urlAdmin, 'mails_resume') });
  try {
    await waitUntil('the workflow waits for the Gate 1 decision', async () => (await state.query(`SELECT 1 FROM dbos.workflow_status WHERE workflow_uuid = 'cycle-1' AND status = 'PENDING'`)).rowCount === 1
      && (await state.query(`SELECT 1 FROM cycles WHERE id = 1 AND state = 'gate_1'`)).rowCount === 1, second.output);
    await sleep(500);
    const mails = await gate();
    assert.equal(mails.length, 1, `no 2nd Gate 1 mail: ${JSON.stringify(mails.map((m) => m.MessageID))}`);
    assert.deepEqual(calls().filter((l) => GATE.test(l)).map((l) => l.split('|')[0]), [key, key], 'step replayed under the same key');
    // No other duplicate mail either (a duplicate would carry the same Message-ID), including the requester's (mock-up).
    const all = await mailpit.mails();
    assert.ok(all.some((m) => m.To[0]?.Address === REQUESTER_MAIL), 'the requester received their mail');
    assert.equal(new Set(all.map((m) => m.MessageID)).size, all.length, JSON.stringify(all.map((m) => m.Subject)));
  } finally {
    await state.end();
    second.childProcess.kill('SIGKILL');
  }
});

/** Recipients recorded for a key in a given test database (engine account). */
async function engineDatabase(url: string, key: string): Promise<string[]> {
  const p = new pg.Pool({ connectionString: url });
  try {
    return (await p.query<{ recipient: string }>('SELECT recipient FROM sent_notifications WHERE key = $1', [key])).rows.map((r) => r.recipient);
  } finally {
    await p.end();
  }
}
