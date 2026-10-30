// Runs the mutations of tests/mutations/mutations.ts ONE BY ONE, each in a throwaway copy of the directory (never in
// the original), and checks that the targeted tests fail FOR THE RIGHT REASON (the expected test or scenario fails).
// Fails (code 1) if a mutation survives, is killed for another reason, or no longer applies to the code.
//
// Usage: node tests/mutations/launch.ts [--parallel N] [--no-witness] [ID…]
//   --parallel N   mutations run at the same time (default 2; each one starts its own throwaway PostgreSQL)
//   --no-witness   do not check first that each test command passes on the NON-mutated copy
//   ID…            only these mutations (e.g. R05 C10)
import { spawn } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MUTATIONS, type Mutation } from './mutations.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ORCHESTRATOR = join(HERE, '..', '..');
const COMMAND_TIMEOUT_MS = 15 * 60_000;

const args = process.argv.slice(2);
const parallel = Number(args[args.indexOf('--parallel') + 1] ?? 2) || 2;
const witness = !args.includes('--no-witness');
const ids = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--parallel');
const unknown = ids.filter((i) => !MUTATIONS.some((m) => m.id === i));
if (unknown.length > 0) {
  console.error(`unknown mutations: ${unknown.join(', ')}`);
  process.exit(2);
}
const chosen = ids.length === 0 ? MUTATIONS : MUTATIONS.filter((m) => ids.includes(m.id));

/**
 * Throwaway copy: the directory without node_modules (a link), and what the tests read outside it at its relative
 * place: the report schema and the template's instructions (charter, prompts, rules), its image and its CI (`.gitea/`,
 * `package.json`), the forge's list of protected files, the generated files of the agent image.
 */
function copy(): { root: string; dir: string } {
  const root = mkdtempSync(join(tmpdir(), 'mutation-orchestrator-'));
  const dir = join(root, 'orchestrator');
  cpSync(ORCHESTRATOR, dir, { recursive: true, filter: (s) => !relative(ORCHESTRATOR, s).split(/[\\/]/).some((x) => x === 'node_modules' || x === '.git') });
  symlinkSync(join(ORCHESTRATOR, 'node_modules'), join(dir, 'node_modules'));
  const repo = join(ORCHESTRATOR, '..');
  for (const path of ['tool-template/agents', 'tool-template/AGENTS.md', 'tool-template/.claude/rules', 'tool-template/.gitea', 'tool-template/package.json', 'tool-template/pnpm-lock.yaml', 'infra/ansible/group_vars/forge/vars.yml', 'images/agent/check', 'images/agent/managed-settings.json']) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    cpSync(join(repo, path), join(root, path), { recursive: true });
  }
  return { root, dir };
}

function apply(dir: string, m: Mutation): void {
  const path = join(dir, m.file);
  let text = readFileSync(path, 'utf8');
  for (const [before, after] of m.replacements) {
    const n = text.split(before).length - 1;
    if (n !== 1) throw new Error(`${m.id}: text to mutate found ${n} times in ${m.file} (the mutation no longer applies to the code)`);
    text = text.replace(before, after);
  }
  writeFileSync(path, text);
}

function launch(command: string, cwd: string, timeoutMs = COMMAND_TIMEOUT_MS): Promise<{ code: number | null; output: string; duration_s: number }> {
  const start = Date.now();
  return new Promise((resolve) => {
    // "spec" reporter enforced: the `expected` patterns ("✖ name") depend on it, and Node 22 switches to TAP outside a terminal.
    const p = spawn('bash', ['-c', command], { cwd, env: { ...process.env, NODE_OPTIONS: '--test-reporter=spec' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    let output = '';
    p.stdout.on('data', (d: Buffer) => { output += d.toString(); });
    p.stderr.on('data', (d: Buffer) => { output += d.toString(); });
    // At the timeout: SIGTERM first (the tests then remove their PostgreSQL containers), SIGKILL next.
    const kill = (signal: NodeJS.Signals) => { try { process.kill(-p.pid!, signal); } catch { /* already finished */ } };
    const timer = setTimeout(() => { output += '\n[command timeout exceeded: stopped]\n'; kill('SIGTERM'); setTimeout(() => kill('SIGKILL'), 15_000).unref(); }, timeoutMs);
    p.on('close', (code) => { clearTimeout(timer); resolve({ code, output, duration_s: Math.round((Date.now() - start) / 1000) }); });
  });
}

async function inParallel<T, R>(elements: readonly T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(elements.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, elements.length) }, async () => {
    for (let i = next++; i < elements.length; i = next++) results[i] = await fn(elements[i]!);
  }));
  return results;
}

const note = (l: string) => console.log(l);

// 1. Witness: each command passes on the non-mutated copy (otherwise a "killed mutation" would prove nothing).
if (witness) {
  const commands = [...new Set(chosen.flatMap((m) => m.tests))];
  note(`witness: ${commands.length} command(s) on the non-mutated copy`);
  const results = await inParallel(commands, parallel, async (command) => {
    const { root, dir } = copy();
    try { return { command, ...(await launch(command, dir)) }; } finally { rmSync(root, { recursive: true, force: true }); }
  });
  const red = results.filter((r) => r.code !== 0);
  for (const r of results) note(`  ${r.code === 0 ? 'GREEN' : 'RED  '} ${r.command} (${r.duration_s} s)`);
  if (red.length > 0) {
    for (const r of red) console.error(`--- output of the red witness: ${r.command}\n${r.output.slice(-4000)}`);
    console.error('red witness: the targeted tests already fail without a mutation, nothing is proven');
    process.exit(1);
  }
}

// 2. The mutations, one per copy.
const verdicts = await inParallel(chosen, parallel, async (m) => {
  const { root, dir } = copy();
  try {
    apply(dir, m);
    const outputs: string[] = [];
    let failure = false;
    let duration = 0;
    for (const command of m.tests) {
      const r = await launch(command, dir, m.timeoutMs);
      duration += r.duration_s;
      outputs.push(`$ ${command}\n${r.output}`);
      if (r.code !== 0) failure = true;
    }
    const output = outputs.join('\n');
    const verdict = !failure ? 'SURVIVES' : m.expected.test(output) ? 'killed' : 'KILLED FOR ANOTHER REASON';
    return { m, verdict, duration, output };
  } catch (e) {
    return { m, verdict: 'NO LONGER APPLIES', duration: 0, output: e instanceof Error ? e.message : String(e) };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

note('');
note('| Mutation | Fault | Verdict | Duration |');
note('|---|---|---|---|');
for (const v of verdicts) note(`| ${v.m.id} | ${v.m.fault} | ${v.verdict} | ${v.duration} s |`);
const bad = verdicts.filter((v) => v.verdict !== 'killed');
note('');
note(`${verdicts.length - bad.length}/${verdicts.length} mutations killed for the right reason`);
for (const v of bad) console.error(`--- ${v.m.id} (${v.verdict}): expected ${v.m.expected}\n${v.output.slice(-6000)}`);
process.exit(bad.length === 0 ? 0 : 1);
