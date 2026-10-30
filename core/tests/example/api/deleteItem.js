import { Problem } from '../../../src/index.js';
import { items } from './lib/store.js';

/** @type {import('../../../src/http.js').Handler} */
export default async function deleteItem(ctx) {
  const id = /** @type {string} */ (ctx.params.id);
  if (!items.delete(id)) throw new Problem(404, 'NOT_FOUND', `Item ${id} not found`);
  return { status: 204 };
}
