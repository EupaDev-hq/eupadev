// CSV export of the visible requests (RFC 4180, filters of listRequests), streamed: one page of PAGE rows at a time,
// separated by a comma, or a semicolon on demand (`separator=semicolon`: what a spreadsheet set to a language with a
// decimal comma expects; the screen picks it from the browser's language),
// each in its own short transaction, following (created_at, id) like the list; neither everything in memory nor a
// transaction open for the whole download. The core cuts the stream at the file cap.
import { Readable } from 'node:stream';
import { SELECTION, VISIBLE, scope } from './lib/requests.js';

const PAGE = 500;
const COLUMNS = ['id', 'created_at', 'updated_at', 'status', 'urgency', 'category', 'title', 'description', 'location', 'requester_name', 'closing_note'];

/**
 * One cell: in double quotes, quotes doubled; a value a spreadsheet would take for a formula (=, +, -, @, tab,
 * carriage return) is prefixed with an apostrophe (CSV injection, OWASP).
 * @param {unknown} v
 */
export const cell = (v) => {
  const text = v === null || v === undefined ? '' : String(v);
  return `"${(/^[=+\-@\t\r]/.test(text) ? `'${text}` : text).replaceAll('"', '""')}"`;
};

/** @param {any} ctx */
export default async function exportRequests(ctx) {
  const { status = null, category = null, separator } = ctx.query;
  const sep = separator === 'semicolon' ? ';' : ',';
  const values = [...scope(ctx.session), status, category];
  async function* rows() {
    yield `﻿${COLUMNS.join(sep)}\r\n`; // BOM: a spreadsheet reads UTF-8 (accented letters) without any setting
    /** @type {[string | null, string | null]} */ let after = [null, null];
    for (;;) {
      const { rows: page } = await ctx.db.tx((/** @type {any} */ t) => t.query(
        `${SELECTION} WHERE ${VISIBLE} AND ($3::text IS NULL OR r.status = $3) AND ($4::text IS NULL OR r.category_code = $4)
           AND ($5::timestamptz IS NULL OR (r.created_at, r.id) < ($5::timestamptz, $6::uuid))
         ORDER BY r.created_at DESC, r.id DESC LIMIT ${PAGE}`, [...values, ...after]));
      if (page.length > 0) yield page.map((/** @type {any} */ d) => `${COLUMNS.map((c) => cell(d[c])).join(sep)}\r\n`).join('');
      if (page.length < PAGE) return;
      after = [page.at(-1).created_at, page.at(-1).id];
    }
  }
  return { status: 200, file: { name: 'requests.csv', type: 'text/csv', body: Readable.from(rows()) } };
}
