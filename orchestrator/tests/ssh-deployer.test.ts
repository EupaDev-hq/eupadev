// Real deployer adapter (E5d) against a FAKE `ssh` binary put first on PATH: it records its arguments and plays the
// answers of the target script (exit code + one JSON line) given by the test, one per call. No network, no VM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SshDeployer, DeployerError } from '../src/external/ssh-deployer.ts';

const DIR = mkdtempSync(join(tmpdir(), 'fake-ssh-'));
const ANSWERS = join(DIR, 'answers.json');
const CALLS = join(DIR, 'calls.jsonl');
writeFileSync(join(DIR, 'ssh'), `#!/usr/bin/env node
const fs = require('node:fs');
const input = fs.readFileSync(0);
const sha = input.length ? require('node:crypto').createHash('sha256').update(input).digest('hex') : '';
fs.appendFileSync(${JSON.stringify(CALLS)}, JSON.stringify([...process.argv.slice(2), 'stdin:' + sha]) + '\\n');
const answers = JSON.parse(fs.readFileSync(${JSON.stringify(ANSWERS)}, 'utf8'));
const r = answers.shift() ?? { code: 99, output: '' };
fs.writeFileSync(${JSON.stringify(ANSWERS)}, JSON.stringify(answers));
process.stdout.write(r.output + '\\n');
process.exit(r.code);
`);
chmodSync(join(DIR, 'ssh'), 0o755);
process.env['PATH'] = `${DIR}:${process.env['PATH']}`;

const EMP = `sha256:${'a'.repeat(64)}`;
const SERVED = `sha256:${'b'.repeat(64)}`;
const HOSTS = { mockup: '10.0.0.11', preview: '10.0.0.11', prod: '10.0.0.14' };
const deployer = () => new SshDeployer({ hosts: HOSTS, key: '/run/secrets/key', knownHosts: '/run/secrets/kh', registry: 'git.example.test', pauseMs: 1 });

/** Answers of the fake target for the next calls; returns the reader of the recorded argv. */
function target(...answers: { code: number; output: unknown }[]): () => string[][] {
  writeFileSync(ANSWERS, JSON.stringify(answers.map((r) => ({ code: r.code, output: JSON.stringify(r.output) }))));
  writeFileSync(CALLS, '');
  // The last element of each call is the sha256 of what the fake read on stdin ('stdin:' when nothing).
  return () => readFileSync(CALLS, 'utf8').trim().split('\n').filter((l) => l !== '').map((l) => (JSON.parse(l) as string[]).slice(0, -1));
}

test('E5d SshDeployer: deploy → one forced-command line, strict host keys, served digest returned (not the requested one)', async () => {
  const calls = target({ code: 0, output: { digest: SERVED, url: 'https://leave.preview.example.test', health: 'ok' } });
  const r = await deployer().deploy('preview', 'leave', 4, EMP);
  assert.deepEqual(r, { digest: SERVED, url: 'https://leave.preview.example.test', health: 'ok' });
  assert.deepEqual(calls(), [['-i', '/run/secrets/key', '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=yes',
    '-o', 'UserKnownHostsFile=/run/secrets/kh', '-o', 'ConnectTimeout=20', 'deployment@10.0.0.11',
    `deploy preview leave 4 git.example.test/eupadev/leave@${EMP}`]]);
});

test('E5d SshDeployer: refusal by the target (code 2) → failed with the reason, never retried', async () => {
  const calls = target({ code: 2, output: { refusal: 'signature refused' } }, { code: 0, output: { digest: EMP, url: 'u', health: 'ok' } });
  const r = await deployer().deploy('preview', 'leave', 4, EMP);
  assert.equal(r.health, 'failed');
  assert.equal(r.digest, EMP);
  assert.match(r.reason ?? '', /signature refused/);
  assert.equal(calls().length, 1);
});

test('E5d SshDeployer: ssh failure (255) retried within bounds, then an error; script error (1) not retried', async () => {
  let calls = target({ code: 255, output: '' }, { code: 255, output: '' }, { code: 0, output: { digest: EMP, url: 'u', health: 'ok' } });
  assert.equal((await deployer().deploy('prod', 'leave', 4, EMP)).health, 'ok');
  assert.equal(calls().length, 3);
  assert.equal(calls()[0]?.at(-2), 'deployment@10.0.0.14');
  calls = target({ code: 255, output: '' }, { code: 255, output: '' }, { code: 255, output: '' }, { code: 0, output: null });
  await assert.rejects(deployer().served('preview', 'leave'), (e: unknown) => e instanceof DeployerError && /code 255 after 3/.test(e.message));
  calls = target({ code: 1, output: { error: 'docker pull: timeout' } }, { code: 0, output: null });
  await assert.rejects(deployer().remove('preview', 'leave', 4), /docker pull: timeout/);
  assert.equal(calls().length, 1);
});

test('E5d SshDeployer: no digest or a malformed one → failed without any call', async () => {
  const calls = target();
  for (const e of [null, 'latest', `${EMP} ; id`]) assert.equal((await deployer().deploy('preview', 'leave', 4, e)).health, 'failed');
  assert.equal(calls().length, 0);
});

test('E5d SshDeployer: served, remove, stop read the script answers', async () => {
  let calls = target({ code: 0, output: null }, { code: 0, output: { digest: SERVED, cycle: 7 } }, { code: 0, output: { digest: null, cycle: 7 } });
  const d = deployer();
  assert.equal(await d.served('preview', 'leave'), null);
  assert.deepEqual(await d.served('preview', 'leave'), { digest: SERVED, cycleId: 7 });
  assert.deepEqual(await d.served('preview', 'leave'), { digest: 'unknown', cycleId: 7 });
  assert.equal(calls()[0]?.at(-1), 'served preview leave');
  calls = target({ code: 0, output: { done: false, reason: 'held by cycle 3' } }, { code: 0, output: { done: true } }, { code: 2, output: { refusal: 'reserved name' } });
  await d.remove('preview', 'leave', 4); // another cycle's: no effect, not an error (G4)
  await d.stop('mockup', 'leave', 4);
  await assert.rejects(d.remove('preview', 'git', 4), /refused by the target: reserved name/);
  assert.deepEqual(calls().map((a) => a.at(-1)), ['remove preview leave 4', 'stop mockup leave 4', 'remove preview git 4']);
});

test('E5d SshDeployer: cancellation stops the call', async () => {
  target({ code: 255, output: '' }, { code: 255, output: '' });
  const slow = new SshDeployer({ hosts: HOSTS, key: 'c', knownHosts: 'k', registry: 'r', pauseMs: 60_000 });
  const stop = new AbortController();
  const call = slow.deploy('preview', 'leave', 4, EMP, stop.signal);
  setTimeout(() => stop.abort(new Error('cancelled')), 200);
  await assert.rejects(call, /cancelled|aborted/);
});

test('E5e SshDeployer: mock-up → the scoping archive on stdin, its sha256 in the line; a refusal is a failure', async () => {
  const archive = Buffer.from('archive of the scoping commit');
  const sha = createHash('sha256').update(archive).digest('hex');
  const withArchive = new SshDeployer({ hosts: HOSTS, key: 'c', knownHosts: 'k', registry: 'r', pauseMs: 1, archive: async () => archive });
  target({ code: 0, output: { digest: `sha256:${sha}`, url: `https://mockup.example.test/${sha}/`, health: 'ok' } },
    { code: 2, output: { refusal: 'archive digest differs from the requested one' } });
  assert.deepEqual(await withArchive.deploy('mockup', 'leave', 4, null), { digest: `sha256:${sha}`, url: `https://mockup.example.test/${sha}/`, health: 'ok' });
  const lines = readFileSync(CALLS, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as string[]);
  assert.deepEqual(lines[0]?.slice(-3), ['deployment@10.0.0.11', `deploy mockup leave 4 ${sha}`, `stdin:${sha}`]);
  const refusal = await withArchive.deploy('mockup', 'leave', 4, null);
  assert.equal(refusal.health, 'failed');
  assert.match(refusal.reason ?? '', /archive digest differs/);
  assert.equal((await deployer().deploy('mockup', 'leave', 4, null)).health, 'failed'); // no forge: nothing asked
});
