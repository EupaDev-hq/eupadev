/**
 * Real notifications (E1, ROADMAP §8.16 M7): one text mail per notification, over SMTP
 * (nodemailer, MIT-0) — Mailpit in the lab, the customer's SMTP relay in production. Retries: those of the DBOS step that
 * calls `notify` (`step` of `deps.ts`), not here.
 *
 * Idempotency (M9): in ONE transaction, the key is inserted into `sent_notifications` (migration 0007), the mail
 * sent, then the transaction committed. A key already committed never goes out again: engine killed after sending then DBOS
 * step replayed on restart, late attempt that succeeds during its retry (the 2nd INSERT waits for the 1st one's COMMIT, then
 * does nothing). Sending fails: ROLLBACK, the key stays free for the retry.
 * ponytail: at least once, not exactly once — a hard stop BETWEEN the SMTP server's acceptance and the
 * COMMIT sends the mail again on retry; same `Message-ID` (derived from the key), which most mail clients merge.
 *
 * Recipients: the admin = `ADMIN_ESCALATION_ADDRESS`; the requester = the contact address of the tool's requesting actor
 * (`actors.mail`, refreshed on every authenticated request, I0), required at request time (`newRequest`). The subject is passed as is to nodemailer (no header built by hand; it replaces
 * a line break with a space itself). The SMTP URL may contain a password: it appears in no
 * message.
 */
import { createHash, randomUUID } from 'node:crypto';
import nodemailer, { type Mail } from 'nodemailer';
import pg from 'pg';
import { PermanentError } from '../db.ts';
import { MAIL_ADDRESS, type Notifications } from './contracts.ts';

export interface OptionsSmtp {
  /** `smtp://host:port` (Mailpit: `smtp://mailpit:1025`), `smtps://user:password@host:465`, or `smtp://…:587?requireTLS=true`. */
  url: string;
  /** Sender address (`MAIL_FROM`); its domain is also used for the `Message-ID`s. */
  sender: string;
  /** The admin's address (`ADMIN_ESCALATION_ADDRESS`). */
  admin: string;
  /** The engine's database (account `orch_engine`): idempotency table and the requester's address. */
  databaseUrl: string;
}

export class NotificationsSmtp implements Notifications {
  readonly #transport: Mail;
  readonly #pool: pg.Pool;
  readonly #sender: string;
  readonly #admin: string;

  constructor(o: OptionsSmtp) {
    if (!/^smtps?:\/\/[^/?#\s]+/.test(o.url)) throw new Error('SMTP_URL invalid (smtp://host:port or smtps://…)');
    if (!MAIL_ADDRESS.test(o.sender)) throw new Error(`MAIL_FROM invalid: "${o.sender}" (mail address expected)`);
    if (!MAIL_ADDRESS.test(o.admin)) throw new Error(`ADMIN_ESCALATION_ADDRESS invalid: "${o.admin}" (mail address expected)`);
    // Bounded timeouts: the DBOS step fails then retries rather than waiting for a silent server (B1).
    this.#transport = nodemailer.createTransport({ url: o.url, connectionTimeout: 30_000, greetingTimeout: 30_000, socketTimeout: 60_000 });
    this.#pool = new pg.Pool({ connectionString: o.databaseUrl, max: 2, allowExitOnIdle: true });
    // Idle connection cut (database restarted): the pool discards it and opens a new one on the next send; without a listener,
    // the event would kill the process.
    this.#pool.on('error', () => {});
    this.#sender = o.sender;
    this.#admin = o.admin;
  }

  async notify(recipient: 'admin' | 'requester', cycleId: number, subject: string, content: string, key: string = randomUUID()): Promise<void> {
    const client = await this.#pool.connect();
    let broken = false;
    try {
      await client.query('BEGIN');
      let address = this.#admin;
      if (recipient === 'requester') {
        const r = await client.query<{ mail: string | null }>('SELECT a.mail FROM cycles c JOIN tools o ON o.id = c.tool_id JOIN actors a ON a.id = canonical_actor(o.requester_id) WHERE c.id = $1', [cycleId]);
        address = r.rows[0]?.mail ?? '';
        if (!MAIL_ADDRESS.test(address)) throw new PermanentError(`cycle ${cycleId}: requester without a mail address ("${address}"), notification impossible`);
      }
      const inserted = await client.query('INSERT INTO sent_notifications (key, cycle_id, recipient) VALUES ($1, $2, $3) ON CONFLICT (key) DO NOTHING', [key, cycleId, recipient]);
      if (inserted.rowCount === 1) {
        const id = createHash('sha256').update(key, 'utf8').digest('hex');
        await this.#transport.sendMail({
          from: { name: 'EupaDev', address: this.#sender },
          to: address,
          subject: subject,
          text: content,
          messageId: `<${id}@${this.#sender.split('@')[1]}>`,
        });
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => { broken = true; });
      throw e;
    } finally {
      client.release(broken);
    }
  }
}
