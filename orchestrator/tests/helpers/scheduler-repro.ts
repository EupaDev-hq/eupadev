// Reproduction (diagnostic, not a test of the suite) of the race in the DBOS 5.2.11 dynamic scheduler
// (dist/src/scheduler/scheduler.js): `destroy()` (called by DBOS.shutdown) collects the running schedule loops,
// cancels them, waits for the polling loop, then empties its table. A polling pass already started (after `listSchedules`)
// still starts a fresh schedule loop, with its own signal, never cancelled: it survives the shutdown and keeps the
// process alive ("Dynamic scheduler: error firing workflow … `DBOS.launch()` must be called"). Here the polling
// pass is made slow (listSchedules delayed) to open the window for sure.
// Usage: node tests/helpers/scheduler-repro.ts
import { setTimeout as sleep } from 'node:timers/promises';
import { DBOS } from '@dbos-inc/dbos-sdk';
import { automaticFakes } from '../../src/external/fakes.ts';
import { Orchestrator } from '../../src/orchestrator.ts';
import { ENV_TEST } from './bench.ts';
import { migratedDatabase, startPostgres } from './throwaway-postgres.ts';

const postgres = await startPostgres({ migrations: false });
const url = await migratedDatabase(postgres, 'repro');
const repro = DBOS.registerWorkflow(async function repro() {}, { name: 'repro' });
const o = await Orchestrator.start(automaticFakes('example.test'), { ...ENV_TEST, ORCH_DATABASE_URL: url }, { onLockLoss: () => {} });
// Internal access, diagnostic only: the system database the scheduler reads.
const { DBOSExecutor } = (await import('../../node_modules/@dbos-inc/dbos-sdk/dist/src/dbos-executor.js')) as unknown as { DBOSExecutor: { globalInstance: { systemDatabase: { listSchedules: (...a: unknown[]) => Promise<unknown> } } } };
const sysdb = DBOSExecutor.globalInstance.systemDatabase;
const before = sysdb.listSchedules.bind(sysdb);
let inside!: () => void;
const between = new Promise<void>((r) => { inside = r; });
sysdb.listSchedules = async (...a: unknown[]) => { const r = await before(...a); inside(); await sleep(1000); return r; };
await DBOS.applySchedules([{ scheduleName: 'repro', workflowFn: repro, schedule: '* * * * * *' }]);
await between; // a polling pass has started
await o.stop();
postgres.remove();
console.log('stopped; if the process does not end by itself, a scheduling loop survived');
