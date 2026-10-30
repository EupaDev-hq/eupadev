// Soft delete by an admin (ADR-003): the request disappears from reads (404) and goes at the next purge, unless
// restored before (updateRequest, restore). Someone else's draft stays out of reach, as on read.
import { Problem } from '@eupadev/core';
import { VISIBLE, scope } from './lib/requests.js';

/** @param {any} ctx */
export default async function deleteRequest(ctx) {
  const id = ctx.params.id;
  const { rowCount } = await ctx.db.tx((/** @type {any} */ t) => t.query(`UPDATE requests r SET deleted_at = now(), deleted_by = $1 WHERE r.id = $3 AND ${VISIBLE}`,
    [...scope(ctx.session), id]));
  if (rowCount === 0) throw new Problem(404, 'NOT_FOUND', `Request ${id} not found`);
  return { status: 204 };
}
