import { items } from './lib/store.js';

/** @type {import('../../../src/http.js').Handler} */
export default async function listItems(ctx) {
  const limit = /** @type {number} */ (ctx.query.limit);
  const status = ctx.query.status;
  const all = [...items.values()].filter((i) => status === undefined || i.status === status);
  return { status: 200, body: { items: all.slice(0, limit), next: all.length > limit ? String(limit) : null } };
}
