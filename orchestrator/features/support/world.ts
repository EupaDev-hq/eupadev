// Cucumber world: one bench per scenario (fresh database, DBOS restarted), the scriptable fakes and the
// cursors that let us check "the cycle goes from A to B" without mixing up two passes.
import { setWorldConstructor, World as CucumberWorld, type IWorldOptions } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import type { Bench, Pilot } from '../../tests/helpers/bench.ts';
import type { Role } from '../../src/external/contracts.ts';
import type { Cycle } from '../../src/db.ts';
import type { Page } from 'playwright';

export const DEFAULT_SLUG = 'inventory';

export class World extends CucumberWorld {
  bench!: Bench;
  pilot!: Pilot;
  /** Current cycle (the last one created) and current tool ("for this tool"). */
  cycleId = 0;
  toolId = 0;
  /** Last history line already checked, per cycle. */
  cursors = new Map<number, number>();
  /** History lines produced by the setup (Given steps): they do not count for the scenario (hooks.ts). */
  setup: { cycle: number; start: number; bound: number }[] = [];
  /** Last evaluation output consumed by the "round N is played" step (independent of the scenario's cursors). */
  evaluationCursor = 0;
  /** Last error of a refused action (abandonment after a merge, cycle on an archived tool…). */
  lastError = '';
  /** Second actor of the requester (new subject), attached by an actor merge (0010). */
  secondActor = '';
  /** Snapshot of the number of squashes (the "no new CI request" step). */
  mergesBefore = 0;
  /** Size of the fake logs at the end of the setup / at the last decision. */
  forgeLogBefore = 0;
  engineLogBefore = 0;
  /** Out-of-scope file prepared by the "iteration branch changes a file" step. */
  outOfScope: { file: string; role: Role }[] = [];
  /** SARIF details per check, attached to the next pipeline signal (M5: what the watcher reads in the `analysis` job's log). */
  details = new Map<string, unknown>();
  /** Setup state per tool: whatever waits for an answer in this state stays waiting for the scenario. */
  targets = new Map<string, string>();
  /** Kinds scripted by this scenario (see hooks.ts): the others get a happy answer by default. */
  scripted = { roles: new Set<string>(), forge: new Set<string>(), deployments: new Set<string>() };
  /** Creates an empty database on the same server and returns its URL (E10 bis). */
  emptyDatabases!: () => Promise<string>;
  /** Agent task seen running by the "an agent task of the cycle is running" step (E15). */
  runningTask: string | undefined;
  /** Open tasks (queued or running) noted just before the cancellation (E15): each one must be closed by it. */
  openTasks: string[] = [];
  /** Admin clarification quoted by the "receives the clarification as data" step (then checked outside the instructions). */
  clarificationSeen: string | undefined;
  /** Empty database passed to the process started by the "orchestrator starts" step. */
  startupDatabase = '';
  /** Chat step 4 (@web): the requester's browser tab on the engine's page (features/support/web.ts). */
  page!: Page;

  constructor(options: IWorldOptions) {
    super(options);
  }

  get base() {
    return this.bench.orch.base;
  }

  cycle(): Promise<Cycle> {
    return this.base.readCycle(this.cycleId);
  }

  async taskId(role: string, iteration: number, cycleId = this.cycleId): Promise<string> {
    const c = await this.base.readCycle(cycleId);
    return `${c.tool_id}-${c.id}-${iteration}-${role}`;
  }

  cycleOf(slug: string): number {
    const id = this.pilot.cycles.get(slug);
    assert.ok(id !== undefined, `no cycle for tool ${slug}`);
    return id;
  }

  /** Waits until a condition becomes true (observable in the database or in the fakes). */
  wait<T>(description: string, condition: () => Promise<T | undefined | false>, timeoutMs = 10_000): Promise<T> {
    return this.pilot.wait(description, condition, timeoutMs);
  }

  /** Gives the workflow time to act (to check that it does NOT do something). */
  async letThrough(ms = 300): Promise<void> {
    await sleep(ms);
  }

  /** Checks a transition after the cycle's cursor and moves the cursor forward. */
  async transition(from: string, trigger: string, to: string, cycleId = this.cycleId): Promise<void> {
    const cursor = this.cursors.get(cycleId) ?? 0;
    const after = async () => (await this.pilot.history(cycleId)).filter((x) => x.id > cursor);
    let line: { id: number } | undefined;
    try {
      line = await this.wait(`transition ${from} --[${trigger}]--> ${to} of cycle ${cycleId} (after #${cursor})`, async () => {
        return (await after()).find((x) => x.previous_state === from && x.trigger === trigger && x.state === to);
      });
    } catch (e) {
      throw new Error(`${e instanceof Error ? e.message : String(e)}; got: ${(await after()).map((x) => `${x.previous_state} --[${x.trigger}]--> ${x.state}`).join('; ')}; state ${await this.pilot.state(cycleId)}; engine waiting: ${this.bench.engine.inProgress().join(', ')}`);
    }
    this.cursors.set(cycleId, line.id);
  }
}

setWorldConstructor(World);
