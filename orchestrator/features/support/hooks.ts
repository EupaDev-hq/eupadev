// One PostgreSQL container for the whole session; a fresh database and a restarted DBOS per scenario,
// so that the workflows of one scenario do not survive into the next.
//
// Honesty check (D2): after each passed scenario, each of its tags @t:<from>--<trigger>--><to>
// (columns of an Outline replaced by the Examples row played) must really have been traced in the history of
// its database BY THE SCENARIO ITSELF: the lines produced by the setup alone (Given steps, up to the
// cursor they set) do not count; otherwise the scenario fails. On a full run (recognised by the number of
// scenarios played, equal to that of the .feature files, whatever the format options), each transition of the machine
// must have been traced at least once by a scenario, otherwise the run fails.
import { After, AfterAll, AfterStep, Before, BeforeAll, BeforeStep, setDefaultTimeout, type ITestCaseHookParameter, type ITestStepHookParameter } from '@cucumber/cucumber';
import { TRANSITIONS, triggerKey } from '../../src/machine/states.ts';
import { createDatabase, startPostgres, migrateAll, urlBase, type ThrowawayPostgres } from '../../tests/helpers/throwaway-postgres.ts';
import { startBench, Pilot, happyResponse } from '../../tests/helpers/bench.ts';
import { executionCount } from '../../tests/helpers/features.ts';
import { World } from './world.ts';
import { stopWeb, startWeb, envWeb, closeWeb } from './web.ts';

setDefaultTimeout(60_000);

let postgres: ThrowawayPostgres;
let number = 0;
/** Transitions really traced by the scenarios run. */
const traced = new Set<string>();

BeforeAll({ timeout: 180_000 }, async () => {
  postgres = await startPostgres({ migrations: false });
});

AfterAll(async () => {
  await closeWeb();
  postgres?.remove();
  // Full run = as many scenarios played as the .feature files contain (excluding @to-wire): no option can fake it.
  const expected = executionCount();
  if (number !== expected) {
    console.log(`\npartial run (${number}/${expected} scenarios): global coverage check not applicable`);
    return;
  }
  const missing = TRANSITIONS.map((t) => `${t.from}--${triggerKey(t.trigger)}-->${t.to}`).filter((t) => !traced.has(t));
  console.log(`\nreal coverage: ${TRANSITIONS.length - missing.length}/${TRANSITIONS.length} transitions traced during the run`);
  if (missing.length > 0) throw new Error(`transitions of the machine never traced by a scenario run (${missing.length}):\n${missing.join('\n')}`);
});

/** Fresh (empty) database; returns the engine's URL (orch_engine), the one the orchestrator starts with. */
export async function newDatabase(name: string): Promise<string> {
  await createDatabase(postgres, name);
  return urlBase(postgres.engineUrl, name);
}

Before(async function (this: World, scenario: ITestCaseHookParameter) {
  number += 1;
  const url = await newDatabase(`scenario_${number}`);
  await migrateAll(urlBase(postgres.ownerUrl, `scenario_${number}`));
  // Chat step 4: a @web scenario drives the engine through the requester's page (features/support/web.ts).
  const web = scenario.pickle.tags.some((t) => t.name === '@web');
  this.bench = await startBench(url, web ? await envWeb() : {});
  this.pilot = new Pilot(this.bench);
  if (web) await startWeb(this);
  this.emptyDatabases = () => newDatabase(`empty_${number}_${Date.now()}`);

  // What the scenario scripts itself stays waiting for its answer; everything else succeeds by default. The patterns
  // below read the step texts of the .feature files.
  const texts = scenario.pickle.steps.map((s) => s.text);
  for (const t of texts) {
    for (const m of t.matchAll(/for "([a-z-]+)"/g)) this.scripted.roles.add(m[1]!);
    for (const m of t.matchAll(/for roles "([^"]+)"/g)) for (const r of m[1]!.split(',')) this.scripted.roles.add(r.trim());
    // At the end only: "the cycle moves from "<state>" to …" names a state, not a role.
    for (const m of t.matchAll(/from "([a-z-]+)"$/g)) this.scripted.roles.add(m[1]!);
    if (/repository/.test(t)) this.scripted.forge.add('repo');
    if (/integration of the role branches/.test(t)) this.scripted.forge.add('integration');
    if (/squash|iteration branch diff/.test(t)) this.scripted.forge.add('merge');
    if (/the mock-up (does not answer|answers)/.test(t)) this.scripted.deployments.add('mockup');
    if (/the Preview (does not answer|answers)/.test(t)) this.scripted.deployments.add('preview');
    if (/the Prod (does not answer|answers)/.test(t)) this.scripted.deployments.add('prod');
  }
  // A request made from a tool's setup state stays waiting: that is what the scenario is going to script.
  const kept = async (slug: string): Promise<boolean> => {
    const target = this.targets.get(slug);
    const id = this.pilot.cycles.get(slug);
    return target !== undefined && id !== undefined && (await this.pilot.state(id)) === target;
  };
  const { engine: engine, forge, deployer: deployer } = this.bench;
  engine.switchboard.auto = async (_key, input) => (this.scripted.roles.has(input.role) || (await kept(input.tool)) ? undefined : happyResponse(input));
  forge.switchboard.auto = async (key) => (this.scripted.forge.has(key.split(':')[0]!) || (await kept(key.split(':')[1]!)) ? undefined : { type: 'ok' });
  deployer.switchboard.auto = async (key) => (this.scripted.deployments.has(key.split(':')[0]!) || (await kept(key.split(':')[1]!)) ? undefined : { type: 'ok' });
});

/** @t: tags of the scenario played, columns of the Outline replaced by the Examples row of this pickle. */
function playedTags(s: ITestCaseHookParameter): string[] {
  const [idScenario, rowId] = s.pickle.astNodeIds;
  const values: Record<string, string> = {};
  for (const child of s.gherkinDocument.feature?.children ?? []) {
    const sc = child.scenario;
    if (sc === undefined || sc.id !== idScenario) continue;
    for (const ex of sc.examples) {
      const line = ex.tableBody.find((l) => l.id === rowId);
      if (line !== undefined) ex.tableHeader?.cells.forEach((c, i) => { values[c.value] = line.cells[i]?.value ?? ''; });
    }
  }
  return s.pickle.tags.map((t) => t.name).filter((t) => t.startsWith('@t:')).map((t) => t.slice(3).replace(/<([^>]+)>/g, (_, col: string) => values[col] ?? `<${col}>`));
}

const lastLines = async (m: World) => new Map((await m.base.pool.query<{ cycle_id: number; max: number }>('SELECT cycle_id::int AS cycle_id, max(id)::int AS max FROM tool_history GROUP BY cycle_id')).rows.map((x) => [x.cycle_id, x.max]));
let beforeStep = { lines: new Map<number, number>(), cursors: new Map<number, number>() };
BeforeStep(async function (this: World, { pickleStep }: ITestStepHookParameter) {
  if (this.bench === undefined || pickleStep.type !== 'Context') return;
  beforeStep = { lines: await lastLines(this), cursors: new Map(this.cursors) };
});
/**
 * End of a setup step: the lines it produced are not credited to the scenario, except
 * those that follow the cursor it set itself ("the check starts here", e.g. the incident of a D21).
 */
AfterStep(async function (this: World, { pickleStep }: ITestStepHookParameter) {
  if (this.bench === undefined || pickleStep.type !== 'Context') return;
  for (const [cycle, end] of await lastLines(this)) {
    const start = beforeStep.lines.get(cycle) ?? 0;
    const cursor = this.cursors.get(cycle);
    const bound = cursor !== undefined && cursor !== beforeStep.cursors.get(cycle) ? Math.min(end, cursor) : end;
    if (bound > start) this.setup.push({ cycle, start, bound });
  }
});

After(async function (this: World, s: ITestCaseHookParameter) {
  if (this.bench === undefined) return;
  try {
    const r = await this.base.pool.query<{ id: number; cycle_id: number; previous_state: string; state: string; trigger: string }>(
      `SELECT id::int AS id, cycle_id::int AS cycle_id, previous_state, state, trigger FROM tool_history WHERE previous_state IS NOT NULL AND trigger NOT LIKE 'check:%' AND trigger NOT LIKE 'cleanup:%' ORDER BY id`,
    );
    const ofScenario = r.rows.filter((x) => !this.setup.some((m) => m.cycle === x.cycle_id && x.id > m.start && x.id <= m.bound));
    const transitions = new Set(ofScenario.map((x) => `${x.previous_state}--${x.trigger}-->${x.state}`));
    for (const t of transitions) traced.add(t);
    if (s.result?.status === 'PASSED') {
      const missing = playedTags(s).filter((t) => !transitions.has(t));
      if (missing.length > 0) throw new Error(`@t: tags never traced by this scenario (the announced transition did not happen): ${missing.join(', ')}`);
    }
  } finally {
    await stopWeb();
    await this.bench.orch.stop();
  }
});
