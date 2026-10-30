// Category reference list, sorted by label; the deactivated ones only with `?active=false`.
/** @param {any} ctx */
export default async function listCategories(ctx) {
  const { rows } = await ctx.db.tx((/** @type {any} */ t) => t.query(
    'SELECT code, label, active, version::int AS version FROM categories WHERE active OR NOT $1 ORDER BY label, code LIMIT 500',
    [ctx.query.active !== false]));
  return { status: 200, body: { items: rows } };
}
