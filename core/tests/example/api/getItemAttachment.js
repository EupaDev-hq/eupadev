import { Problem } from '../../../src/index.js';
import { files } from './lib/store.js';

/** @type {import('../../../src/http.js').Handler} */
export default async function getItemAttachment(ctx) {
  const f = files.get(/** @type {string} */ (ctx.params.id));
  if (!f) throw new Problem(404, 'NOT_FOUND', 'No file');
  return { status: 200, file: { name: f.type === 'image/png' ? 'photo.png' : 'document.pdf', type: f.type, body: f.body } };
}
