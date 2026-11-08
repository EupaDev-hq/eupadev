// Gate 1 registration names (D-E5, src/registration.ts): the roles of the contract and the retention periods of the
// purge, read as the Gate 1 page needs them to build the core-tools.yml entry. Pure functions; the template's own
// purge.sql is read as the realistic input.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rolesOf, retentionsOf } from '../src/registration.ts';

const CONTRACT = `openapi: 3.1.0
paths:
  /api/me:
    get:
      operationId: getMe
      x-roles: [reader, manager, admin]
  /api/items:
    post:
      operationId: addItem
      x-roles: [admin]
    get:
      operationId: listItems
      x-roles: [reader, Bad Role, admin, 7seven]
`;

test('registration: roles are the x-roles of every operation, in order of first appearance, deduplicated, invalid names dropped', () => {
  assert.deepEqual(rolesOf(CONTRACT), ['reader', 'manager', 'admin']);
  assert.deepEqual(rolesOf('paths: {}\n'), []);
  assert.deepEqual(rolesOf('not: [yaml'), [], 'an unreadable contract gives no role, no error');
});

test('registration: RETENTION_AUDIT first, then one RETENTION_<X> per purge.retention_<x> setting of the purge, once each', () => {
  const purge = `DELETE FROM app.requests WHERE closed_at < now() - current_setting('purge.retention_requests')::interval;
DELETE FROM app.history WHERE at < now() - current_setting( 'purge.retention_history' )::interval;
DELETE FROM app.requests_archive WHERE at < now() - current_setting('purge.retention_requests')::interval;`;
  assert.deepEqual(retentionsOf(purge), ['RETENTION_AUDIT', 'RETENTION_REQUESTS', 'RETENTION_HISTORY']);
  assert.deepEqual(retentionsOf(''), ['RETENTION_AUDIT'], 'a tool without its own periods still has the audit one');
});

test('registration: the template’s own db/purge.sql reads as the Gate 1 page expects (audit, then its periods)', () => {
  const names = retentionsOf(readFileSync(new URL('../../tool-template/db/purge.sql', import.meta.url), 'utf8'));
  assert.equal(names[0], 'RETENTION_AUDIT');
  for (const n of names) assert.match(n, /^RETENTION_[A-Z][A-Z0-9_]*$/);
});
