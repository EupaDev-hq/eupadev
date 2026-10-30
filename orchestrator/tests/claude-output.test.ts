// Claude Code engine (E4): reading the documented JSON output, container frame, options per role. Without Docker.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { budgetClaude, contentRefused, CLAUDE_LINE, readFrame, readClaudeResult, roleOptions, schemaDraft07 } from '../src/external/claude-engine.ts';

const result = (fields: Record<string, unknown>) => JSON.stringify({
  type: 'result', subtype: 'success', is_error: false, num_turns: 4, total_cost_usd: 1.25,
  usage: { input_tokens: 7, output_tokens: 3, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  modelUsage: { a: { inputTokens: 100, outputTokens: 20, cacheReadInputTokens: 1000, cacheCreationInputTokens: 50 }, b: { inputTokens: 10, outputTokens: 2, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } },
  structured_output: { status: 'done' }, ...fields,
});

test('E4 claude output: success → structured report, cost, tokens of every model (cache included)', () => {
  assert.deepEqual(readClaudeResult(result({}), 0), { report: { status: 'done' }, cost_usd: 1.25, tokens: { input: 1160, output: 22 } });
  // Without modelUsage: usage of the main turn.
  assert.deepEqual(readClaudeResult(result({ modelUsage: {} }), 0).tokens, { input: 7, output: 3 });
  // Unreadable tokens: absent (the database keeps its value), never wrong.
  assert.equal(readClaudeResult(result({ modelUsage: { a: { inputTokens: -1, outputTokens: 2 } } }), 0).tokens, undefined);
});

test('E4 claude output: documented stops → no report, reason read, cost kept', () => {
  const turns = readClaudeResult(result({ subtype: 'error_max_turns', is_error: true, structured_output: undefined }), 1);
  assert.equal(turns.report, null);
  assert.match(turns.error ?? '', /turns cap reached \(error_max_turns, 4 turns, code 1\)/);
  assert.equal(turns.cost_usd, 1.25);
  const budget = readClaudeResult(result({ subtype: 'error_max_budget_usd', is_error: true, structured_output: { status: 'done' } }), 1);
  assert.equal(budget.report, null, 'a report present in an error output does not count');
  assert.match(budget.error ?? '', /budget cap reached/);
  // Success announced but a non-zero exit code, or is_error: no report.
  assert.equal(readClaudeResult(result({}), 1).report, null);
  assert.equal(readClaudeResult(result({ is_error: true }), 0).report, null);
  assert.match(readClaudeResult(result({ structured_output: undefined }), 0).error ?? '', /without a structured report/);
});

test('E4 claude output: unreadable output → unknown cost (W2 counts the cap)', () => {
  for (const text of ['', 'Error: not JSON', '[]', '{"type":"assistant"}']) {
    const l = readClaudeResult(text, 1);
    assert.equal(l.report, null);
    assert.equal(l.cost_usd, null, text);
    assert.match(l.error ?? '', /unreadable/);
  }
  assert.equal(readClaudeResult(result({ total_cost_usd: -1 }), 0).cost_usd, null);
  assert.equal(readClaudeResult(result({ total_cost_usd: '0.1' }), 0).cost_usd, null);
});

test('E4 claude frame: the last line of each field counts; incomplete frame = null', () => {
  const b = (s: string) => Buffer.from(s).toString('base64');
  const output = `noise\nEUPADEV-CODE 9\nEUPADEV-RESULT ${b('fake')}\n\nEUPADEV-CODE 0\nEUPADEV-RESULT ${b('{"a":1}')}\nEUPADEV-ERRORS \nEUPADEV-BUNDLE ${b('PACK')}\n`;
  assert.deepEqual(readFrame(output), { code: 0, result: '{"a":1}', bundle: Buffer.from('PACK'), errors: '' });
  assert.equal(readFrame(`EUPADEV-CODE 0\nEUPADEV-RESULT ${b('x')}\n`), null, 'no bundle: container cut off before the end');
  assert.equal(readFrame(''), null);
});

test('E4 claude options: reviewers and overlap read-only; code roles with Bash and Edit allowed; never bypassPermissions; budget with a margin', () => {
  // --bare only exposes Bash, Read and Edit (headless docs; trial against the fake upstream on 2026-10-15): the lists state what exists.
  for (const r of ['builder', 'tests'] as const) assert.deepEqual(roleOptions(r), { tools: 'Bash,Read,Edit', permissions: 'Bash Edit' });
  // A-R4 (ADR-020): reviewers have Bash without an allow rule (dontAsk read-only set); overlap keeps Read alone.
  for (const r of ['security-reviewer', 'quality-reviewer'] as const) assert.deepEqual(roleOptions(r), { tools: 'Bash,Read', permissions: '' });
  assert.deepEqual(roleOptions('overlap'), { tools: 'Read', permissions: '' });
  assert.match(CLAUDE_LINE, /^claude --bare --restricted -p /);
  assert.match(CLAUDE_LINE, /--permission-mode dontAsk /);
  assert.match(CLAUDE_LINE, /--allowedTools 'Read\(\/\/tmp\/task\/\*\*\)' \$FA_PERMISSIONS --add-dir \/tmp\/task --strict-mcp-config /);
  assert.ok(!/bypass|dangerously/i.test(CLAUDE_LINE));
  assert.equal(budgetClaude(3), '2.50');
  assert.equal(budgetClaude(0.05), '0.04');
});

test('E4 claude schema: converted to draft-07 for --json-schema, same verdict as Ajv 2020 on the reference schema; a 2020-only keyword refused', async () => {
  const { readFileSync } = await import('node:fs');
  const { Ajv } = await import('ajv');
  const { Ajv2020 } = await import('ajv/dist/2020.js');
  const { compliantReport, reportWithDeviations } = await import('../src/external/fakes.ts');
  const reference = readFileSync(new URL('../../tool-template/agents/report.schema.json', import.meta.url), 'utf8');
  const converted = JSON.parse(schemaDraft07(reference)) as Record<string, unknown>;
  assert.equal(converted['$schema'], 'http://json-schema.org/draft-07/schema#');
  assert.ok(!JSON.stringify(converted).includes('#/$defs/') && !('$defs' in converted), 'no more $defs nor a reference to it');
  const v07 = new Ajv({ allErrors: true, strict: true }).compile(converted);
  const v20 = new Ajv2020({ allErrors: true, strict: true }).compile(JSON.parse(reference));
  const deviation = { rule: 'SEC-IDOR', category: 'authz', file: 'api/x.js', severity: 'high', message: 'm' };
  const cases: unknown[] = [
    compliantReport('builder', 't-1'), compliantReport('security-reviewer', 't-2'),
    reportWithDeviations('security-reviewer', 't-3', [deviation as never]),
    { ...compliantReport('builder', 't-4'), status: 'unknown' }, { ...compliantReport('builder', 't-5'), extra_field: 1 }, {},
    reportWithDeviations('security-reviewer', 't-6', [{ ...deviation, rule: 'NOT-IN-LIST' } as never]),
  ];
  for (const c of cases) assert.equal(v07(c), v20(c), JSON.stringify(c).slice(0, 120));
  assert.ok(v07(cases[0]) && !v07(cases[5]), 'the set holds valid and invalid reports');
  assert.throws(() => schemaDraft07('{"$schema":"https://json-schema.org/draft/2020-12/schema","prefixItems":[]}'), /prefixItems/);
  assert.throws(() => schemaDraft07('{"$schema":"http://json-schema.org/draft-04/schema#"}'), /unexpected version/);
});

test('ADR-021 report schema: role = the roles the engine launches, owner_role = the roles that fix; backend and frontend refused', async () => {
  const { readFileSync } = await import('node:fs');
  const { Ajv2020 } = await import('ajv/dist/2020.js');
  const { ROLES } = await import('../src/agent-engine/instructions.ts');
  const { compliantReport, reportWithDeviations } = await import('../src/external/fakes.ts');
  const schema = JSON.parse(readFileSync(new URL('../../tool-template/agents/report.schema.json', import.meta.url), 'utf8'));
  assert.deepEqual([...schema.properties.role.enum].sort(), [...ROLES].sort());
  assert.deepEqual([...schema.properties.findings.items.properties.owner_role.enum].sort(), ['builder', 'contract', 'tests']);
  const v = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
  const deviation = { rule: 'SEC-IDOR', file: 'api/x.js' };
  assert.ok(v(reportWithDeviations('security-reviewer', 't-1', [deviation])), 'valid witness');
  for (const old of ['backend', 'frontend', 'integration']) {
    assert.ok(!v({ ...compliantReport('builder', 't-2'), role: old }), `role ${old}`);
    const r = reportWithDeviations('security-reviewer', 't-3', [deviation]);
    assert.ok(!v({ ...r, findings: r.findings.map((f) => ({ ...f, owner_role: old })) }), `owner_role ${old}`);
  }
});

test('E4 claude check: images/agent/check/ and managed-settings.json match the engine (command line, converted schema, forbidden paths)', async () => {
  const { readFileSync } = await import('node:fs');
  const { DIR, IMAGE_DIR, generateCheck, managedSettings } = await import('../scripts/generate-claude-check.ts');
  const { managedDenyRules } = await import('../src/agent-engine/forbidden-paths.ts');
  for (const [name, text] of Object.entries(generateCheck())) {
    assert.equal(readFileSync(new URL(name, DIR), 'utf8'), text, `run again: node scripts/generate-claude-check.ts (${name})`);
  }
  assert.equal(readFileSync(new URL('managed-settings.json', IMAGE_DIR), 'utf8'), managedSettings(), 'run again: node scripts/generate-claude-check.ts (managed-settings.json)');
  assert.ok(generateCheck()['claude.sh'].includes(CLAUDE_LINE));
  const m = JSON.parse(managedSettings()) as { permissions: { deny: string[]; allow: string[]; disableBypassPermissionsMode: string }; disableAllHooks: boolean; allowManagedHooksOnly: boolean; env: Record<string, string> };
  assert.deepEqual(m.permissions.deny, managedDenyRules());
  assert.ok(m.permissions.deny.includes('Edit(**/.claude/**)') && m.permissions.deny.includes('Edit(.npmrc)') && m.permissions.deny.includes('Edit(**/.pnpmfile.cjs)'));
  assert.ok(['Edit(Dockerfile)', 'Edit(**/Dockerfile)', 'Edit(.dockerignore)', 'Edit(**/.pnpmfile.mjs)'].every((r) => m.permissions.deny.includes(r)), 'A-R0 in the managed settings');
  assert.deepEqual(m.permissions.allow, ['Read(//tmp/task/**)']);
  assert.equal(m.permissions.disableBypassPermissionsMode, 'disable');
  assert.ok(m.disableAllHooks && m.allowManagedHooksOnly);
  assert.equal(m.env['CLAUDE_CODE_DISABLE_CLAUDE_MDS'], '1');
});

test('E4 claude content: refusal of a forbidden path, out of scope, symbolic link, submodule, invisible name; accepted otherwise', () => {
  const line = (mode: string, path: string, status = 'A') => `:000000 ${mode} 0000000000000000000000000000000000000000 1111111111111111111111111111111111111111 ${status}\0${path}\0`;
  const ok = line('100644', 'api/ping.js') + line('100644', 'db/0001_ping.sql') + line('100644', 'web/app.js') + line('100644', 'tests/unit/ping.test.js') + line('100644', 'package.json', 'M');
  assert.equal(contentRefused('builder', ok), null);
  assert.equal(contentRefused('builder', ''), null);
  // A-R0: the image belongs to the platform, even for the roles that write everywhere.
  assert.match(contentRefused('builder', ok + line('100644', 'Dockerfile', 'M')) ?? '', /forbidden path "Dockerfile"/);
  assert.match(contentRefused('scoping', line('100644', '.dockerignore')) ?? '', /forbidden path "\.dockerignore"/);
  assert.match(contentRefused('scoping', line('100644', '.pnpmfile.mjs')) ?? '', /forbidden path "\.pnpmfile\.mjs"/);
  assert.match(contentRefused('builder', ok + line('100644', '.claude/settings.json')) ?? '', /forbidden path "\.claude\/settings\.json"/);
  assert.match(contentRefused('builder', line('100644', 'api/.npmrc')) ?? '', /forbidden path "api\/\.npmrc"/);
  assert.match(contentRefused('scoping', line('000000', 'AGENTS.md', 'D')) ?? '', /forbidden path "AGENTS\.md"/, 'a deletion counts too');
  // ADR-021: the builder never touches the acceptance suite; the tests role writes only that.
  assert.match(contentRefused('builder', line('100644', 'tests/acceptance/stolen.js')) ?? '', /outside the scope of role builder "tests\/acceptance\/stolen\.js"/);
  assert.match(contentRefused('builder', line('100644', 'tests/other/x.js')) ?? '', /outside the scope of role builder/);
  assert.match(contentRefused('tests', line('100644', 'api/x.js')) ?? '', /outside the scope of role tests/);
  assert.match(contentRefused('tests', line('100644', 'tests/unit/x.js')) ?? '', /outside the scope of role tests/);
  assert.equal(contentRefused('tests', line('100644', 'tests/acceptance/security/x.spec.js')), null);
  assert.equal(contentRefused('contract', line('100644', 'openapi.yaml') + line('100644', 'tests/acceptance/features/a.feature')), null);
  assert.match(contentRefused('contract', line('100644', 'api/x.js')) ?? '', /outside the scope of role contract/);
  assert.equal(contentRefused('scoping', line('100644', 'web/index.html') + line('100644', 'docs/spec.md')), null);
  assert.match(contentRefused('security-reviewer', line('100644', 'README.md')) ?? '', /outside the scope of role security-reviewer/);
  assert.match(contentRefused('builder', line('120000', 'api/link')) ?? '', /symbolic link "api\/link"/);
  assert.match(contentRefused('scoping', line('160000', 'vendor/x')) ?? '', /submodule "vendor\/x"/);
  assert.match(contentRefused('builder', line('100644', `api/a${String.fromCodePoint(0x200b)}b.js`)) ?? '', /invisible or control character "api\/a.b\.js" \(U\+200B/);
  assert.match(contentRefused('builder', line('100644', `api/x${String.fromCodePoint(0x202e)}sj.js`)) ?? '', /U\+202E/);
});
