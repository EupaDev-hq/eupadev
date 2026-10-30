import { randomUUID } from 'node:crypto';
import { items } from './lib/store.js';

/** @type {import('../../../src/http.js').Handler} */
export default async function createItem(ctx) {
  const body = /** @type {{ name: string, status: string, note?: string }} */ (ctx.body);
  const item = { id: randomUUID(), name: body.name, status: body.status, ...(body.note === undefined ? {} : { note: body.note }) };
  items.set(item.id, item);
  ctx.log.info({ item: item.id, actor: ctx.session.actorId }, 'item created');
  return { status: 201, body: item, headers: { Location: `/api/items/${item.id}` } };
}
