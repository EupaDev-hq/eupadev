// Example download: CSV of the items as a stream. The traps (`?trap=`) serve the core's tests: hostile file name
// (sanitised), undeclared type (500), endless stream (cut at the cap).
import { Readable } from 'node:stream';
import { items, witness } from './lib/store.js';

/** @param {string} v */
const cell = (v) => `"${v.replaceAll('"', '""')}"`;

/** @type {import('../../../src/http.js').Handler} */
export default async function exportItems(ctx) {
  if (ctx.query.trap === 'name') return { status: 200, file: { name: '../"\u00e9 t\u00e9s"\r\n.csv', type: 'text/csv', body: Buffer.from('id\r\n') } };
  if (ctx.query.trap === 'type') {
    witness.stream = Readable.from(['{}']);
    return { status: 200, file: { name: 'x.json', type: 'application/json', body: witness.stream } };
  }
  if (ctx.query.trap === 'cap') {
    return { status: 200, file: { name: 'endless.csv', type: 'text/csv', body: Readable.from((function* () { for (;;) yield Buffer.alloc(1024 * 1024, 0x61); })()) } };
  }
  const status = ctx.query.status;
  const rows = ['id,name,status\r\n', ...[...items.values()].filter((i) => status === undefined || i.status === status).map((i) => `${i.id},${cell(i.name)},${i.status}\r\n`)];
  return { status: 200, file: { name: 'items.csv', type: 'text/csv', body: Readable.from(rows) } };
}
