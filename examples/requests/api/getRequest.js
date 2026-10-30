// One request visible to the caller, with its history; outside the caller's scope, 404 like a request that does not
// exist (never reveal that it exists).
import { Problem } from '@eupadev/core';
import { SELECTION, VISIBLE, scope } from './lib/requests.js';

/** @param {any} ctx */
export default async function getRequest(ctx) {
  const id = ctx.params.id;
  return ctx.db.tx(async (/** @type {any} */ t) => {
    const { rows } = await t.query(`${SELECTION} WHERE r.id = $3 AND ${VISIBLE}`, [...scope(ctx.session), id]);
    if (rows.length === 0) throw new Problem(404, 'NOT_FOUND', `Request ${id} not found`);
    const history = await t.query(`SELECT h.from_status, h.to_status, h.actor_id, a.display_name AS actor_name, to_json(h.at) #>> '{}' AS at
      FROM request_history h JOIN actors a ON a.id = h.actor_id WHERE h.request_id = $1 ORDER BY h.id`, [id]);
    const attachment = await t.query(`SELECT name, media_type, octet_length(content) AS size, to_json(created_at) #>> '{}' AS created_at
      FROM request_attachments WHERE request_id = $1`, [id]);
    return { status: 200, body: { ...rows[0], attachment: attachment.rows[0] ?? null, history: history.rows } };
  });
}
