// Who is told what about a status change (api/lib/mail.js), without SMTP.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { transitionMail } from '../../api/lib/mail.js';

const request = { id: '01a1593f-6cb8-7490-a4b6-391db85f6771', title: 'Door\r\nBcc: x@evil.example', requester_id: 'alice', closing_note: 'Not our scope' };
const base = { actorId: 'bruno', requesterMail: 'alice@example.test', managers: 'maintenance@example.test', appUrl: 'https://tool.example' };

test('the requester is told of a change made by someone else, with the reason of a rejection and a link from APP_URL', () => {
  const m = transitionMail(request, { ...base, status: 'rejected' });
  assert.equal(m?.to, 'alice@example.test');
  assert.equal(m?.subject, 'Your request is rejected: Door Bcc: x@evil.example', 'one header line, whatever the title holds');
  assert.match(m?.text ?? '', /Reason: Not our scope/);
  assert.match(m?.text ?? '', /https:\/\/tool\.example\/#\/requests\/01a1593f-6cb8-7490-a4b6-391db85f6771/);
  assert.doesNotMatch(transitionMail(request, { ...base, status: 'in_progress' })?.text ?? '', /Reason/);
});

test('a submission goes to the managers\' shared mailbox; the author is not told of their own change', () => {
  assert.equal(transitionMail(request, { ...base, actorId: 'alice', status: 'submitted' })?.to, 'maintenance@example.test');
  assert.equal(transitionMail(request, { ...base, actorId: 'alice', status: 'cancelled' }), null);
  assert.equal(transitionMail(request, { ...base, requesterMail: null, status: 'resolved' }), null, 'no address, no mail');
  assert.equal(transitionMail(request, { ...base, managers: undefined, actorId: 'alice', status: 'submitted' }), null);
});
