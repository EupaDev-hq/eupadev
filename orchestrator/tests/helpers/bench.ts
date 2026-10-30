// Test bench: the real DBOS engine + throwaway PostgreSQL + scriptable fakes, and a pilot that
// drives a cycle to a given state along the machine's real path (never by forcing the state).
import { setTimeout as sleep } from 'node:timers/promises';
import {
  FakeDeployer, FakeForge, FakeEngine, FakeNotifications, digest,
  overlapReport, compliantReport, happyResponse, happySignal, type EngineResponse,
} from '../../src/external/fakes.ts';
import type { StateId } from '../../src/machine/states.ts';
import { isHuman, type Message } from '../../src/messages.ts';
import { Orchestrator, type Actor, type SendResult } from '../../src/orchestrator.ts';
import { cycleWorkflowId } from '../../src/workflows/deps.ts';
import { DBOS } from '@dbos-inc/dbos-sdk';
import type pg from 'pg';
import type { Hat } from '../../src/auth.ts';
import type { Cycle } from '../../src/db.ts';
import { TEST_ISSUER } from './fake-oidc.ts';

/** Short delays: 24 h of reminder = 400 ms, 30 days of pause = 1.5 s, task 1.5 s… */
export const ENV_TEST: Record<string, string> = {
  ADMIN_ESCALATION_ADDRESS: 'admin@example.test',
  TOOL_DOMAIN: 'example.test',
  DASHBOARD_URL: 'https://forge.example.test/dashboard',
  AGENT_CONCURRENCY: '1',
  REMINDER_DELAY_MS: '400',
  PAUSE_ARCHIVE_DELAY_MS: '1500',
  CI_MAX_TIMEOUT_MS: '1500',
  TASK_TIMEOUT_MS: '1500',
  LONG_WAIT_DELAY_MS: '2000',
  LONG_REMINDER_DELAY_MS: '2000',
  POLLING_INTERVAL_MS: '50',
  OPERATION_TIMEOUT_MS: '15000',
  MONITORING_CRON: '* * * * * *',
  WATCHER_CRON: '* * * * * *',
  INCIDENT_RETRY_DELAY_MS: '200',
  STEP_ATTEMPTS: '3',
  STEP_INTERVAL_MS: '50',
  // I0: the IdP as the engine sees it; the JWKS is read only by the API (tests/service.test.ts replaces it with the fake).
  OIDC_ISSUER: TEST_ISSUER,
  OIDC_JWKS_URL: 'http://127.0.0.1:9/realms/eupadev/protocol/openid-connect/certs',
  OIDC_AUDIENCE: 'eupadev-api',
};
/**
 * I0: the two humans of the tests, fixed ids (`actors` rows written by `insertTestActors`), display name =
 * address (the scenarios read this name in the history). Their hats come from their token: `hats(m)` replays
 * them for a message sent without going through the API.
 */
export const REQUESTER_MAIL = 'requester@example.test';
export const ADMIN_MAIL = 'admin@example.test';
export const REQUESTER: Actor = { id: 'd0000000-0000-4000-8000-000000000001', roles: ['requester'] };
export const ADMIN: Actor = { id: 'a0000000-0000-4000-8000-000000000001', roles: ['admin'] };
/** OIDC subjects of the two humans at TEST_ISSUER (tokens of the fake, four-eyes exemption). */
export const SUBJECTS: Record<string, string> = { [REQUESTER.id]: 'requester', [ADMIN.id]: 'admin' };
export const hats = (m: Message): readonly Hat[] => (!isHuman(m) ? [] : m.actor_id === ADMIN.id ? ADMIN.roles : m.actor_id === REQUESTER.id ? REQUESTER.roles : []);

/** Test actors, written with the engine's account (read and insert); idempotent per database. */
export async function insertTestActors(pool: pg.Pool): Promise<void> {
  for (const [a, mail, subject] of [[REQUESTER, REQUESTER_MAIL, SUBJECTS[REQUESTER.id]!], [ADMIN, ADMIN_MAIL, SUBJECTS[ADMIN.id]!]] as const) {
    await pool.query(`INSERT INTO actors (id, type, mail, display_name) VALUES ($1, 'human', $2, $2) ON CONFLICT (id) DO NOTHING`, [a.id, mail]);
    await pool.query(`INSERT INTO actor_identities (issuer, subject, actor_id, reason) VALUES ($1, $2, $3, 'test') ON CONFLICT DO NOTHING`, [TEST_ISSUER, subject, a.id]);
  }
}

export interface Bench {
  orch: Orchestrator;
  engine: FakeEngine;
  forge: FakeForge;
  deployer: FakeDeployer;
  notifications: FakeNotifications;
  /**
   * Injected internal faults (tests of the incident gate, D21): `<cycle>/<state>` → message. The next transition
   * of W1 that LEAVES this state fails with a definitive database error (SQLSTATE P0001, no retry).
   */
  faults: Map<string, string>;
  /**
   * Freezes (E15 on the transient states): when W1 reads its cycle in this state, it waits for `release()` before
   * handling it; the cycle is "held" in a state it would leave on its own.
   */
  freezes: Map<string, { promise: Promise<void>; release: () => void }>;
  /** D23: losses of the "single engine" lock reported by the orchestrator (instead of ending the test process). */
  lockLosses: Error[];
}

export type Fakes = Pick<Bench, 'engine' | 'forge' | 'deployer' | 'notifications'>;

/** `prepare` receives the fakes BEFORE the engine starts: DBOS resumes the waiting workflows as soon as it is launched. */
export async function startBench(databaseUrl: string, env: Record<string, string> = {}, prepare?: (f: Fakes) => void): Promise<Bench> {
  const engine = new FakeEngine();
  const forge = new FakeForge();
  const notifications = new FakeNotifications();
  const variables: Record<string, string> = { ...ENV_TEST, ...env, ORCH_DATABASE_URL: databaseUrl };
  const deployer = new FakeDeployer(variables['TOOL_DOMAIN']!);
  prepare?.({ engine: engine, forge, deployer: deployer, notifications });
  const lockLosses: Error[] = [];
  const orch = await Orchestrator.start({ engine: engine, forge, deployer: deployer, notifications }, variables, { onLockLoss: (e) => { lockLosses.push(e); } });
  await insertTestActors(orch.base.pool);
  const faults = new Map<string, string>();
  const freezes = new Map<string, { promise: Promise<void>; release: () => void }>();
  const base = orch.base;
  const transitionBefore = base.transition.bind(base);
  base.transition = async (cycleId, from, trigger, to, actor, extra, memory) => {
    const key = `${cycleId}/${from}`;
    const fault = faults.get(key);
    if (fault !== undefined && trigger !== 'incident' && from !== to) {
      faults.delete(key);
      throw Object.assign(new Error(fault), { code: 'P0001' });
    }
    return transitionBefore(cycleId, from, trigger, to, actor, extra, memory);
  };
  const readBefore = base.readCycle.bind(base);
  base.readCycle = async (id, client): Promise<Cycle> => {
    const c = await readBefore(id, client);
    const freeze = freezes.get(`${id}/${c.state}`) ?? freezes.get(`*/${c.state}`);
    if (freeze !== undefined && DBOS.workflowID === cycleWorkflowId(id)) await freeze.promise;
    return c;
  };
  return { orch, engine: engine, forge, deployer: deployer, notifications, faults, freezes, lockLosses };
}

/** Holds W1 in a state (see `Bench.freezes`) until `releaseFreezes`; `*` = whatever the cycle. */
export function freeze(bench: Bench, cycleId: number | '*', state: StateId): void {
  let release!: () => void;
  const promise = new Promise<void>((r) => { release = r; });
  bench.freezes.set(`${cycleId}/${state}`, { promise, release });
}
export function releaseFreezes(bench: Bench): void {
  for (const g of bench.freezes.values()) g.release();
  bench.freezes.clear();
}

export { happyResponse };

const STATES_WAITING_FOR_MESSAGE = new Set<string>(['waiting_scoping_feedback', 'waiting_preview_feedback', 'waiting_ci', 'preview_pipeline', 'gate_overlap', 'gate_scoping_budget', 'gate_scoping_blocked', 'gate_contract_blocked', 'gate_hardening_blocked', 'gate_1', 'gate_2', 'gate_delivery_blocked', 'gate_prod_blocked', 'gate_incident']);

/**
 * Detours off the happy path to reach the gates and the pause, depending on the current state:
 * fake answer to give, or message to send instead of the happy message.
 */
interface Detour { in: StateId; engine?: (task_id: string) => EngineResponse; forge?: 'error'; deployer?: 'failed'; message?: Message }
const CORRECTION_FEEDBACK: Message = { type: 'scoping_feedback', outcome: 'correction', text: 'The filter by site is missing', actor_id: REQUESTER.id };
const DETOURS: Partial<Record<StateId, Detour[]>> = {
  gate_overlap: [{ in: 'overlap_search', engine: (id) => ({ type: 'report', report: overlapReport(id, 'plausible', 'The tool "car-fleet" already covers the need') }) }],
  gate_scoping_blocked: [
    { in: 'repo_creation', forge: 'error' },
    { in: 'scoping', engine: () => ({ type: 'failed', reason: 'npm install : ECONNRESET' }) },
  ],
  gate_scoping_budget: [
    { in: 'overlap_search', engine: (id) => ({ type: 'report', report: overlapReport(id, 'not_plausible'), cost_usd: 10 }) },
    { in: 'scoping', engine: (id) => ({ type: 'report', report: compliantReport('scoping', id), cost_usd: 10 }) },
    { in: 'waiting_scoping_feedback', message: CORRECTION_FEEDBACK },
  ],
  gate_contract_blocked: [{ in: 'contract', engine: () => ({ type: 'failed', reason: 'invalid openapi: paths missing' }) }],
  // Through the working time (2 h declared by the contract): "continue" or "clarify" resets this counter, the next round starts.
  gate_hardening_blocked: [
    { in: 'contract', engine: (id) => ({ type: 'report', report: compliantReport('contract', id), duration_s: 7200 }) },
    { in: 'hardening_execution', engine: (id) => ({ type: 'report', report: compliantReport('builder', id), duration_s: 7200 }) },
  ],
  // Through the real silent CI (decision 14): nothing is sent while waiting for the CI, the 60 min timeout decides.
  gate_delivery_blocked: [{ in: 'waiting_ci', message: { type: 'cancellation', actor_id: 'nobody' } }],
  gate_prod_blocked: [{ in: 'prod_deployment', deployer: 'failed' }],
  scoping_pause: [{ in: 'waiting_scoping_feedback', message: { type: 'cancellation', actor_id: 'nobody' } }], // sentinel: send nothing (see below)
};

export class Pilot {
  readonly bench: Bench;
  /** slug → cycle being piloted (the fakes only know the slug). */
  readonly cycles = new Map<string, number>();
  /** Digest published by the fake CI for each cycle (the latest). */
  readonly digests = new Map<number, string>();
  /** Requester of each piloted cycle (its feedback comes from them, I0). */
  readonly requesters = new Map<number, Actor>();
  #digestCounter = 0;

  constructor(bench: Bench) {
    this.bench = bench;
  }

  get base() {
    return this.bench.orch.base;
  }

  /** `requester`: the person who asks (REQUESTER by default; ADMIN for the "four eyes" scenarios). */
  async createCycle(slug: string, type: 'creation' | 'evolution' = 'creation', toolId?: number, requester: Actor = REQUESTER): Promise<number> {
    const d = type === 'creation'
      ? await this.bench.orch.newRequest({ type, name: slug.charAt(0).toUpperCase() + slug.slice(1), slug, owner_service: 'service-test', need: 'Track the department\'s vehicles' }, requester)
      : await this.bench.orch.newRequest({ type, tool_id: toolId!, need: 'Add a column' }, requester);
    // The fakes only know the slug: an evolution is registered under the tool's real slug.
    this.cycles.set(type === 'creation' ? slug : (await this.base.readCycle(d.cycle_id)).slug, d.cycle_id);
    this.requesters.set(d.cycle_id, requester);
    return d.cycle_id;
  }

  async state(cycleId: number): Promise<StateId> {
    return (await this.base.readCycle(cycleId)).state;
  }

  async history(cycleId: number): Promise<{ id: number; previous_state: string | null; state: string; trigger: string; actor: string; t: number }[]> {
    const r = await this.base.pool.query('SELECT id::int AS id, previous_state, state, trigger, actor, (extract(epoch from created_at) * 1000)::float8 AS t FROM tool_history WHERE cycle_id = $1 ORDER BY id', [cycleId]);
    return r.rows as { id: number; previous_state: string | null; state: string; trigger: string; actor: string; t: number }[];
  }

  async wait<T>(description: string, condition: () => Promise<T | undefined | false>, timeoutMs = 20_000): Promise<T> {
    const limit = Date.now() + timeoutMs;
    for (;;) {
      const v = await condition();
      if (v !== undefined && v !== false) return v;
      if (Date.now() > limit) throw new Error(`timeout while waiting for: ${description}`);
      await sleep(25);
    }
  }

  waitForState(cycleId: number, state: StateId, timeoutMs = 20_000): Promise<StateId> {
    return this.wait(`cycle ${cycleId} in state ${state}`, async () => {
      const e = await this.state(cycleId);
      return e === state ? e : undefined;
    }, timeoutMs);
  }

  /** Id of the cycle's W1 workflow (always `cycle-<id>`, even when resumed). */
  async workflowW1(cycleId: number): Promise<string> {
    return cycleWorkflowId(cycleId);
  }

  /** DBOS status of the cycle's W1 workflow. */
  async statusW1(cycleId: number): Promise<string | undefined> {
    return (await DBOS.getWorkflowStatus(cycleWorkflowId(cycleId)))?.status;
  }

  /**
   * True if W1's mailbox has no unread message left (everything sent has been handled or discarded). Setup
   * only: reads the internal schema `dbos.notifications`, which the engine never reads.
   */
  async mailboxEmpty(cycleId: number): Promise<boolean> {
    const r = await this.base.pool.query(`SELECT 1 FROM dbos.notifications WHERE destination_uuid = $1 AND topic = 'mailbox' AND consumed = false LIMIT 1`, [cycleWorkflowId(cycleId)]);
    return r.rowCount === 0;
  }

  /** Waits until the cycle's W1 workflow has ended (end notified, cleanup done). */
  waitForWorkflowEnd(cycleId: number, timeoutMs = 20_000): Promise<string> {
    return this.wait(`end of the workflow of cycle ${cycleId}`, async () => {
      const s = await DBOS.getWorkflowStatus(cycleWorkflowId(cycleId));
      return s !== null && s.status !== 'PENDING' && s.status !== 'ENQUEUED' ? s.status : undefined;
    }, timeoutMs);
  }

  /** Sends on behalf of the message's actor, with their hats (as the API would read them in their token). */
  send(cycleId: number, m: Message): Promise<SendResult> {
    return this.bench.orch.send(cycleId, m, hats(m));
  }

  /** Waits until the cycle is in a state where this message makes sense (it is getting there), then sends it. */
  async sendWhenExpected(cycleId: number, m: Message, timeoutMs = 10_000): Promise<void> {
    await this.wait(`cycle ${cycleId} ready to receive ${m.type}`, async () => ((await this.bench.orch.isExpected(cycleId, m)) ? true : undefined), timeoutMs).catch(() => undefined);
    const before = (await this.history(cycleId)).length;
    await this.send(cycleId, m);
    // The message is consumed when the workflow has moved (transition or trace): two successive messages do not overlap.
    await this.wait(`message ${m.type} consumed`, async () => ((await this.history(cycleId)).length > before ? true : undefined), 5_000).catch(() => undefined);
  }

  newDigest(): string {
    this.#digestCounter += 1;
    return digest(`ci:${process.pid}:${this.#digestCounter}`);
  }

  /** "All is well" message for a waiting state, or undefined if the state waits for nothing. */
  async happyMessage(cycleId: number, state: StateId, ciDigest?: string): Promise<Message | undefined> {
    switch (state) {
      case 'waiting_scoping_feedback': return { type: 'scoping_feedback', outcome: 'satisfied', actor_id: (this.requesters.get(cycleId) ?? REQUESTER).id };
      case 'waiting_preview_feedback': return { type: 'preview_feedback', outcome: 'satisfied', actor_id: (this.requesters.get(cycleId) ?? REQUESTER).id };
      case 'waiting_ci': {
        const emp = ciDigest ?? this.newDigest();
        this.digests.set(cycleId, emp);
        return happySignal(state, emp);
      }
      case 'preview_pipeline': return happySignal(state, '');
      default:
        if (STATES_WAITING_FOR_MESSAGE.has(state)) {
          // At Gate 2, the admin quotes the candidate digest they approve (the one the dashboard shows).
          const emp = state === 'gate_2' ? (await this.base.candidateDigest(cycleId)) ?? undefined : undefined;
          return { type: 'decision', gate: state, outcome: 'approved', actor_id: ADMIN.id, ...(emp !== undefined ? { digest: emp } : {}) };
        }
        return undefined;
    }
  }

  /**
   * Drives the cycle to `target` along the real path: happy fake answers (or the planned detour
   * for the gates), happy messages in the waiting states; stops as soon as the target is reached,
   * leaving waiting any request made from the target (the test scripts it afterwards).
   */
  async driveUntil(cycleId: number, target: StateId, options: { ciDigest?: string; timeoutMs?: number; slownesses?: Partial<Record<string, number>>; faultIn?: StateId; fault?: string } = {}): Promise<void> {
    const { engine: engine, forge, deployer: deployer } = this.bench;
    const autosBefore = { engine: engine.switchboard.auto, forge: forge.switchboard.auto, deployer: deployer.switchboard.auto };
    const cycleSlug = [...this.cycles.entries()].find(([, id]) => id === cycleId)?.[0];
    if (cycleSlug === undefined) throw new Error(`cycle ${cycleId} unknown to the pilot`);
    // Incident gate (D21): the cycle is driven to the chosen state (through its own detours), whose exit fails.
    const faultIn = options.faultIn ?? (target === 'gate_incident' ? 'scoping' : undefined);
    if (faultIn !== undefined) this.bench.faults.set(`${cycleId}/${faultIn}`, options.fault ?? 'simulated fault: database unavailable');
    const detours = (faultIn !== undefined ? DETOURS[faultIn] : DETOURS[target]) ?? [];
    const detour = (e: StateId) => detours.find((d) => d.in === e);
    const stateFor = async (slug: string): Promise<StateId | undefined> => (slug === cycleSlug ? this.state(cycleId) : undefined);

    engine.switchboard.auto = async (key, input) => {
      const e = await stateFor(key.split('/')[0]!);
      if (e === undefined || e === target) return undefined;
      const d = detour(e);
      if (d?.engine !== undefined) return d.engine(input.task_id);
      const slowness = options.slownesses?.[input.role];
      if (slowness !== undefined) await sleep(slowness);
      return happyResponse(input);
    };
    forge.switchboard.auto = async (key) => {
      const e = await stateFor(key.split(':')[1]!);
      if (e === undefined || e === target) return undefined;
      if (detour(e)?.forge === 'error') return { type: 'error', reason: 'HTTP 500: storage full' };
      return { type: 'ok' };
    };
    deployer.switchboard.auto = async (key) => {
      const e = await stateFor(key.split(':')[1]!);
      if (e === undefined || e === target) return undefined;
      if (detour(e)?.deployer === 'failed') return { type: 'failed', reason: 'health check failed after 60 s' };
      const slowness = options.slownesses?.[`deployment:${key.split(':')[0]!}`];
      if (slowness !== undefined) await sleep(slowness);
      return { type: 'ok' };
    };
    try {
      // The requests already waiting (left by an earlier piloting) go through the new policy.
      await engine.switchboard.reconsider();
      await forge.switchboard.reconsider();
      await deployer.switchboard.reconsider();
      const limit = Date.now() + (options.timeoutMs ?? 30_000);
      let lastVisit = '';
      for (;;) {
        const c = await this.base.readCycle(cycleId);
        if (c.state === target) return;
        if (c.finished_at !== null) throw new Error(`cycle ${cycleId} finished in ${c.state} before reaching ${target}`);
        if (Date.now() > limit) throw new Error(`cycle ${cycleId} stuck in ${c.state} (target ${target}); pending tasks: ${engine.inProgress().join(', ')}`);
        // State and number of lines read in the SAME snapshot (the last history line is the current state): read
        // separately, a stale state (waiting_ci) and an already advanced history (gate_1) made us send again the message of
        // the state just left, and keep a CI digest that W1 never received.
        const h = await this.history(cycleId);
        const state = h.at(-1)!.state as StateId;
        const visit = `${state}#${h.length}`;
        if (visit !== lastVisit && state === c.state) {
          const d = detour(state);
          // A "message" detour replaces the happy message; the cancellation sentinel means "send nothing" (pause through silence).
          const m = d?.message !== undefined ? (d.message.type === 'cancellation' ? undefined : d.message) : await this.happyMessage(cycleId, state, options.ciDigest);
          if (m !== undefined) {
            lastVisit = visit;
            await this.send(cycleId, m).catch(() => {}); // the state may have changed between the read and the send: the workflow ignores and traces it
          }
        }
        await sleep(25);
      }
    } finally {
      // Previous policy restored; whatever waits from the target stays waiting for the scenario.
      engine.switchboard.auto = autosBefore.engine;
      forge.switchboard.auto = autosBefore.forge;
      deployer.switchboard.auto = autosBefore.deployer;
    }
  }
}
