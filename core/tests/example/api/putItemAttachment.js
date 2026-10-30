import { Problem } from '../../../src/index.js';
import { files, items } from './lib/store.js';

/** @type {import('../../../src/http.js').Handler} */
export default async function putItemAttachment(ctx) {
  const id = /** @type {string} */ (ctx.params.id);
  if (!items.has(id)) throw new Problem(404, 'NOT_FOUND', `Item ${id} not found`);
  const f = /** @type {{ type: string, body: Buffer }} */ (ctx.body);
  files.set(id, f);
  return { status: 200, body: { type: f.type, size: f.body.length } };
}
