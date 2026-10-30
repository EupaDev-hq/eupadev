// Who may change an attachment (api/lib/attachments.js), without a database.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { attachmentRefusal } from '../../api/lib/attachments.js';

const reader = ['reader'];

test('the author changes the attachment while the request is a draft or submitted, not after', () => {
  for (const status of ['draft', 'submitted']) {
    for (const remove of [false, true]) assert.equal(attachmentRefusal({ author: true, roles: reader, status, remove }), null);
  }
  for (const status of ['in_progress', 'resolved', 'rejected', 'cancelled']) {
    assert.deepEqual(attachmentRefusal({ author: true, roles: reader, status, remove: false })?.slice(0, 2), [422, 'NOT_EDITABLE']);
  }
});

test('a manager uploads on any request but never removes; an administrator does both', () => {
  assert.equal(attachmentRefusal({ author: false, roles: ['manager'], status: 'in_progress', remove: false }), null);
  assert.deepEqual(attachmentRefusal({ author: false, roles: ['manager'], status: 'submitted', remove: true })?.slice(0, 2), [403, 'FORBIDDEN']);
  for (const remove of [false, true]) assert.equal(attachmentRefusal({ author: false, roles: ['admin'], status: 'resolved', remove }), null);
});

test('someone else\'s request, without a managing role: forbidden', () => {
  assert.deepEqual(attachmentRefusal({ author: false, roles: reader, status: 'submitted', remove: false })?.slice(0, 2), [403, 'FORBIDDEN']);
});
