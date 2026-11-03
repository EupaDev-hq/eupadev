// Verdict of the upstream trial: reads log-<role>.jsonl (requests received by the upstream and by the attacker) and
// agent-<role>.log (what trial.sh printed), prints what settles the open questions of the trial, fails
// (exit code 1) if a deterministic assertion falls. Usage: node verify.mjs <output directory>
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] ?? '/tmp/upstream-trial';
const CANARIES = ['CANARY_PROJECT_SETTINGS', 'CANARY_CLAUDE_MD', 'CANARY_AGENTS_MD', 'CANARY_PATHS_RULE', 'CANARY_USER_SETTINGS', 'CANARY_USER_CLAUDE_MD', 'CANARY_MCP'];
let failures = 0;
let witness = false; // witness pass: observed, nothing required
const verify = (ok, what) => { console.log(`${ok ? 'OK    ' : witness ? 'seen  ' : 'FAILED'} ${what}`); if (!ok && !witness) failures += 1; };

function read(role) {
  const log = readFileSync(join(dir, `log-${role}.jsonl`), 'utf8').split('\n').filter((l) => l !== '').map((l) => JSON.parse(l));
  const output = readFileSync(join(dir, `agent-${role}.log`), 'utf8');
  return { log, output };
}

/** Tool results received by the upstream, in turn order: [{ id, is_error, text }]. */
function toolResults(messages) {
  const seen = new Map();
  for (const r of messages) {
    for (const m of r.body?.messages ?? []) {
      if (m.role !== 'user' || !Array.isArray(m.content)) continue;
      for (const c of m.content) {
        if (c.type === 'tool_result' && !seen.has(c.tool_use_id)) {
          const text = typeof c.content === 'string' ? c.content : (c.content ?? []).map((x) => x.text ?? '').join(' ');
          seen.set(c.tool_use_id, { id: c.tool_use_id, is_error: c.is_error === true, text: text.replace(/\s+/g, ' ').slice(0, 220) });
        }
      }
    }
  }
  return [...seen.values()];
}

const VARIANTS = (process.argv[3] || 'code read reviewer code-no-restricted code-no-bare code-tools-spaces code-no-tools code-no-read-rule code-no-add-dir').split(' ');
for (const role of VARIANTS) {
  witness = !['code', 'read', 'reviewer'].includes(role);
  const { log, output } = read(role);
  console.log(`\n=== role ${role}: ${log.length} request(s) received`);
  const upstream = log.filter((r) => r.port === 8080);
  const attacker = log.filter((r) => r.port === 8081);
  const messages = upstream.filter((r) => r.method === 'POST' && String(r.path).startsWith('/v1/messages') && !String(r.path).includes('count_tokens'));
  console.log(`paths: ${[...new Set(log.map((r) => `${r.port} ${r.method} ${r.path}`))].join(' | ')}`);
  console.log(`user-agent: ${upstream[0]?.headers?.['user-agent'] ?? '?'}; x-api-key: ${upstream[0]?.headers?.['x-api-key'] ?? '?'}`);
  verify(messages.length > 0, `${role}: Claude Code called the upstream (${messages.length} turns)`);
  verify(attacker.length === 0, `${role}: the attacker (env block of the project and user settings) received no request (${attacker.length})`);
  const all = JSON.stringify(log);
  for (const c of CANARIES) verify(!all.includes(c), `${role}: no canary "${c}" in any request (CLAUDE.md, AGENTS.md, paths: rule, project and user settings, .mcp.json)`);
  const first = messages[0]?.body ?? {};
  const system = JSON.stringify(first.system ?? '');
  verify(system.includes('UPSTREAM-TRIAL-INSTRUCTIONS'), `${role}: the system prompt contains the instructions of /tmp/task/instructions.md`);
  const tools = (first.tools ?? []).map((t) => t.name);
  console.log(`tools[]: ${tools.join(',')}`);
  if (role.startsWith('code')) {
    for (const o of ['Bash', 'Edit', 'Read']) verify(tools.includes(o), `code: tool ${o} exposed`);
    for (const o of ['Write', 'Glob', 'Grep']) verify(!tools.includes(o), `code: tool ${o} absent (--bare exposes only Bash, Read, Edit — headless documentation)`);
  } else if (role.startsWith('reviewer')) {
    for (const o of ['Bash', 'Read']) verify(tools.includes(o), `reviewer: tool ${o} exposed`);
    for (const o of ['Edit', 'Write', 'Glob', 'Grep', 'WebFetch', 'WebSearch']) verify(!tools.includes(o), `reviewer: tool ${o} absent`);
  } else {
    for (const o of ['Bash', 'Edit', 'Write', 'Glob', 'Grep', 'WebFetch', 'WebSearch']) verify(!tools.includes(o), `read: tool ${o} absent`);
    verify(tools.includes('Read'), 'read: tool Read exposed');
  }
  verify(!tools.includes('WebFetch') && !tools.includes('WebSearch'), `${role}: neither WebFetch nor WebSearch`);
  const results = toolResults(messages);
  results.forEach((r, i) => console.log(`turn ${i + 1} (${r.id}) ${r.is_error ? 'REFUSED/ERROR' : 'ok'}: ${r.text}`));
  const lines = output.split('\n').filter((l) => l.startsWith('==='));
  console.log(lines.join('\n'));
  if (role.startsWith('code')) {
    // Turns scripted by upstream.js: 1 Read task.md; 2 Write .claude/settings.json; 3 Bash > api/y.js; 4 Bash > .claude/a;
    // 5 Bash ~/.claude/settings.json; 6 Edit .claude/settings.json; 7 node -e .claude/c; 8 Read api/x.js; 9 pnpm; 10 state; 11 Edit api/x.js.
    verify(results[0] !== undefined && !results[0].is_error && results[0].text.includes('TRIAL-TASK-DATA'), 'code: Read /tmp/task/task.md succeeds (data read)');
    verify(results[1]?.is_error === true, 'code: Write .claude/settings.json in error (tool absent under --bare)');
    verify(results[2] !== undefined && !results[2].is_error && results[2].text.includes('API_WRITTEN'), 'code: Bash creates api/y.js (new file in scope) — normal work goes through');
    verify(results[3]?.is_error === true || output.includes('.claude/a=absent'), 'code: Bash "echo x > .claude/a" refused or without effect');
    verify(results[5]?.is_error === true && /denied|refused|refusal/i.test(results[5].text), 'code: Edit .claude/settings.json refused (deny of the managed settings / protected path in dontAsk)');
    verify(results[10] !== undefined && !results[10].is_error, 'code: Edit api/x.js accepted (Edit serves normal work)');
    verify(output.includes('HOOK=absent'), 'code: SessionStart hook of the project settings never run');
    verify(output.includes('HOOK_USER=absent'), 'code: SessionStart hook of the user settings never run');
    verify(output.includes('MCP=absent'), 'code: MCP server of .mcp.json never started');
    verify(output.includes('.claude/a=absent') && output.includes('ATTACKER'), 'code: .claude/a absent, project settings intact');
    verify(results[7] !== undefined && !results[7].is_error, 'code: Read api/x.js (paths: api/** rule) succeeds…');
    const afterRule = messages.slice(9).map((m) => JSON.stringify(m.body)).join('');
    verify(!afterRule.includes('CANARY_PATHS_RULE'), '…and the on-demand rule is not injected afterwards');
    console.log(`info: .claude/c (node -e, allowed Bash): ${/\.claude\/c=(\w+)/.exec(output)?.[1] ?? '?'} — the launcher refuses this case (contentRefused)`);
    console.log(`info: .pnpmfile.cjs under pnpm install --ignore-scripts: PNPMFILE=${/PNPMFILE=(\w+)/.exec(output)?.[1] ?? '?'}`);
    verify(results[11] !== undefined && !results[11].is_error && results[11].text.includes('READ_OUTSIDE'), 'code: the allowed Bash reads outside the working directories (no blockReadsOutsideWorkingDirectories, which would refuse it to the code roles) — A-R4');
  } else if (role.startsWith('reviewer')) {
    // Turns scripted by upstream.js: 1 Read task.md; 2 grep api; 3 cat /tmp/task/task.md; 4 echo > api/z.js; 5 node -e;
    // 6 Edit api/x.js; 7 cat /etc/passwd; 8 Read /etc/passwd; 9 grep in ~/.claude (trapped user settings).
    const refused = (r) => r !== undefined && r.is_error === true;
    verify(results[0] !== undefined && !results[0].is_error && results[0].text.includes('TRIAL-TASK-DATA'), 'reviewer: Read /tmp/task/task.md succeeds');
    verify(results[1] !== undefined && !results[1].is_error && results[1].text.includes('GREP_OK'), 'reviewer: grep in the repository goes through without permission (read-only set of dontAsk) — A-R4');
    verify(results[2] !== undefined && !results[2].is_error && results[2].text.includes('TRIAL-TASK-DATA'), 'reviewer: cat /tmp/task/task.md goes through (--add-dir working directory)');
    verify(refused(results[3]) && output.includes('api/z.js=absent'), 'reviewer: Bash "echo x > api/z.js" refused, file absent');
    verify(refused(results[4]) && output.includes('api/n.js=absent'), 'reviewer: Bash "node -e" refused, file absent');
    verify(refused(results[5]) && !output.includes('x = 3'), 'reviewer: Edit unavailable, api/x.js intact');
    verify(refused(results[6]) && !results[6].text.includes('root:'), 'reviewer: cat /etc/passwd refused (read-only set confined to the working directories with the engine\'s line) — A-R4');
    verify(refused(results[7]) && !results[7].text.includes('root:'), 'reviewer: Read /etc/passwd refused (outside the working directories)');
    verify(refused(results[8]) && !results[8].text.includes('ATTACKER'), 'reviewer: grep in ~/.claude refused (outside the working directories) — A-R4');
  } else {
    verify(results[0] !== undefined && !results[0].is_error && results[0].text.includes('TRIAL-TASK-DATA'), 'read: Read /tmp/task/task.md succeeds without Bash or permission');
    verify(results[1]?.is_error === true, 'read: Bash unavailable (error returned to the model)');
    verify(results[2]?.is_error === true, 'read: Write unavailable');
    verify(output.includes('=== work:') && !output.includes('=== work: x.txt'), 'read: nothing written in the working directory');
  }
  console.log(`exit code and reason: ${/=== exit code: (\d+)/.exec(output)?.[1] ?? '?'}; ${/subtype=\S+ is_error=\S+ num_turns=\S+/.exec(output)?.[0] ?? '?'}`);
}
console.log(`\n${failures === 0 ? 'OK: every assertion holds' : `FAILED: ${failures} assertion(s) fell`}`);
process.exit(failures === 0 ? 0 : 1);
