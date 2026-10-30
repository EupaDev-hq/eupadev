/**
 * Entry point of the process: reads the configuration (refuses to start if a value is missing, E10, or if another
 * engine already runs on the db, D23), starts DBOS with the external world chosen by `EUPADEV_EXTERNAL` and waits.
 * `fake-auto` (fakes that answer "all is well" on their own, E0) or a list that plugs in a real service, the rest
 * as automatic fakes: `forge=gitea` (E2). Real adapters come one by one ("engine for real" note §2).
 * Usage: EUPADEV_EXTERNAL=fake-auto ORCH_DATABASE_URL=… ADMIN_ESCALATION_ADDRESS=… TOOL_DOMAIN=… DASHBOARD_URL=… node src/main.ts
 */
import { once } from 'node:events';
import { createApi } from './api.ts';
import { readConfig } from './config.ts';
import { launchFakeWatcher } from './external/fakes.ts';
import { externalWorld } from './external/world.ts';
import { Orchestrator } from './orchestrator.ts';

let config;
let world;
try {
  config = readConfig();
  world = externalWorld(process.env, config.toolDomain);
} catch (e) {
  console.error(`Invalid configuration: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(2);
}

let orchestrator: Orchestrator;
try {
  // D23: refused if another engine holds the db lock; lock lost → clean stop, code 1 (the supervisor restarts it).
  orchestrator = await Orchestrator.start(world.external);
} catch (e) {
  console.error(`Startup impossible: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
// The executor (agents VM) only runs agent tasks: neither local API nor watcher (docs/reflexions/2026-10-15-note-lanceur-service.md).
const executor = config.role === 'executor';
const stopWatcher = executor ? () => {} : launchFakeWatcher(orchestrator, config.timeouts.polling_ms);
const api = executor ? null : createApi(orchestrator);
try {
  api?.listen(config.api.port, config.api.address);
  if (api !== null) await once(api, 'listening');
} catch (e) {
  console.error(`API locale impossible sur ${config.api.address}:${config.api.port} : ${e instanceof Error ? e.message : String(e)}`);
  await orchestrator.stop();
  process.exit(1);
}
console.log(executor
  ? `Agent task executor started (external world: ${world.description}, queue of ${config.agentConcurrency} agent(s)).`
  : `Orchestrator started (role ${config.role}, external world: ${world.description}, queue of ${config.agentConcurrency} agent(s), domain ${config.toolDomain}, local API ${config.api.address}:${config.api.port}).`);

const stop = async () => {
  stopWatcher();
  api?.close();
  await orchestrator.stop();
  process.exit(0);
};
process.once('SIGINT', () => void stop());
process.once('SIGTERM', () => void stop());
