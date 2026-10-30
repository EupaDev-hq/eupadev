import { Problem } from '../../../src/index.js';
import { TRAPS, items } from './lib/store.js';

/** @type {import('../../../src/http.js').Handler} */
export default async function getItem(ctx) {
  const id = /** @type {string} */ (ctx.params.id);
  // Deliberate traps: the core must contain them (generic 500, never the faulty response).
  if (id === TRAPS.outsideContract) return { status: 200, body: { id, name: 'x', status: 'open', password_hash: 'leak' } };
  if (id === TRAPS.exception) throw new Error('internal detail: SELECT * FROM secrets');
  if (id === TRAPS.forbiddenHeader) return { status: 200, body: { id, name: 'x', status: 'open' }, headers: { 'Set-Cookie': 'a=b' } };
  if (id === TRAPS.undeclaredStatus) return { status: 418, body: {} };
  const item = items.get(id);
  if (!item) throw new Problem(404, 'NOT_FOUND', `Item ${id} not found`);
  return { status: 200, body: item, headers: { ETag: `"${item.id.slice(0, 8)}"` } };
}
