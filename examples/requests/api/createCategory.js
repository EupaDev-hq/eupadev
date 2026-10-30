// New category, active; a code already taken answers 409 without changing anything.
import { Problem } from '@eupadev/core';

/** @param {any} ctx */
export default async function createCategory(ctx) {
  const { code, label } = ctx.body;
  const { rows } = await ctx.db.tx((/** @type {any} */ t) => t.query(
    'INSERT INTO categories (code, label) VALUES ($1, $2) ON CONFLICT (code) DO NOTHING RETURNING code, label, active, version::int AS version',
    [code, label]));
  if (rows.length === 0) throw new Problem(409, 'CATEGORY_EXISTS', `Category ${code} already exists`);
  return { status: 201, body: rows[0], headers: { Location: `/api/categories/${code}` } };
}
