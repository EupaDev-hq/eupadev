// Label or activation of a category, at the version read (ADR-003, decision E11): otherwise 409, unknown 404.
import { Problem } from '@eupadev/core';

/** @param {any} ctx */
export default async function updateCategory(ctx) {
  const code = ctx.params.code;
  const { label = null, active = null, version } = ctx.body;
  return ctx.db.tx(async (/** @type {any} */ t) => {
    const { rows } = await t.query(
      `UPDATE categories SET label = coalesce($2, label), active = coalesce($3, active)
       WHERE code = $1 AND version = $4 RETURNING code, label, active, version::int AS version`,
      [code, label, active, version]);
    if (rows.length === 1) return { status: 200, body: rows[0] };
    const exists = await t.query('SELECT 1 FROM categories WHERE code = $1', [code]);
    if (exists.rowCount === 0) throw new Problem(404, 'NOT_FOUND', `Category ${code} not found`);
    throw new Problem(409, 'VERSION_CONFLICT', `Category ${code} has changed, reload it`);
  });
}
