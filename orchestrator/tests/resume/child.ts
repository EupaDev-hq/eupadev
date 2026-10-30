// Child process of the resume test: a full orchestrator (DBOS + fakes in "everything
// succeeds" mode) that drives a cycle up to a state then waits to be killed. Each call of the fake
// engine is logged in a file (one line per call) so that the parent counts the executions.
//   MODE=create  TARGET=<state>            creates the tool "inventory" and drives the cycle up to TARGET
//   MODE=resume CYCLE=<id> TARGET=<state>     lets DBOS resume the waiting workflows then drives up to TARGET
// Variables: ORCH_DATABASE_URL, LOG (file), TESTS_SLOWNESS_MS (the tests role answers slowly),
// PREVIEW_SLOWNESS_MS (the Preview deployment answers slowly). D3: EVERY side effect of the fakes is logged in
// the same file (persistent from one process to the next): engine (`<task_id>`), deployer (`deployment:<env>`), forge
// (`forge:<operation>:<iteration>`), notifications (`notification:<recipient>:<subject>|<content>`); the parent looks
// there for duplicates.
import { appendFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import type { StateId } from '../../src/machine/states.ts';
import { startBench, Pilot, type Fakes } from '../helpers/bench.ts';

const mode = process.env['MODE'] ?? 'create';
const target = (process.env['TARGET'] ?? 'end_success') as StateId;
const log = process.env['LOG']!;
const slowness = Number(process.env['TESTS_SLOWNESS_MS'] ?? '0');
const previewSlowness = Number(process.env['PREVIEW_SLOWNESS_MS'] ?? '0');

// Log of all side effects: the parent checks that none is done twice without reason. Set BEFORE the
// engine starts: DBOS resumes the waiting workflows as soon as it is launched (an interrupted task can call the
// engine again right away); set afterwards, that call escaped the log when the machine was loaded.
const spy = (f: Fakes): void => {
  const askBefore = f.engine.switchboard.ask.bind(f.engine.switchboard);
  f.engine.switchboard.ask = (key, input, idempotence, signal, fallback) => {
    appendFileSync(log, `${input.task_id}\n`);
    return askBefore(key, input, idempotence, signal, fallback);
  };
  const deployBefore = f.deployer.switchboard.ask.bind(f.deployer.switchboard);
  f.deployer.switchboard.ask = (key, input, idempotence, signal, fallback) => {
    appendFileSync(log, `deployment:${input.env}\n`);
    return deployBefore(key, input, idempotence, signal, fallback);
  };
  const forgeBefore = f.forge.switchboard.ask.bind(f.forge.switchboard);
  f.forge.switchboard.ask = (key, input, idempotence, signal, fallback) => {
    appendFileSync(log, `forge:${input.operation}:${input.iteration ?? ''}\n`);
    return forgeBefore(key, input, idempotence, signal, fallback);
  };
  const notifyBefore = f.notifications.notify.bind(f.notifications);
  f.notifications.notify = (recipient, cycleId, subject, content, key) => {
    appendFileSync(log, `notification:${recipient}:${subject}|${content.replaceAll('\n', ' ')}\n`);
    return notifyBefore(recipient, cycleId, subject, content, key);
  };
};
const bench = await startBench(process.env['ORCH_DATABASE_URL']!, {}, spy);
const pilot = new Pilot(bench);

let cycle: number;
if (mode === 'create') {
  cycle = await pilot.createCycle('inventory');
} else {
  cycle = Number(process.env['CYCLE']);
  pilot.cycles.set('inventory', cycle);
}
console.log(`CYCLE ${cycle}`);
await pilot.driveUntil(cycle, target, { timeoutMs: 60_000, slownesses: { ...(slowness > 0 ? { tests: slowness } : {}), ...(previewSlowness > 0 ? { 'deployment:preview': previewSlowness } : {}) } });
console.log(`ARRIVE ${target}`);
if (target === 'end_success') {
  console.log(`WORKFLOW ${await pilot.waitForWorkflowEnd(cycle)}`);
  await bench.orch.stop();
  process.exit(0);
}
// Otherwise: stay alive (the parent kills us in the middle of a durable wait).
for (;;) await sleep(1000);
