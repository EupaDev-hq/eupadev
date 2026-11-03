// Mail of the tool (decision E9: nodemailer here, the ADR-019 exception declared in docs/DECISIONS.md). Who is told
// what: the requester, of each status change made by someone else; the managers' shared mailbox
// (MAIL_MANAGERS), of each submission. Sent after the transaction commits; a failure is logged with an
// error_id and never undoes or fails the change (no outbox: add one if a client needs guaranteed delivery).
import { randomUUID } from 'node:crypto';
import nodemailer from 'nodemailer';

const LABEL = { submitted: 'submitted', in_progress: 'in progress', resolved: 'resolved', rejected: 'rejected', cancelled: 'cancelled' };

/** A header value on one line, whatever the user typed. Pure. @param {string} s */
const oneLine = (s) => s.replace(/[\p{Cc}\u{2028}\u{2029}]+/gu, ' ').trim();

/**
 * The message for a status change, or null when nobody is to be told. Pure.
 * @param {{ id: string, title: string, requester_id: string, closing_note: string | null }} request after the change
 * @param {{ status: string, actorId: string, requesterMail: string | null, managers: string | undefined, appUrl: string | undefined }} c
 * @returns {{ to: string, subject: string, text: string } | null}
 */
export function transitionMail(request, { status, actorId, requesterMail, managers, appUrl }) {
  // The link is built from APP_URL, never from the request (backend.md).
  const link = appUrl ? new URL(`/#/requests/${request.id}`, appUrl).href : '';
  const title = oneLine(request.title);
  if (status === 'submitted') {
    if (!managers) return null;
    return { to: managers, subject: `New request: ${title}`, text: `A request was submitted: ${request.title}\n\n${link}\n` };
  }
  if (actorId === request.requester_id || !requesterMail) return null;
  const label = LABEL[/** @type {keyof LABEL} */ (status)] ?? status;
  const note = request.closing_note && (status === 'resolved' || status === 'rejected')
    ? `\n${status === 'rejected' ? 'Reason' : 'Note'}: ${request.closing_note}\n` : '';
  return { to: requesterMail, subject: `Your request is ${label}: ${title}`, text: `Your request "${request.title}" is ${label}.\n${note}\n${link}\n` };
}

/** @type {import('nodemailer').Transporter | null} */
let transport = null;

/**
 * Sends without blocking the answer; SMTP_URL and MAIL_FROM come from the environment, read at the first send.
 * @param {import('fastify').FastifyBaseLogger} log @param {{ to: string, subject: string, text: string }} message
 * @param {string} requestId the request the mail is about (logged instead of the address)
 */
export function send(log, message, requestId) {
  const { SMTP_URL, MAIL_FROM } = process.env;
  (async () => {
    if (!SMTP_URL || !MAIL_FROM) throw new Error('SMTP_URL and MAIL_FROM are required to send mail');
    transport ??= nodemailer.createTransport({ url: SMTP_URL, connectionTimeout: 5000, greetingTimeout: 5000, socketTimeout: 10_000 });
    await transport.sendMail({ from: MAIL_FROM, ...message });
  })().catch((err) => {
    log.error({ err, error_id: randomUUID(), event: 'mail_failed', request: requestId }, 'mail not sent');
  });
}
