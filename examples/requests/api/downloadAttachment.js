// The attachment of a visible request, as a download (Content-Disposition: attachment, set by the core).
import { Problem } from '@eupadev/core';
import { VISIBLE, scope } from './lib/requests.js';

/** @param {any} ctx */
export default async function downloadAttachment(ctx) {
  const id = ctx.params.id;
  const { rows: [a] } = await ctx.db.tx((/** @type {any} */ t) => t.query(`SELECT f.name, f.media_type, f.content FROM requests r
    JOIN request_attachments f ON f.request_id = r.id WHERE r.id = $3 AND ${VISIBLE}`, [...scope(ctx.session), id]));
  if (!a) throw new Problem(404, 'NOT_FOUND', `Request ${id} has no attachment`);
  return { status: 200, file: { name: a.name, type: a.media_type, body: a.content } };
}
