// Removes a request's attachment: the row is erased (personal data, no restore planned). Idempotent: removing an
// attachment that is not there is done already (204), as DELETE should be.
import { Problem } from '@eupadev/core';
import { attachmentRefusal } from './lib/attachments.js';
import { VISIBLE, scope } from './lib/requests.js';

/** @param {any} ctx */
export default async function deleteAttachment(ctx) {
  const id = ctx.params.id;
  return ctx.db.tx(async (/** @type {any} */ t) => {
    const { rows: [r] } = await t.query(`SELECT r.requester_id, r.status FROM requests r WHERE r.id = $3 AND ${VISIBLE} FOR UPDATE`,
      [...scope(ctx.session), id]);
    if (!r) throw new Problem(404, 'NOT_FOUND', `Request ${id} not found`);
    const refusal = attachmentRefusal({ author: r.requester_id === ctx.session.actorId, roles: ctx.session.roles, status: r.status, remove: true });
    if (refusal) throw new Problem(...refusal);
    await t.query('DELETE FROM request_attachments WHERE request_id = $1', [id]);
    return { status: 204 };
  });
}
