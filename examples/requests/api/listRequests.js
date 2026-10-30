// Visible requests (or deleted ones, for the admin who wants to restore one), newest first, filtered by status and
// category; opaque cursor on (created_at, id), the index of the lists (the template's quality rules: never OFFSET).
import { Problem } from '@eupadev/core';
import { SCOPE, SELECTION, scope } from './lib/requests.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** @param {string | undefined} cursor @returns {[string, string] | [null, null]} */
function readCursor(cursor) {
  if (cursor === undefined) return [null, null];
  try {
    const [when, id] = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (typeof when === 'string' && Number.isFinite(Date.parse(when)) && UUID.test(id)) return [when, id];
  } catch { /* unreadable cursor */ }
  throw new Problem(400, 'VALIDATION_FAILED', 'Request does not match the contract', { errors: [{ pointer: '/query/cursor', message: 'invalid cursor' }] });
}

/** @param {any} ctx */
export default async function listRequests(ctx) {
  const { status = null, category = null, limit, cursor, deleted = false } = ctx.query;
  if (deleted && !ctx.session.roles.includes('admin')) throw new Problem(403, 'FORBIDDEN', 'Only an admin lists deleted requests');
  const { rows } = await ctx.db.tx((/** @type {any} */ t) => t.query(
    `${SELECTION} WHERE r.deleted_at IS ${deleted ? 'NOT ' : ''}NULL AND ${SCOPE} AND ($3::text IS NULL OR r.status = $3) AND ($4::text IS NULL OR r.category_code = $4)
       AND ($5::timestamptz IS NULL OR (r.created_at, r.id) < ($5::timestamptz, $6::uuid))
     ORDER BY r.created_at DESC, r.id DESC LIMIT $7`,
    [...scope(ctx.session), status, category, ...readCursor(cursor), limit + 1]));
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  const next = rows.length > limit && last ? Buffer.from(JSON.stringify([last.created_at, last.id])).toString('base64url') : null;
  return { status: 200, body: { items, next } };
}
