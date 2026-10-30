// New request as a draft (the database refuses any other birth status); the category must be active.
import { Problem } from '@eupadev/core';
import { SELECTION } from './lib/requests.js';

/** @param {any} ctx */
export default async function createRequest(ctx) {
  const { title, description, location, category, urgency } = ctx.body;
  return ctx.db.tx(async (/** @type {any} */ t) => {
    const created = await t.query(
      'INSERT INTO requests (category_code, urgency, requester_id) SELECT code, $2, $3 FROM categories WHERE code = $1 AND active RETURNING id',
      [category, urgency, ctx.session.actorId]);
    const id = created.rows[0]?.id;
    if (!id) throw new Problem(422, 'UNKNOWN_CATEGORY', `Category ${category} is unknown or inactive`);
    await t.query('INSERT INTO request_details (request_id, title, description, location) VALUES ($1, $2, $3, $4)', [id, title, description, location]);
    const { rows } = await t.query(`${SELECTION} WHERE r.id = $1`, [id]);
    return { status: 201, body: rows[0], headers: { Location: `/api/requests/${id}` } };
  });
}
