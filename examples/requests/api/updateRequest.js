// Change of a request at the version read (decision E11): the fields of a draft by its author, and/or a status change
// and/or the restore of a deleted request (admin). The row is locked for the time of the transaction: two
// simultaneous changes do not overwrite each other, the second gets 409. The database judges the (from, to) pair and
// writes the history, which the screens show to the requester and the managers (no mail: the platform offers no
// mail relay to the tools; what changed is visible in the tool, status badge and history).
import { Problem } from '@eupadev/core';
import { SCOPE, SELECTION, scope } from './lib/requests.js';
import { transitionRefusal } from './lib/transitions.js';

/** @param {any} ctx */
export default async function updateRequest(ctx) {
  const id = ctx.params.id;
  const { version, category = null, urgency = null, title = null, description = null, location = null, status = null, note = null, restore = false } = ctx.body;
  const [actor, manages] = scope(ctx.session);
  if (restore && !ctx.session.roles.includes('admin')) throw new Problem(403, 'FORBIDDEN', 'Only an admin restores a request');
  const body = await ctx.db.tx(async (/** @type {any} */ t) => {
    // A deleted request is only found when restoring it; restoring one that is not deleted is a 422, not a 404.
    const { rows } = await t.query(`SELECT r.requester_id, r.status, r.category_code, r.version::int AS version, r.deleted_at IS NOT NULL AS deleted FROM requests r
      WHERE r.id = $3 AND (r.deleted_at IS NULL OR $4) AND ${SCOPE} FOR UPDATE`, [actor, manages, id, restore]);
    const request = rows[0];
    if (!request) throw new Problem(404, 'NOT_FOUND', `Request ${id} not found`);
    if (restore && !request.deleted) throw new Problem(422, 'NOT_DELETED', `Request ${id} is not deleted`);
    const author = request.requester_id === actor;
    const fields = [category, urgency, title, description, location].some((v) => v !== null);
    if (fields && (!author || request.status !== 'draft')) throw new Problem(422, 'NOT_EDITABLE', 'Only the author can edit a draft');
    if (status === null && note !== null) throw new Problem(422, 'NOTE_UNEXPECTED', 'A note goes with status resolved or rejected');
    const refusal = status === null ? null : transitionRefusal({ author, manages, from: request.status, to: status, note });
    if (refusal) throw new Problem(...refusal);
    if (request.version !== version) throw new Problem(409, 'VERSION_CONFLICT', `Request ${id} has changed, reload it`);
    // Only a new category must be active: a draft filed under a since-deactivated one keeps it through other edits.
    if (category !== null && category !== request.category_code && (await t.query('SELECT 1 FROM categories WHERE code = $1 AND active', [category])).rowCount === 0) {
      throw new Problem(422, 'UNKNOWN_CATEGORY', `Category ${category} is unknown or inactive`);
    }
    // The note first: the transition trigger checks it is there. Then always one UPDATE of requests, so that the
    // version moves up one step at every change, text-only changes included.
    await t.query(`UPDATE request_details SET title = coalesce($2, title), description = coalesce($3, description), location = coalesce($4, location),
      closing_note = coalesce($5, closing_note) WHERE request_id = $1`, [id, title, description, location, note]);
    try {
      await t.query(`UPDATE requests SET category_code = coalesce($2, category_code), urgency = coalesce($3, urgency), status = coalesce($4, status)
        ${restore ? ', deleted_at = NULL, deleted_by = NULL' : ''} WHERE id = $1`, [id, category, urgency, status]);
    } catch (/** @type {any} */ e) {
      if (e.code === '23514' && e.constraint === 'requests_transition') throw new Problem(422, 'INVALID_TRANSITION', `Request cannot go from ${request.status} to ${status}`);
      throw e;
    }
    return (await t.query(`${SELECTION} WHERE r.id = $1`, [id])).rows[0];
  });
  return { status: 200, body };
}
