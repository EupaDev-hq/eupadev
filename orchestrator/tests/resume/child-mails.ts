// Child process of test E1 (tests/mails.test.ts): the engine as in service (`src/main.ts`), outside world chosen
// by EUPADEV_EXTERNAL=notifications=smtp (real mails to a throwaway Mailpit, the rest as automatic fakes, fake
// watcher included).
//   MODE=create    creates a request, sends the requester's feedback on the mock-up, and the cycle goes on its own to Gate 1
//   MODE=resume    lets DBOS resume the waiting workflow, then waits to be killed
// Each call of `notify` is logged in LOG (`<key>|<subject>`, one line per call) BEFORE sending. KILL_AFTER
// (regular expression on the subject): the process kills itself (SIGKILL) as soon as that send has succeeded, BEFORE DBOS
// records the end of the step, so the step will be replayed on restart, with the same key.
import { appendFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { launchFakeWatcher } from '../../src/external/fakes.ts';
import { externalWorld } from '../../src/external/world.ts';
import { Orchestrator } from '../../src/orchestrator.ts';
import { REQUESTER, hats, insertTestActors } from '../helpers/bench.ts';

const log = process.env['LOG']!;
const killAfter = process.env['KILL_AFTER'] === undefined ? undefined : new RegExp(process.env['KILL_AFTER']);
const { external } = externalWorld(process.env, process.env['TOOL_DOMAIN']!);
const notify = external.notifications.notify.bind(external.notifications);
external.notifications.notify = async (recipient, cycleId, subject, content, key) => {
  appendFileSync(log, `${key}|${subject}\n`);
  await notify(recipient, cycleId, subject, content, key);
  if (killAfter?.test(subject)) process.kill(process.pid, 'SIGKILL');
};
const orch = await Orchestrator.start(external);
launchFakeWatcher(orch, 50); // green CI and green Preview pipeline, like src/main.ts
await insertTestActors(orch.base.pool);

if (process.env['MODE'] === 'create') {
  const { cycle_id } = await orch.newRequest({ type: 'creation', name: 'Register E1', slug: 'register-e1', owner_service: 'lab', need: 'Track the department vehicles' }, REQUESTER);
  console.log(`CYCLE ${cycle_id}`);
  while ((await orch.base.readCycle(cycle_id)).state !== 'waiting_scoping_feedback') await sleep(50);
  await orch.send(cycle_id, { type: 'scoping_feedback', outcome: 'satisfied', actor_id: REQUESTER.id }, hats({ type: 'scoping_feedback', outcome: 'satisfied', actor_id: REQUESTER.id }));
}
for (;;) await sleep(1000);
