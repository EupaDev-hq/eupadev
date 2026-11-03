// Child process of the roles test: a full orchestrator of the role
// EUPADEV_ROLE (`all-in-one`, `pilot`, `executor`), automatic fake outside world.
//   CREATE=<slug>          (pilot) creates the tool and its cycle, then writes "CYCLE <id>"
//   STOP_AT=<state>       (pilot) the humans no longer answer in this state ("ARRIVE <id> <state>" written once)
//   ENGINE_SLOWNESS_MS=<n> the fake engine answers after n ms (to kill the executor in the middle of a task)
//   LOG=<file>        each call of the fake engine: "<role> <task_id>"
// Writes "READY" once started, "REFUSED <reason>" (exit 3) if the start is refused.
import { appendFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { automaticFakes, launchFakeWatcher, happyResponse, type FakeEngine } from '../../src/external/fakes.ts';
import { STATES } from '../../src/machine/states.ts';
import type { Message } from '../../src/messages.ts';
import { Orchestrator } from '../../src/orchestrator.ts';
import { ADMIN, REQUESTER, hats, insertTestActors } from '../helpers/bench.ts';

const env = process.env;
const role = env['EUPADEV_ROLE'] ?? 'all-in-one';
const slowness = Number(env['ENGINE_SLOWNESS_MS'] ?? '0');
const external = automaticFakes(env['TOOL_DOMAIN']!);
(external.engine as FakeEngine).switchboard.auto = async (_key, input) => {
  appendFileSync(env['LOG']!, `${role} ${input.task_id}\n`);
  if (slowness > 0) await sleep(slowness);
  return happyResponse(input);
};

let orch: Orchestrator;
try {
  orch = await Orchestrator.start(external, env, { onLockLoss: () => process.exit(1) });
} catch (e) {
  console.log(`REFUSED ${e instanceof Error ? e.message : String(e)}`);
  process.exit(3);
}
console.log('READY');
if (role === 'executor') for (;;) await sleep(1000);

launchFakeWatcher(orch, 50);
await insertTestActors(orch.base.pool);
if (env['CREATE'] !== undefined) {
  const { cycle_id } = await orch.newRequest({ type: 'creation', name: env['CREATE'], slug: env['CREATE'], owner_service: 'logistics', need: 'Track the department vehicles' }, REQUESTER);
  console.log(`CYCLE ${cycle_id}`);
}
const GATES = new Set<string>(STATES.filter((e) => e.kind === 'gate').map((e) => e.id));
const done = new Set<string>();
for (;;) {
  for (const { id } of await orch.base.openCycles()) {
    const c = await orch.base.readCycle(id);
    const passage = `${id}#${c.state}#${c.visit}`;
    if (done.has(passage)) continue;
    if (c.state === env['STOP_AT']) {
      done.add(passage);
      console.log(`ARRIVE ${id} ${c.state}`);
      continue;
    }
    let m: Message | undefined;
    if (c.state === 'waiting_scoping_feedback') m = { type: 'scoping_feedback', outcome: 'satisfied', actor_id: REQUESTER.id };
    else if (c.state === 'waiting_preview_feedback') m = { type: 'preview_feedback', outcome: 'satisfied', actor_id: REQUESTER.id };
    else if (GATES.has(c.state)) {
      const digest = c.state === 'gate_2' ? await orch.base.candidateDigest(id) : null;
      m = { type: 'decision', gate: c.state as never, outcome: 'approved', actor_id: ADMIN.id, ...(digest !== null ? { digest: digest } : {}) };
    }
    if (m !== undefined && (await orch.send(id, m, hats(m))).transmitted) done.add(passage);
  }
  await sleep(50);
}
