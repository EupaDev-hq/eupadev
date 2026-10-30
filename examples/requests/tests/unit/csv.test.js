// Building a CSV cell (api/exportRequests.js): RFC 4180 and formula injection.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cell } from '../../api/exportRequests.js';

test('doubled quotes, comma and line break kept in the cell, empty for null', () => {
  assert.equal(cell('Door "B", dock 3\r\nurgent'), '"Door ""B"", dock 3\r\nurgent"');
  assert.equal(cell(null), '""');
  assert.equal(cell(2), '"2"');
});

test('a spreadsheet formula becomes text', () => {
  for (const f of ['=1+1', '+33 6', '-2', '@SUM(A1)', '\tx', '\rx']) assert.equal(cell(f), `"'${f}"`);
  assert.equal(cell('a=1'), '"a=1"');
});
