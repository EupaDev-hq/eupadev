// Attaches one file to a request, replacing the previous one. The core has already checked the declared type, the
// signature bytes and the 5 MiB cap; here only who may, on which request.
import { Problem } from '@eupadev/core';
import { attachmentRefusal } from './lib/attachments.js';
import { VISIBLE, scope } from './lib/requests.js';

const EXTENSION = { 'image/png': 'png', 'image/jpeg': 'jpg', 'application/pdf': 'pdf' };

/** @param {any} ctx */
export default async function uploadAttachment(ctx) {
  const id = ctx.params.id;
  const { type, body } = ctx.body;
  const name = ctx.query.name ?? `attachment.${EXTENSION[/** @type {keyof EXTENSION} */ (type)]}`;
  return ctx.db.tx(async (/** @type {any} */ t) => {
    const { rows: [r] } = await t.query(`SELECT r.requester_id, r.status FROM requests r WHERE r.id = $3 AND ${VISIBLE} FOR UPDATE`,
      [...scope(ctx.session), id]);
    if (!r) throw new Problem(404, 'NOT_FOUND', `Request ${id} not found`);
    const refusal = attachmentRefusal({ author: r.requester_id === ctx.session.actorId, roles: ctx.session.roles, status: r.status, remove: false });
    if (refusal) throw new Problem(...refusal);
    const { rows: [a] } = await t.query(`INSERT INTO request_attachments (request_id, name, media_type, content) VALUES ($1, $2, $3, $4)
      ON CONFLICT (request_id) DO UPDATE SET name = EXCLUDED.name, media_type = EXCLUDED.media_type, content = EXCLUDED.content, created_at = now()
      RETURNING name, media_type, octet_length(content) AS size, to_json(created_at) #>> '{}' AS created_at`, [id, name, type, body]);
    return { status: 200, body: a };
  });
}
