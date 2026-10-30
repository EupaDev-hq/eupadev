// Role and ownership rules of the transitions (api/lib/transitions.js), without a database: the (from, to) pair is
// judged by the database and tested in tests/db.test.js.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { transitionRefusal } from '../../api/lib/transitions.js';

const author = { author: true, manages: false };
const manager = { author: false, manages: true };
const code = (/** @type {Parameters<typeof transitionRefusal>[0]} */ t) => transitionRefusal(t)?.slice(0, 2) ?? null;

test('submit and cancel: the author only, even against a manager', () => {
  assert.equal(code({ ...author, from: 'draft', to: 'submitted', note: null }), null);
  assert.equal(code({ ...author, from: 'submitted', to: 'cancelled', note: null }), null);
  assert.deepEqual(code({ ...manager, from: 'submitted', to: 'cancelled', note: null }), [403, 'FORBIDDEN']);
});

test('take on, resolve, reject: whoever manages only, even the requesting author is left out', () => {
  assert.equal(code({ ...manager, from: 'submitted', to: 'in_progress', note: null }), null);
  assert.deepEqual(code({ ...author, from: 'submitted', to: 'in_progress', note: null }), [403, 'FORBIDDEN']);
  assert.deepEqual(code({ ...author, from: 'in_progress', to: 'resolved', note: 'Repaired' }), [403, 'FORBIDDEN']);
  assert.equal(code({ author: true, manages: true, from: 'submitted', to: 'in_progress', note: null }), null, 'a manager who is the author handles their own request');
});

test('a note is required to resolve or reject, refused elsewhere', () => {
  assert.equal(code({ ...manager, from: 'in_progress', to: 'resolved', note: 'Strike plate replaced' }), null);
  assert.equal(code({ ...manager, from: 'submitted', to: 'rejected', note: 'Out of scope' }), null);
  assert.deepEqual(code({ ...manager, from: 'in_progress', to: 'resolved', note: null }), [422, 'NOTE_REQUIRED']);
  assert.deepEqual(code({ ...manager, from: 'submitted', to: 'rejected', note: null }), [422, 'NOTE_REQUIRED']);
  assert.deepEqual(code({ ...author, from: 'draft', to: 'submitted', note: 'x' }), [422, 'NOTE_UNEXPECTED']);
});

test('staying on the same status is not a transition', () => {
  assert.deepEqual(code({ ...author, from: 'submitted', to: 'submitted', note: null }), [422, 'INVALID_TRANSITION']);
});
