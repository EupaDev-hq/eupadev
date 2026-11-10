// Secrets read from `NAME` or `NAME_FILE` (ROADMAP §8.16 M1), never both, never in a message. Without a database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MODELS_BY_ROLE, taskTimeoutMs, readConfig, readSecret } from '../src/config.ts';
import { DEFAULT_THRESHOLDS } from '../src/machine/states.ts';
import { FakeDeployer, FakeForge, FakeEngine } from '../src/external/fakes.ts';
import { SshDeployer } from '../src/external/ssh-deployer.ts';
import { GiteaForge } from '../src/external/gitea-forge.ts';
import { externalWorld } from '../src/external/world.ts';
import { NotificationsSmtp } from '../src/external/smtp-notifications.ts';
import { PushingEngine } from '../src/external/pushing-engine.ts';
import { ClaudeCodeEngine } from '../src/external/claude-engine.ts';

const dir = mkdtempSync(join(tmpdir(), 'secrets-'));
const file = (name: string, content: string) => {
  const path = join(dir, name);
  writeFileSync(path, content, { mode: 0o400 });
  return path;
};
const VALUE = 'secret-test-value';
const OTHERS = { ADMIN_ESCALATION_ADDRESS: 'admin@example.test', TOOL_DOMAIN: 'example.test', DASHBOARD_URL: 'https://t.example.test', OIDC_ISSUER: 'https://auth.example.test/realms/eupadev', OIDC_JWKS_URL: 'http://keycloak:8080/realms/eupadev/protocol/openid-connect/certs' };

test('I0: the IdP is required for the API (issuer, JWKS as an http(s) URL), not for the executor; audience eupadev-api and empty exemption by default', () => {
  const c = readConfig({ ...OTHERS, ORCH_DATABASE_URL: VALUE });
  assert.deepEqual(c.oidc, { issuer: OTHERS.OIDC_ISSUER, jwksUrl: OTHERS.OIDC_JWKS_URL, audience: 'eupadev-api' });
  assert.equal(c.fourEyesExemptionSubject, '');
  assert.equal(readConfig({ ...OTHERS, ORCH_DATABASE_URL: VALUE, OIDC_AUDIENCE: 'other', FOUR_EYES_EXEMPTION_SUBJECT: ' ilan ' }).fourEyesExemptionSubject, 'ilan');
  const { OIDC_ISSUER: _e, ...noIssuer } = OTHERS;
  assert.throws(() => readConfig({ ...noIssuer, ORCH_DATABASE_URL: VALUE }), /OIDC_ISSUER missing/);
  assert.throws(() => readConfig({ ...OTHERS, ORCH_DATABASE_URL: VALUE, OIDC_JWKS_URL: 'keycloak:8080/certs' }), /OIDC_JWKS_URL invalid/);
  assert.throws(() => readConfig({ ...OTHERS, ORCH_DATABASE_URL: VALUE, OIDC_ISSUER: 'ftp://auth' }), /OIDC_ISSUER invalid/);
  assert.equal(readConfig({ ...noIssuer, ORCH_DATABASE_URL: VALUE, OIDC_JWKS_URL: '', EUPADEV_ROLE: 'executor' }).role, 'executor');
});

test('Chat step 2: web sign-in off without OIDC_WEB_CLIENT_ID; with it, the client password and a /auth/callback redirect URL are required, the token endpoint sits beside the JWKS; never for the executor', () => {
  const base = { ...OTHERS, ORCH_DATABASE_URL: VALUE };
  assert.equal(readConfig(base).oidcWeb, null);
  const web = { OIDC_WEB_CLIENT_ID: 'eupadev-web', OIDC_WEB_CLIENT_SECRET: 'x', OIDC_WEB_REDIRECT_URL: 'http://localhost:8080/auth/callback' };
  assert.deepEqual(readConfig({ ...base, ...web }).oidcWeb, { clientId: 'eupadev-web', clientSecret: 'x', redirectUrl: web.OIDC_WEB_REDIRECT_URL, tokenUrl: 'http://keycloak:8080/realms/eupadev/protocol/openid-connect/token' });
  assert.throws(() => readConfig({ ...base, ...web, OIDC_WEB_CLIENT_SECRET: '' }), /OIDC_WEB_CLIENT_SECRET missing/);
  assert.throws(() => readConfig({ ...base, ...web, OIDC_WEB_REDIRECT_URL: 'http://localhost:8080/' }), /OIDC_WEB_REDIRECT_URL invalid/);
  assert.throws(() => readConfig({ ...base, ...web, OIDC_WEB_REDIRECT_URL: 'localhost:8080/auth/callback' }), /OIDC_WEB_REDIRECT_URL invalid/);
  assert.throws(() => readConfig({ ...base, ...web, OIDC_JWKS_URL: 'http://keycloak:8080/jwks' }), /OIDC_JWKS_URL: a Keycloak URL/);
  assert.equal(readConfig({ ...base, ...web, OIDC_ISSUER: '', OIDC_JWKS_URL: '', EUPADEV_ROLE: 'executor' }).oidcWeb, null);
});

test('secret: read from the variable, or from the file without its final line break', () => {
  assert.equal(readSecret({ S: VALUE }, 'S'), VALUE);
  assert.equal(readSecret({ S_FILE: file('lf', `${VALUE}\n`) }, 'S'), VALUE);
  assert.equal(readSecret({ S_FILE: file('crlf', `${VALUE}\r\n`) }, 'S'), VALUE);
  assert.equal(readSecret({ S_FILE: file('raw', VALUE) }, 'S'), VALUE);
  // A single trailing newline removed: the rest of the content is the secret, as is.
  assert.equal(readSecret({ S_FILE: file('two', `${VALUE}\n\n`) }, 'S'), `${VALUE}\n`);
  assert.equal(readConfig({ ...OTHERS, ORCH_DATABASE_URL_FILE: file('config', `${VALUE}\n`) }).databaseUrl, VALUE);
});

test('local API and pause of the agents: safe defaults, checked values', () => {
  const c = readConfig({ ...OTHERS, ORCH_DATABASE_URL: VALUE });
  assert.deepEqual([c.api, c.pauseAgents], [{ address: '127.0.0.1', port: 8080 }, false]);
  assert.equal(readConfig({ ...OTHERS, ORCH_DATABASE_URL: VALUE, PAUSE_AGENTS: '1' }).pauseAgents, true);
  assert.throws(() => readConfig({ ...OTHERS, ORCH_DATABASE_URL: VALUE, PAUSE_AGENTS: 'yes' }), /PAUSE_AGENTS invalid/);
  assert.throws(() => readConfig({ ...OTHERS, ORCH_DATABASE_URL: VALUE, API_PORT: '70000' }), /API_PORT invalid/);
});

test('ADR-028: discovery mode is off by default; on, it refuses a page URL off the loopback and a listen address beyond loopback or 0.0.0.0', () => {
  const base = { ...OTHERS, ORCH_DATABASE_URL: VALUE };
  assert.equal(readConfig(base).discovery, false);
  const local = { ...base, EUPADEV_DISCOVERY: '1', DASHBOARD_URL: 'http://localhost:8080' };
  assert.equal(readConfig(local).discovery, true);
  for (const url of ['http://127.0.0.1:8080', 'http://[::1]:8080', 'http://LOCALHOST']) assert.equal(readConfig({ ...local, DASHBOARD_URL: url }).discovery, true);
  for (const url of ['https://t.example.test', 'http://10.42.0.12:8080', 'http://eupadev.local', 'localhost:8080']) assert.throws(() => readConfig({ ...local, DASHBOARD_URL: url }), /DASHBOARD_URL: a loopback URL/, url);
  for (const address of ['0.0.0.0', '::', '::1', 'localhost']) assert.equal(readConfig({ ...local, API_ADDRESS: address }).api.address, address);
  assert.throws(() => readConfig({ ...local, API_ADDRESS: '10.42.0.12' }), /API_ADDRESS: a loopback address/);
  assert.throws(() => readConfig({ ...base, EUPADEV_DISCOVERY: 'yes' }), /EUPADEV_DISCOVERY invalid/);
  // Not in discovery mode: a public page URL and address stay allowed (the lab, a company).
  assert.equal(readConfig({ ...base, API_ADDRESS: '0.0.0.0' }).api.address, '0.0.0.0');
});

test('role of the process: all-in-one by default, checked value, executor id reserved', () => {
  assert.equal(readConfig({ ...OTHERS, ORCH_DATABASE_URL: VALUE }).role, 'all-in-one');
  assert.equal(readConfig({ ...OTHERS, ORCH_DATABASE_URL: VALUE, EUPADEV_ROLE: 'executor' }).role, 'executor');
  assert.throws(() => readConfig({ ...OTHERS, ORCH_DATABASE_URL: VALUE, EUPADEV_ROLE: 'agents' }), /EUPADEV_ROLE invalid/);
  assert.throws(() => readConfig({ ...OTHERS, ORCH_DATABASE_URL: VALUE, EUPADEV_ROLE: 'pilot', DBOS__VMID: 'agent-executor' }), /reserved for the executor/);
});

test('secret: clear refusal, never the value in the message', () => {
  const noValue = (fn: () => unknown, reason: RegExp) => assert.throws(fn, (e: Error) => reason.test(e.message) && !e.message.includes(VALUE));
  noValue(() => readSecret({ S: VALUE, S_FILE: file('both', VALUE) }, 'S'), /S and S_FILE both given/);
  noValue(() => readSecret({}, 'S'), /S missing/);
  noValue(() => readSecret({ S: '  ' }, 'S'), /S missing/);
  noValue(() => readSecret({ S_FILE: file('empty', '\n') }, 'S'), /S_FILE: empty file/);
  noValue(() => readSecret({ S_FILE: join(dir, 'absent') }, 'S'), /S_FILE unreadable .*ENOENT/);
  noValue(() => readConfig({ ...OTHERS, ORCH_DATABASE_URL: VALUE, ORCH_DATABASE_URL_FILE: file('config2', VALUE) }), /ORCH_DATABASE_URL and ORCH_DATABASE_URL_FILE/);
});

test('E2: EUPADEV_EXTERNAL chooses the real forge, the rest automatic fakes; any other form is refused', () => {
  const all = externalWorld({ EUPADEV_EXTERNAL: 'fake-auto' }, 'example.test');
  assert.ok(all.external.forge instanceof FakeForge);
  const gitea = externalWorld({ EUPADEV_EXTERNAL: 'forge=gitea', FORGE_URL: 'https://git.example.test', FORGE_TOKEN_FILE: file('token', `${VALUE}\n`) }, 'example.test');
  assert.ok(gitea.external.forge instanceof GiteaForge);
  assert.ok(gitea.external.deployer instanceof FakeDeployer && gitea.external.engine instanceof FakeEngine);
  assert.equal(gitea.description, 'forge=gitea; the rest automatic fakes');
  assert.ok(externalWorld({ EUPADEV_EXTERNAL: 'forge=fake-auto' }, 'x').external.forge instanceof FakeForge);
  for (const v of [undefined, '', 'gitea', 'forge=github', 'deployer=gitea', 'forge=gitea,forge=gitea', 'forge=gitea=x', 'mail=smtp', 'constructor=gitea']) {
    assert.throws(() => externalWorld({ EUPADEV_EXTERNAL: v, FORGE_URL: 'https://g.test', FORGE_TOKEN: VALUE }, 'x'), /EUPADEV_EXTERNAL: .* invalid/, String(v));
  }
  assert.throws(() => externalWorld({ EUPADEV_EXTERNAL: 'forge=gitea', FORGE_TOKEN: VALUE }, 'x'), /FORGE_URL missing/);
  assert.throws(() => externalWorld({ EUPADEV_EXTERNAL: 'forge=gitea', FORGE_URL: 'https://g.test' }, 'x'), /FORGE_TOKEN missing/);
});

test('E5d: deployer=ssh only with the real forge, every target address and both key files given', () => {
  const SSH = { FORGE_URL: 'https://git.example.test', FORGE_TOKEN: VALUE, DEPLOYER_HOSTS: 'mockup=10.0.0.11,preview=10.0.0.11,prod=10.0.0.14',
    DEPLOYER_KEY_FILE: '/run/secrets/deployer_key', DEPLOYER_KNOWN_HOSTS_FILE: '/run/secrets/deployer_known_hosts' };
  const m = externalWorld({ ...SSH, EUPADEV_EXTERNAL: 'forge=gitea,deployer=ssh' }, 'x');
  assert.ok(m.external.deployer instanceof SshDeployer && m.external.forge instanceof GiteaForge);
  assert.throws(() => externalWorld({ ...SSH, EUPADEV_EXTERNAL: 'deployer=ssh' }, 'x'), /requires forge=gitea/);
  for (const hosts of ['', 'preview=10.0.0.11,prod=10.0.0.14', 'mockup=10.0.0.11,preview=a b,prod=10.0.0.14']) {
    assert.throws(() => externalWorld({ ...SSH, DEPLOYER_HOSTS: hosts, EUPADEV_EXTERNAL: 'forge=gitea,deployer=ssh' }, 'x'), /DEPLOYER_HOSTS/, hosts);
  }
  assert.throws(() => externalWorld({ ...SSH, DEPLOYER_KEY_FILE: '', EUPADEV_EXTERNAL: 'forge=gitea,deployer=ssh' }, 'x'), /DEPLOYER_KEY_FILE missing/);
});

test('E1: EUPADEV_EXTERNAL chooses the real mails (SMTP_URL or SMTP_URL_FILE, MAIL_FROM), combinable with the real forge', () => {
  const SMTP = { ...OTHERS, ORCH_DATABASE_URL: 'postgres://orch_engine:x@127.0.0.1:1/orchestrator', MAIL_FROM: 'eupadev@example.test' };
  const smtp = externalWorld({ ...SMTP, EUPADEV_EXTERNAL: 'notifications=smtp', SMTP_URL: 'smtp://mailpit:1025' }, 'example.test');
  assert.ok(smtp.external.notifications instanceof NotificationsSmtp);
  assert.ok(smtp.external.forge instanceof FakeForge);
  assert.equal(smtp.description, 'notifications=smtp; the rest automatic fakes');
  const two = externalWorld({ ...SMTP, EUPADEV_EXTERNAL: 'forge=gitea,notifications=smtp', SMTP_URL_FILE: file('smtp', `smtps://u:${VALUE}@relay.example.test:465\n`), FORGE_URL: 'https://g.test', FORGE_TOKEN: VALUE }, 'x');
  assert.ok(two.external.notifications instanceof NotificationsSmtp && two.external.forge instanceof GiteaForge);
  assert.ok(!(externalWorld({ EUPADEV_EXTERNAL: 'fake-auto' }, 'x').external.notifications instanceof NotificationsSmtp));
  const refusal = (variables: Record<string, string>, reason: RegExp) =>
    assert.throws(() => externalWorld({ ...SMTP, EUPADEV_EXTERNAL: 'notifications=smtp', SMTP_URL: 'smtp://mailpit:1025', ...variables }, 'x'), (e: Error) => reason.test(e.message) && !e.message.includes(VALUE));
  refusal({ SMTP_URL: '' }, /SMTP_URL missing/);
  refusal({ SMTP_URL: `http://u:${VALUE}@relay.test` }, /SMTP_URL invalid/);
  refusal({ MAIL_FROM: '' }, /MAIL_FROM invalid/);
  refusal({ ADMIN_ESCALATION_ADDRESS: 'admin' }, /ADMIN_ESCALATION_ADDRESS invalid/);
  assert.throws(() => externalWorld({ EUPADEV_EXTERNAL: 'notifications=mail' }, 'x'), /EUPADEV_EXTERNAL: .* invalid/);
});

test('E3: EUPADEV_EXTERNAL=engine=pushing chooses the pushing fake (svc-agent token), alone or with the real forge', () => {
  const pushing = externalWorld({ EUPADEV_EXTERNAL: 'forge=gitea,engine=pushing', FORGE_URL: 'https://forge.example.test', FORGE_TOKEN: VALUE, AGENT_TOKEN_FILE: file('agent', `${VALUE}-agent\n`) }, 'x');
  assert.ok(pushing.external.engine instanceof PushingEngine && pushing.external.forge instanceof GiteaForge);
  assert.equal(pushing.description, 'forge=gitea, engine=pushing; the rest automatic fakes');
  assert.ok(externalWorld({ EUPADEV_EXTERNAL: 'engine=pushing', FORGE_URL: 'https://forge.example.test', AGENT_TOKEN: VALUE }, 'x').external.forge instanceof FakeForge);
  assert.throws(() => externalWorld({ EUPADEV_EXTERNAL: 'engine=pushing', AGENT_TOKEN: VALUE }, 'x'), /FORGE_URL missing \(engine=pushing\)/);
  assert.throws(() => externalWorld({ EUPADEV_EXTERNAL: 'engine=pushing', FORGE_URL: 'https://forge.example.test', FORGE_TOKEN: VALUE }, 'x'), /AGENT_TOKEN missing/);
  assert.throws(() => externalWorld({ EUPADEV_EXTERNAL: 'engine=openhands', FORGE_URL: 'https://forge.example.test', AGENT_TOKEN: VALUE }, 'x'), /invalid/);
});

test('E4: EUPADEV_EXTERNAL=engine=claude chooses Claude Code (svc-agent token, image by digest), the rest fakes', () => {
  const image = `registry.example.test/eupadev/agent@sha256:${'a'.repeat(64)}`;
  const base = { EUPADEV_EXTERNAL: 'engine=claude', FORGE_URL: 'https://git.example.test', AGENT_FORGE_TOKEN_FILE: file('agent-token', `${VALUE}\n`), AGENT_IMAGE: image, AGENT_COSIGN_PUB: '/etc/eupadev/cosign.pub' };
  const m = externalWorld(base, 'x');
  assert.ok(m.external.engine instanceof ClaudeCodeEngine && m.external.forge instanceof FakeForge);
  assert.equal(m.description, 'engine=claude; the rest automatic fakes');
  const withFields = (fields: Record<string, string>) => () => externalWorld(Object.assign({}, base, fields), 'x');
  assert.throws(withFields({ AGENT_IMAGE: '' }), /AGENT_IMAGE missing/);
  assert.throws(withFields({ AGENT_IMAGE: 'registry.example.test/eupadev/agent:2.1' }), /by digest/);
  assert.throws(withFields({ FORGE_URL: '' }), /FORGE_URL missing/);
  assert.throws(withFields({ AGENT_COSIGN_PUB: '' }), /AGENT_COSIGN_PUB missing/);
  assert.throws(withFields({ AGENT_FORGE_TOKEN_FILE: '' }), /AGENT_FORGE_TOKEN missing/);
  assert.throws(withFields({ EUPADEV_EXTERNAL: 'engine=openhands' }), /invalid/);
});

test('A-R5: caps per role (provisional, measurement pass) — each role has its own, 60 min / 150 turns / $10; phases 240 min; 10 + 40 = $50 per cycle', () => {
  const { task, scoping, hardening } = DEFAULT_THRESHOLDS;
  assert.deepEqual(Object.keys(task).sort(), Object.keys(MODELS_BY_ROLE).sort(), 'one cap line per role');
  // Scoping roles: $4, under the $10 envelope (a lost task does not exhaust it); the others: $10.
  for (const [role, p] of Object.entries(task)) if (role !== 'diagnosis') assert.deepEqual(p, { duration_min: 60, turns: 150, budget_usd: ['overlap', 'scoping'].includes(role) ? 4 : 10 }, role);
  // ADR-027: one short read-only pass, small cap.
  assert.deepEqual(task.diagnosis, { duration_min: 15, turns: 25, budget_usd: 2 });
  assert.ok(task.overlap.budget_usd < scoping.budget_usd && task.scoping.budget_usd < scoping.budget_usd);
  assert.equal(scoping.agent_work_duration_min, 240);
  assert.equal(hardening.agent_work_duration_min, 240);
  assert.equal(scoping.budget_usd, 10);
  assert.equal(hardening.budget_usd, 40);
});

test('A-R5: a task\'s duration is its role\'s, except TASK_TIMEOUT_MS (tests, lab) which imposes it on all', () => {
  assert.equal(readConfig({ ...OTHERS, ORCH_DATABASE_URL: VALUE }).timeouts.task_ms, null);
  assert.equal(readConfig({ ...OTHERS, ORCH_DATABASE_URL: VALUE, TASK_TIMEOUT_MS: '1500' }).timeouts.task_ms, 1500);
  assert.throws(() => readConfig({ ...OTHERS, ORCH_DATABASE_URL: VALUE, TASK_TIMEOUT_MS: '0' }), /TASK_TIMEOUT_MS invalid/);
  const without = readConfig({ ...OTHERS, ORCH_DATABASE_URL: VALUE }).timeouts;
  assert.equal(taskTimeoutMs(without, { duration_min: 60 }), 3_600_000);
  assert.equal(taskTimeoutMs(without, { duration_min: 7 }), 420_000, 'the given role\'s duration, not a single value');
  assert.equal(taskTimeoutMs({ ...without, task_ms: 1500 }, { duration_min: 60 }), 1500);
});

test('A-R5: table of the starting models — overlap Haiku 5.5 medium, scoping Sonnet 5.5 medium, contract Opus 5.5 high; Fable nowhere (escalation only)', () => {
  assert.deepEqual(MODELS_BY_ROLE, {
    overlap: { model: 'claude-haiku-5-5', effort: 'medium' },
    scoping: { model: 'claude-sonnet-5-5', effort: 'medium' },
    contract: { model: 'claude-opus-5-5', effort: 'high' },
    tests: { model: 'claude-opus-5-5', effort: 'medium' },
    builder: { model: 'claude-opus-5-5', effort: 'medium' },
    'security-reviewer': { model: 'claude-opus-5-5', effort: 'high' },
    'quality-reviewer': { model: 'claude-opus-5-5', effort: 'high' },
    diagnosis: { model: 'claude-sonnet-5-5', effort: 'medium' },
  });
  assert.ok(Object.values(MODELS_BY_ROLE).every((m) => !m.model.includes('fable')));
});
