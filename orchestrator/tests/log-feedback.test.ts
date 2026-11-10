// ADR-030: the log tail of a red job given to the builder is redacted first and capped per task. Pure functions, no database.
// The fixtures are built at run time (placeholders, repeated characters): nothing in this file looks like a credential.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { logFeedback, redact, redactTail, REDACTED, LOG_FEEDBACK_MAX_CHARS } from '../src/hardening/log-feedback.ts';

const VALUE = 'v'.repeat(12);
const pem = (kind: string, part: 'BEGIN' | 'END') => `-----${part} ${kind}PRIVATE KEY-----`;

test('ADR-030 redaction: URL credentials, bearer tokens and the values of secret-looking keys (=, :, JSON), whatever the case; plain lines untouched', () => {
  assert.equal(redact(`registry: https://robot:${VALUE}@forge.example.test/v2/`), `registry: https://${REDACTED}@forge.example.test/v2/`);
  assert.equal(redact(`postgres://orch:p%40${VALUE}@db:5432/orchestrator`), `postgres://${REDACTED}@db:5432/orchestrator`);
  assert.equal(redact(`Authorization: Bearer ${VALUE}.${VALUE}.a-b_c`), `Authorization: Bearer ${REDACTED}`);
  assert.equal(redact(`authorization: bearer ${VALUE}`), `authorization: bearer ${REDACTED}`);
  assert.equal(redact(`OIDC_CLIENT_SECRET=${VALUE} npm start`), `OIDC_CLIENT_SECRET=${REDACTED} npm start`);
  assert.equal(redact(`  password: "${VALUE}&3"`), `  password: "${REDACTED}"`);
  assert.equal(redact(`{"access_token":"${VALUE}.x","expires":3600}`), `{"access_token":"${REDACTED}","expires":3600}`);
  assert.equal(redact(`GITEA_TOKEN = ${VALUE}`), `GITEA_TOKEN = ${REDACTED}`);
  assert.equal(redact('ssh -i ~/.ssh/id_ed25519 -o PasswordAuthentication=no'), `ssh -i ~/.ssh/id_ed25519 -o PasswordAuthentication=${REDACTED}`);
  assert.equal(redact(`pwd=${VALUE}; Passwd:${VALUE}`), `pwd=${REDACTED}; Passwd:${REDACTED}`);
  assert.equal(redact('boot-check.sh: strict mode: unknown keyword "first day of the loan."'), 'boot-check.sh: strict mode: unknown keyword "first day of the loan."');
  assert.equal(redact('Error: connect ECONNREFUSED 127.0.0.1:5432'), 'Error: connect ECONNREFUSED 127.0.0.1:5432');
  assert.equal(redact('    at listTools (api/tools.js:12:9)'), '    at listTools (api/tools.js:12:9)');
  assert.equal(redact(redact(`token=${VALUE}`)), `token=${REDACTED}`, 'redacting twice changes nothing');
  assert.equal(redact(`Authorization: Basic ${VALUE}==`), `Authorization: Basic ${REDACTED}`);
  assert.equal(redact(`git clone https://ghp_${VALUE}@forge.example.test/a.git`), `git clone https://${REDACTED}@forge.example.test/a.git`);
  assert.equal(redact(`using glpat-${VALUE}${VALUE} and ghp_${VALUE}${VALUE}`), `using ${REDACTED} and ${REDACTED}`);
  assert.equal(redact(`cookie eyJ${VALUE}.${VALUE}.${VALUE}`), `cookie ${REDACTED}`);
});

test('ADR-030: a fence in a log line cannot close the json block of task.md', () => {
  assert.deepEqual(redactTail(['```', 'x ```md y']), ["'''", "x '''md y"]);
});

test('ADR-030 redaction: a private-key block, on one line or several, becomes one marker line; the lines around it stay', () => {
  const body = 'b'.repeat(64);
  assert.deepEqual(redactTail(['before', pem('OPENSSH ', 'BEGIN'), body, body.slice(0, 20), pem('OPENSSH ', 'END'), 'after']), ['before', `${REDACTED} private key`, 'after']);
  assert.deepEqual(redactTail([`${pem('RSA ', 'BEGIN')}${body}${pem('RSA ', 'END')}`, 'next']), [`${REDACTED} private key`, 'next']);
  // A block cut by the watcher's bound (no END within the tail): everything after BEGIN is withheld.
  assert.deepEqual(redactTail(['x', pem('', 'BEGIN'), body, body]), ['x', `${REDACTED} private key`]);
});

const check = (check: string, lines: string[], deviations = [`ci:${check}`], round = 1) => ({ round, pipeline: 'ci', check, deviations, log_tail: lines });

test('ADR-030 feedback: one entry per red check that has a tail, under its deviations, redacted; a check without a tail is left out', () => {
  const out = logFeedback([check('image', ['boot: unknown keyword', `registry https://u:${VALUE}@h/`]), check('lint', []), check('acceptance', ['1) list.spec.js'], ['ci:acceptance:list shows the tools', 'ci:acceptance:empty list'])]);
  assert.deepEqual(out, [
    { pipeline: 'ci', check: 'image', deviations: ['ci:image'], log_tail: ['boot: unknown keyword', `registry https://${REDACTED}@h/`] },
    { pipeline: 'ci', check: 'acceptance', deviations: ['ci:acceptance:list shows the tools', 'ci:acceptance:empty list'], log_tail: ['1) list.spec.js'] },
  ]);
  assert.deepEqual(logFeedback([]), []);
});

test('ADR-030 cap: the whole field stays under the cap, the oldest lines of the oldest check dropped first and marked truncated; the newest check keeps its tail', () => {
  const line = (i: number) => `line ${String(i).padStart(3, '0')} ${'x'.repeat(290)}`;
  const tail = Array.from({ length: 40 }, (_, i) => line(i + 1));
  const out = logFeedback([check('image', tail), check('lint', tail), check('acceptance', tail)]);
  assert.ok(JSON.stringify(out).length <= LOG_FEEDBACK_MAX_CHARS, `${JSON.stringify(out).length} > ${LOG_FEEDBACK_MAX_CHARS}`);
  assert.equal(out.length, 3, 'every check keeps its entry (its deviations are still named)');
  assert.deepEqual(out[0]!.log_tail, [], 'oldest check emptied first');
  assert.equal(out[0]!.truncated, true);
  assert.equal(out[1]!.truncated, true);
  assert.ok(out[1]!.log_tail.length > 0 && out[1]!.log_tail[0] !== line(1) && out[1]!.log_tail.at(-1) === line(40), 'the middle check lost its oldest lines, kept its newest');
  assert.deepEqual(out[2]!.log_tail, tail, 'the newest check is whole');
  assert.equal(out[2]!.truncated, undefined);
  assert.ok(JSON.stringify(logFeedback([check('image', tail)])).length <= LOG_FEEDBACK_MAX_CHARS, 'one full tail (40 × 300) fits');
  assert.equal(logFeedback([check('image', tail)])[0]!.truncated, undefined);
});
