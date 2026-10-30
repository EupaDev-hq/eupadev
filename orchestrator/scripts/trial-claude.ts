// Real trial of the Claude Code engine (run by the lab's verify playbook of the Claude engine, note
// `docs/reflexions/2026-10-15-note-e4-claude-reel.md`):
// a builder task with the REAL Claude Code, on the agents VM, through the engine's code as is (`ClaudeCodeEngine.execute`).
// PAID CALL (cap $1): run only by the playbook with -e ai_call=true.
//   FORGE_URL=https://git.<domain> AGENT_FORGE_TOKEN_FILE=<file> AGENT_IMAGE=<…@sha256:…> AGENT_COSIGN_PUB=<file>
//   AGENT_AI_PROXY=<container:port> [AGENT_PROXIES=a,b] [AGENT_EGRESS_PROXY=<container:port>] REPORT_SCHEMA_PATH=<file> [AGENT_LOG=<file>] node scripts/trial-claude.ts <tool> <model>
// Never prints a token. Output: one JSON line (the TaskOutput, without the full report). Exit 0 = report returned;
// 1 = error or task without a report; 2 = usage.
import { readFileSync } from 'node:fs';
import { ClaudeCodeEngine } from '../src/external/claude-engine.ts';

const [tool, model] = process.argv.slice(2);
const env = process.env;
const required = ['FORGE_URL', 'AGENT_FORGE_TOKEN_FILE', 'AGENT_IMAGE', 'AGENT_COSIGN_PUB', 'AGENT_AI_PROXY', 'REPORT_SCHEMA_PATH'];
if (tool === undefined || model === undefined || required.some((v) => (env[v] ?? '') === '')) {
  console.error(`usage: ${required.join('=… ')}=… node scripts/trial-claude.ts <tool> <model>`);
  process.exit(2);
}
const instructions = 'You are the builder agent of a trial. Do exactly what the task asks, nothing more, then return your report in the requested format.';
try {
  const engine = new ClaudeCodeEngine({
    forgeUrl: env['FORGE_URL']!, token: readFileSync(env['AGENT_FORGE_TOKEN_FILE']!, 'utf8').trim(), image: env['AGENT_IMAGE']!,
    publicKey: env['AGENT_COSIGN_PUB']!, reportSchema: readFileSync(env['REPORT_SCHEMA_PATH']!, 'utf8'), aiProxy: env['AGENT_AI_PROXY']!,
    proxies: (env['AGENT_PROXIES'] ?? '').split(',').filter((p) => p !== ''),
    ...(env['AGENT_EGRESS_PROXY'] ? { egressProxy: env['AGENT_EGRESS_PROXY'] } : {}),
    ...(env['AGENT_LOG'] ? { log: env['AGENT_LOG'] } : {}),
  });
  const s = await engine.execute({
    task_id: `trial-claude-${process.pid}`, tool: tool!, role: 'builder', instructions,
    context: { request: 'Create the file api/hello.txt holding exactly the line "hello", then make a local commit with the message "hello".' },
    cap: { duration_min: 15, turns: 30, budget_usd: 1 }, model: model!, effort: 'low',
    branch: `agent/${tool}/1/builder`, signal: AbortSignal.timeout(15 * 60_000),
  });
  const status = (s.report as { status?: unknown } | null)?.status ?? null;
  console.log(JSON.stringify({ status: status, error: s.error ?? null, cost_usd: s.cost_usd, tokens: s.tokens ?? null, duration_s: s.duration_s, tree_hash: s.tree_hash }));
  if (s.report === null) process.exit(1);
} catch (e) {
  console.error(`FAILED: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
