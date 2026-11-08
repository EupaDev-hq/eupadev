/**
 * Fake implementations of the outside world (ROADMAP §8.11 no. 18): no AI call, no forge,
 * no container. Each engine call waits for an answer scripted by the test (prepared in
 * advance, given while waiting, or computed by an `auto` function), and everything is logged
 * for the assertions. The same task asked again (DBOS replay) gets the same answer.
 */
import { createHash } from 'node:crypto';
import type {
  Deployer, TaskInput, Environment, External, Forge, CoreUpdate, AgentEngine, Notifications, DeploymentResult, MergeResult,
  IntegrationResult, Role, RoleCode, PublishedRole, TaskOutput, Registration,
} from './contracts.ts';
import { CODE_ROLES, ownerRole } from './contracts.ts';
import type { Message } from '../messages.ts';
import type { Report, Finding } from '../agent-engine/report.ts';
import type { Cause } from '../hardening/diagnosis.ts';
import type { Orchestrator } from '../orchestrator.ts';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const digest = (seed: string) => `sha256:${sha256(seed)}`;

interface Pending<E, R> { key: string; input: E; resolve: (r: R) => void; reject: (e: Error) => void }

/** Generic switchboard: pending requests, prepared answers, automatic answer, memory per idempotency key. */
export class Switchboard<E, R> {
  readonly pending: Pending<E, R>[] = [];
  readonly prepared = new Map<string, R[]>();
  readonly log: { key: string; input: E }[] = [];
  readonly #memory = new Map<string, R>();
  /** Answer computed on the fly (test driver, "everything succeeds" mode); `undefined` = leave it pending. */
  auto: ((key: string, input: E) => Promise<R | undefined>) | undefined;

  async ask(key: string, input: E, idempotence?: string, signal?: AbortSignal, fallbackKeys: string[] = []): Promise<R> {
    this.log.push({ key, input });
    if (idempotence !== undefined && this.#memory.has(idempotence)) return this.#memory.get(idempotence)!;
    const retain = (r: R) => { if (idempotence !== undefined) this.#memory.set(idempotence, r); return r; };
    for (const k of [key, ...fallbackKeys]) {
      const file = this.prepared.get(k);
      if (file !== undefined && file.length > 0) return retain(file.shift()!);
    }
    // Policy changed DURING the evaluation (asynchronous auto): `reconsider` did not see this request, not parked yet;
    // so it goes before the new policy, otherwise it would stay pending with nobody looking at it again.
    for (let policy = this.auto; policy !== undefined; ) {
      const r = await policy(key, input);
      if (r !== undefined) return retain(r);
      if (this.auto === policy) break;
      policy = this.auto;
    }
    return new Promise<R>((resolve, reject) => {
      const wait: Pending<E, R> = { key, input, resolve: (r) => resolve(retain(r)), reject };
      this.pending.push(wait);
      signal?.addEventListener('abort', () => {
        const i = this.pending.indexOf(wait);
        if (i >= 0) this.pending.splice(i, 1);
        reject(new Error(`interrupted: ${String(signal.reason)}`));
      }, { once: true });
    });
  }

  /** Answers the first pending request whose key is accepted, otherwise prepares the answer for the next one. */
  answer(keys: string[], answer: R): 'answered' | 'prepared' {
    const i = this.pending.findIndex((a) => keys.includes(a.key));
    if (i >= 0) {
      const [a] = this.pending.splice(i, 1);
      a!.resolve(answer);
      return 'answered';
    }
    const key = keys[0]!;
    if (!this.prepared.has(key)) this.prepared.set(key, []);
    this.prepared.get(key)!.push(answer);
    return 'prepared';
  }

  pendingFor(prefix = ''): Pending<E, R>[] {
    return this.pending.filter((a) => a.key.startsWith(prefix));
  }

  /** Puts the pending requests before `auto` again (after a policy change); answers those it decides. */
  async reconsider(): Promise<void> {
    if (this.auto === undefined) return;
    for (const a of [...this.pending]) {
      const r = await this.auto(a.key, a.input);
      if (r === undefined) continue;
      const i = this.pending.indexOf(a);
      if (i >= 0) { this.pending.splice(i, 1); a.resolve(r); }
    }
  }

  reset(): void {
    for (const a of this.pending.splice(0)) a.reject(new Error('switchboard reset'));
    this.prepared.clear();
    this.log.length = 0;
    this.#memory.clear();
    this.auto = undefined;
  }
}

// ── Fake agent engine ─────────────────────────────────────────────────────────────────────────────

export type EngineResponse =
  /** `report` may be a function of the input (the task id is only known at call time). */
  | { type: 'report'; report: unknown | ((input: Omit<TaskInput, 'signal'>) => unknown); cost_usd?: number | null; duration_s?: number; tree_hash?: string | null; tokens?: { input: number; output: number } }
  /** The agent ran but produced no report (container stopped, broken tool…): known cost. */
  | { type: 'failed'; reason: string; cost_usd?: number }
  /** Never answers: the task's timeout decides (unknown cost = cap). */
  | { type: 'silence' };

/** Decision A: scripted answer of the core bump; `up_to_date` (nothing to do) when the scenario scripts nothing. */
export type CoreResponse = { type: 'up_to_date' } | { type: 'update'; from: string; to: string } | { type: 'error'; reason: string };

export class FakeEngine implements AgentEngine {
  readonly switchboard = new Switchboard<Omit<TaskInput, 'signal'>, EngineResponse>();
  /** Decision A: answers prepared for the next core bumps (consumed in order), and the log of every bump asked. */
  readonly preparedCores: CoreResponse[] = [];
  readonly cores: { tool: string; response: CoreResponse }[] = [];
  /** Cost and duration declared by default (the step "the fake engine declares a cost of $3 per task" changes them). */
  defaultCost = 0.5;
  defaultDuration_s = 60;
  /** Last tree digest returned per code role and per tool (for the steps "without changing any file"). */
  readonly lastDigests = new Map<string, string>();
  /** Tasks whose stop signal was received (timeout, cancellation): the "container" was stopped. */
  readonly stopped = new Set<string>();
  /** Roles whose tasks stay "preparing" (clone, image check…): no container started, no launch counted, until the stop signal. */
  readonly preparing = new Set<Role>();

  static key(tool: string, role: string): string {
    return `${tool}/${role}`;
  }

  async execute(input: TaskInput): Promise<TaskOutput> {
    const { signal, ...noSignal } = input;
    signal.addEventListener('abort', () => this.stopped.add(input.task_id), { once: true });
    const interrupted = () => new Promise<TaskOutput>((_, reject) => signal.addEventListener('abort', () => reject(new Error(`interrupted: ${String(signal.reason)}`)), { once: true }));
    if (this.preparing.has(input.role)) return interrupted();
    // The pending request is the "running container": counted before it starts, like the real launcher.
    await input.launched();
    const answer = await this.switchboard.ask(FakeEngine.key(input.tool, input.role), noSignal, input.task_id, signal, [`*/${input.role}`]);
    if (answer.type === 'failed') return { report: null, error: answer.reason, cost_usd: answer.cost_usd ?? this.defaultCost, duration_s: this.defaultDuration_s, tree_hash: null };
    if (answer.type === 'silence') return interrupted();
    const treeKey = FakeEngine.key(input.tool, input.role);
    let tree: string | null = null;
    if ((CODE_ROLES as readonly string[]).includes(input.role)) {
      tree = answer.tree_hash === undefined ? sha256(`${input.task_id}`) : answer.tree_hash;
      if (tree !== null) this.lastDigests.set(treeKey, tree);
    }
    const report = typeof answer.report === 'function' ? (answer.report as (e: Omit<TaskInput, 'signal'>) => unknown)(noSignal) : answer.report;
    return { report: report, cost_usd: answer.cost_usd === undefined ? this.defaultCost : answer.cost_usd, duration_s: answer.duration_s ?? this.defaultDuration_s, tree_hash: tree, ...(answer.tokens === undefined ? {} : { tokens: answer.tokens }) };
  }

  async coreUpToDate(tool: string): Promise<CoreUpdate | null> {
    const response = this.preparedCores.shift() ?? { type: 'up_to_date' };
    this.cores.push({ tool, response });
    if (response.type === 'error') throw new Error(response.reason);
    if (response.type === 'up_to_date') return null;
    return { from: response.from, to: response.to, package_json: `{"dependencies":{"@eupadev/core":"${response.to}"}}\n`, lockfile: `  '@eupadev/core@${response.to}':\n` };
  }

  /** Scripts the answer for a role (and a tool if given, otherwise the first pending task of that role). */
  answer(role: Role, answer: EngineResponse, tool?: string): 'answered' | 'prepared' {
    return this.switchboard.answer(tool === undefined ? [...this.switchboard.pending.filter((a) => a.key.endsWith(`/${role}`)).map((a) => a.key), `*/${role}`] : [FakeEngine.key(tool, role)], answer);
  }

  /** Inputs received for a given task (context, instructions), in call order. */
  calls(task_id: string): Omit<TaskInput, 'signal'>[] {
    return this.switchboard.log.filter((j) => j.input.task_id === task_id).map((j) => j.input);
  }

  /** Running "containers": tasks whose request is still waiting for an answer. */
  inProgress(): string[] {
    return this.switchboard.pending.map((a) => a.input.task_id);
  }
}

// ── Ready-made reports ────────────────────────────────────────────────────────────────────────────

const REVIEW_ROLES_SET = new Set<string>(['security-reviewer', 'quality-reviewer']);

export function compliantReport(role: Role, task_id: string, extra: Partial<Report> = {}): Report {
  return {
    schema_version: '1', role, task_id: task_id, status: 'done', summary: `Task ${role} finished without a deviation.`, blocked_reason: null,
    files_changed: [], verifications: [{ command: 'pnpm run verify', result: 'pass', details: '' }], findings: [],
    category_verdicts: REVIEW_ROLES_SET.has(role) ? [{ category: 'security.md#Requests', verdict: 'compliant', evidence: 'api/ reviewed' }] : [],
    assumptions: [], ...(role === 'scoping' ? { capabilities_used: [], capabilities_missing: [] } : {}), ...extra,
  };
}

/** Reviewer report with deviations; `line`, `message`, `category`, `id`, `previous_id` optional. */
export type ScriptedDeviation = Partial<Finding> & { rule: string; file: string };
export function reportWithDeviations(role: Role, task_id: string, deviations: readonly ScriptedDeviation[]): Report {
  const findings: Finding[] = deviations.map((e, i) => ({
    id: e.id ?? `F-${String(i + 1).padStart(3, '0')}`,
    rule: e.rule,
    category: e.category ?? 'security.md#Requests',
    severity: e.severity ?? 'high',
    file: e.file,
    line: e.line ?? null,
    evidence: e.evidence ?? `deviation ${e.rule} in ${e.file}`,
    owner_role: e.owner_role ?? ownerRole(e.file) ?? 'builder',
    previous_id: e.previous_id ?? null,
  }));
  return compliantReport(role, task_id, { summary: `${findings.length} deviation(s) found.`, findings });
}

export function blockedReport(role: Role, task_id: string, reason: string): Report {
  return compliantReport(role, task_id, { status: 'blocked', blocked_reason: reason, summary: `Blocked: ${reason}` });
}

/** ADR-027: diagnosis report whose cause and recommendation agree (`readDiagnosis`); the pre-check lines are its default evidence. */
export function diagnosisReport(task_id: string, cause: Cause, explanation: string, recommendation: { top_up_usd?: number; question?: string } = {}, evidence: string[] = ['see the orchestrator pre-check']): Report {
  return compliantReport('diagnosis', task_id, {
    summary: explanation.slice(0, 600),
    diagnosis: { cause, explanation, evidence, recommendation: { top_up_usd: recommendation.top_up_usd ?? null, question: recommendation.question ?? null } },
  });
}

/** Verdict of the overlap search: the report's `verdict` field (C1), the reason in the summary. */
export function overlapReport(task_id: string, verdict: 'plausible' | 'not_plausible', reason = '', tool?: string): Report {
  const summary = reason !== '' ? reason : verdict === 'plausible' ? 'A tool of the registry may already cover this need.' : 'No tool of the registry covers this need.';
  return compliantReport('overlap', task_id, { verdict, summary: summary, ...(tool === undefined ? {} : { overlapping_tool: tool }) });
}

// ── Fake forge ────────────────────────────────────────────────────────────────────────────────────

export type ForgeResponse =
  | { type: 'ok' }
  | { type: 'out_of_scope'; files: { file: string; role: Role }[] }
  | { type: 'conflict'; files: string[] }
  | { type: 'error'; reason: string };

export class FakeForge implements Forge {
  readonly switchboard = new Switchboard<{ operation: string; slug: string; iteration?: number }, ForgeResponse>();
  readonly repos = new Map<string, { creations: number }>();
  /** Successful squashes per tool (one CI per squash). */
  readonly merges = new Map<string, number>();
  /** Validated work published into main (scoping, contract, core bump), in order; no branch in the fake, so no switchboard: always ok. */
  readonly publications: { slug: string; cycleId: number; role: PublishedRole | 'core'; at: number }[] = [];
  /** ADR-027: commits ahead of main on a code role's branch, scripted per `<slug>/<cycle>/<role>`; 0 (no branch) otherwise. */
  readonly branchCommits = new Map<string, number>();

  #repo(slug: string) {
    if (!this.repos.has(slug)) this.repos.set(slug, { creations: 0 });
    return this.repos.get(slug)!;
  }

  async createRepo(slug: string, signal?: AbortSignal): Promise<void> {
    const r = await this.switchboard.ask(`repo:${slug}`, { operation: 'repo', slug }, undefined, signal, ['repo:*']);
    if (r.type === 'error') throw new Error(r.reason);
    const d = this.#repo(slug);
    if (d.creations === 0) d.creations = 1; // idempotent: an existing repository is not created again
  }

  /** Renames done at Gate 1, in order (the fake has no branch: the repository entry and the scripted commits follow the slug). */
  readonly renames: { from: string; to: string }[] = [];

  async renameTool(from: string, to: string): Promise<void> {
    this.renames.push({ from, to });
    const d = this.repos.get(from);
    if (d !== undefined && !this.repos.has(to)) {
      this.repos.delete(from);
      this.repos.set(to, d);
    }
    for (const [key, n] of [...this.branchCommits]) {
      if (key.startsWith(`${from}/`)) { this.branchCommits.delete(key); this.branchCommits.set(`${to}/${key.slice(from.length + 1)}`, n); }
    }
  }

  async publish(slug: string, cycleId: number, role: PublishedRole): Promise<void> {
    this.publications.push({ slug, cycleId, role, at: Date.now() });
  }

  async publishCore(slug: string, cycleId: number): Promise<void> {
    this.publications.push({ slug, cycleId, role: 'core', at: Date.now() });
  }

  async roleBranchCommits(slug: string, cycleId: number): Promise<Record<RoleCode, number>> {
    return Object.fromEntries(CODE_ROLES.map((r) => [r, this.branchCommits.get(`${slug}/${cycleId}/${r}`) ?? 0])) as Record<RoleCode, number>;
  }

  /** Gate 1 (D-E5): names of the fake contract and purge, scripted per slug or the same for every tool. */
  readonly registrations = new Map<string, Registration>();
  async registration(slug: string): Promise<Registration> {
    return this.registrations.get(slug) ?? { roles: ['reader', 'admin'], retentions: ['RETENTION_AUDIT', 'RETENTION_REQUESTS'] };
  }

  async integrate(slug: string, _cycleId: number, iteration: number, signal?: AbortSignal): Promise<IntegrationResult> {
    const r = await this.switchboard.ask(`integration:${slug}`, { operation: 'integration', slug, iteration }, undefined, signal, ['integration:*']);
    if (r.type === 'error') throw new Error(r.reason);
    if (r.type === 'conflict') return { result: 'conflict', files: r.files };
    return { result: 'ok' };
  }

  async merge(slug: string, _cycleId: number, iteration: number, signal?: AbortSignal): Promise<MergeResult> {
    const r = await this.switchboard.ask(`merge:${slug}`, { operation: 'merge', slug, iteration }, undefined, signal, ['merge:*']);
    if (r.type === 'error') throw new Error(r.reason);
    if (r.type === 'out_of_scope') return { result: 'out_of_scope', files: r.files };
    this.merges.set(slug, (this.merges.get(slug) ?? 0) + 1);
    return { result: 'ok' };
  }

  answer(operation: 'repo' | 'integration' | 'merge', answer: ForgeResponse, slug?: string): 'answered' | 'prepared' {
    return this.switchboard.answer(slug === undefined ? [...this.switchboard.pending.filter((a) => a.key.startsWith(`${operation}:`)).map((a) => a.key), `${operation}:*`] : [`${operation}:${slug}`], answer);
  }
}

// ── Fake deployer (W4) ────────────────────────────────────────────────────────────────────────────

/** `served` (M5): the deployer actually serves ANOTHER digest than the requested one (wrong image, corrupted registry…). */
export type DeploymentResponse = { type: 'ok'; after_s?: number; served?: string } | { type: 'failed'; reason: string };

export class FakeDeployer implements Deployer {
  readonly switchboard = new Switchboard<{ env: Environment; slug: string; digest: string | null }, DeploymentResponse>();
  /** What runs: per environment and tool, the served digest (prod: the last healthy one, D19) and the cycle that deployed it (G4). */
  readonly active = new Map<string, { digest: string; state: 'running' | 'stopped' | 'removed'; cycle: number }>();
  readonly log: { env: Environment; slug: string; digest: string; health: 'ok' | 'failed' }[] = [];
  readonly #domain: string;

  constructor(domain: string) {
    this.#domain = domain;
  }

  static key(env: Environment, slug: string): string {
    return `${env}:${slug}`;
  }

  url(env: Environment, slug: string): string {
    return env === 'prod' ? `https://${slug}.${this.#domain}` : `https://${slug}.${env === 'mockup' ? 'scoping' : 'preview'}.${this.#domain}`;
  }

  async deploy(env: Environment, slug: string, cycleId: number, requestedDigest: string | null, signal?: AbortSignal): Promise<DeploymentResult> {
    const r = await this.switchboard.ask(FakeDeployer.key(env, slug), { env, slug, digest: requestedDigest }, undefined, signal, [`${env}:*`]);
    // The mock-up is built by the CI (W4): its digest is born here; Preview and Prod deploy the requested digest
    // (or, when scripted, another one: M5).
    const emp = (r.type === 'ok' ? r.served : undefined) ?? requestedDigest ?? digest(`mockup:${slug}:${this.log.length}`);
    const url = this.url(env, slug);
    if (r.type === 'failed') {
      this.log.push({ env, slug, digest: emp, health: 'failed' });
      return { digest: emp, url, health: 'failed', reason: r.reason };
    }
    this.active.set(FakeDeployer.key(env, slug), { digest: emp, state: 'running', cycle: cycleId });
    this.log.push({ env, slug, digest: emp, health: 'ok' });
    return { digest: emp, url, health: 'ok' };
  }

  async stop(env: Environment, slug: string, cycleId: number): Promise<void> {
    const a = this.active.get(FakeDeployer.key(env, slug));
    if (a !== undefined && a.cycle === cycleId && a.state === 'running') a.state = 'stopped';
  }

  /** G4: only what this cycle deployed. */
  async remove(env: Environment, slug: string, cycleId: number): Promise<void> {
    const a = this.active.get(FakeDeployer.key(env, slug));
    if (a !== undefined && a.cycle === cycleId) a.state = 'removed';
  }

  async served(env: Environment, slug: string): Promise<{ digest: string; cycleId: number } | null> {
    const a = this.active.get(FakeDeployer.key(env, slug));
    return a !== undefined && a.state === 'running' ? { digest: a.digest, cycleId: a.cycle } : null;
  }

  /** Digest that answers for an environment, or null if nothing runs. */
  running(env: Environment, slug: string): string | null {
    const a = this.active.get(FakeDeployer.key(env, slug));
    return a !== undefined && a.state === 'running' ? a.digest : null;
  }

  answer(env: Environment, answer: DeploymentResponse, slug?: string): 'answered' | 'prepared' {
    return this.switchboard.answer(slug === undefined ? [...this.switchboard.pending.filter((a) => a.key.startsWith(`${env}:`)).map((a) => a.key), `${env}:*`] : [FakeDeployer.key(env, slug)], answer);
  }
}

// ── Fake notifications ────────────────────────────────────────────────────────────────────────────

export interface SentMail { recipient: 'admin' | 'requester'; cycleId: number; subject: string; content: string }

export class FakeNotifications implements Notifications {
  readonly sent: SentMail[] = [];
  readonly #keys = new Set<string>();
  /** M9: a send whose key already succeeded is not done again (the send is counted when it succeeds). */
  async notify(recipient: 'admin' | 'requester', cycleId: number, subject: string, content: string, key?: string): Promise<void> {
    if (key !== undefined) {
      if (this.#keys.has(key)) return;
      this.#keys.add(key);
    }
    this.sent.push({ recipient: recipient, cycleId, subject: subject, content: content });
  }
  for(cycleId: number, recipient?: 'admin' | 'requester'): SentMail[] {
    return this.sent.filter((e) => e.cycleId === cycleId && (recipient === undefined || e.recipient === recipient));
  }
}

// ── "All is well" answers and automatic fake world (E0) ─────────────────────────────────────────────

/** The engine's "all is well" answer: compliant report, not-plausible verdict for the overlap search, slow progress for a diagnosis. */
export function happyResponse(input: { role: string; task_id: string }): EngineResponse {
  const report = input.role === 'overlap' ? overlapReport(input.task_id, 'not_plausible')
    : input.role === 'diagnosis' ? diagnosisReport(input.task_id, 'slow_progress', 'The agents are moving forward but ran out of budget.', { top_up_usd: 10 })
      : compliantReport(input.role as Role, input.task_id);
  return { type: 'report', report: report };
}

/** The forge's "all is well" signal for a state waiting for it (green CI with its digest, green Preview pipeline), otherwise undefined. */
export function happySignal(state: string, ciDigest: string): Message | undefined {
  if (state === 'waiting_ci') return { type: 'ci_finished', outcome: 'green', digest: ciDigest, checks: [{ check: 'lint', result: 'green' }, { check: 'tests', result: 'green' }, { check: 'analysis', result: 'green' }] };
  if (state === 'preview_pipeline') return { type: 'preview_pipeline_finished', outcome: 'green', checks: [{ check: 'dast', result: 'green' }, { check: 'accessibility', result: 'green' }] };
  return undefined;
}

/**
 * E0 (`EUPADEV_EXTERNAL=fake-auto`): the fake outside world that answers "all is well" on its own — agent
 * engine, forge, deployer; notifications logged on standard output. Only the humans (feedback, gate
 * decisions) remain to be done, through the local API. The forge's signals come from `launchFakeWatcher`.
 * ponytail: switchboard and send logs kept in memory without limit; acceptable in the lab, to be bounded if the fake
 * mode runs for months.
 */
export function automaticFakes(domain: string): External {
  const engine = new FakeEngine();
  engine.switchboard.auto = async (_key, input) => happyResponse(input);
  const forge = new FakeForge();
  forge.switchboard.auto = async () => ({ type: 'ok' });
  const deployer = new FakeDeployer(domain);
  deployer.switchboard.auto = async () => ({ type: 'ok' });
  const notifications = new FakeNotifications();
  const notify = notifications.notify.bind(notifications);
  notifications.notify = async (recipient, cycleId, subject, content, key) => {
    console.log(`fake notification → ${recipient}, cycle ${cycleId}: ${subject}`);
    return notify(recipient, cycleId, subject, content, key);
  };
  return { engine: engine, forge, deployer: deployer, notifications };
}

/**
 * Fake watcher: polls the open cycles and sends the forge's "all is well" signal to those waiting for it (green
 * CI, green Preview pipeline), once per pass through the state (the engine deduplicates by `visit` anyway, B9).
 * Real forge (E4, E5f): the CI and the Preview pipeline come from the real watcher (`Orchestrator.watch`).
 * Returns the stop function.
 */
export function launchFakeWatcher(orch: Pick<Orchestrator, 'base' | 'send' | 'external'>, intervalMs: number): () => void {
  const realCi = orch.external.forge.ciFinished !== undefined;
  const realPreview = orch.external.forge.previewPipelineFinished !== undefined;
  const sent = new Set<string>();
  let inProgress = false;
  const poll = async () => {
    if (inProgress) return;
    inProgress = true;
    try {
      for (const { id } of await orch.base.openCycles()) {
        try {
          const c = await orch.base.readCycle(id);
          const passage = `${id}#${c.visit}`;
          const m = happySignal(c.state, digest(`ci:${passage}`));
          if (m === undefined || sent.has(passage) || (realCi && m.type === 'ci_finished') || (realPreview && m.type === 'preview_pipeline_finished')) continue;
          if ((await orch.send(id, m)).transmitted) sent.add(passage);
        } catch (e) {
          console.error(`fake watcher, cycle ${id}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    } catch (e) {
      console.error(`fake watcher: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      inProgress = false;
    }
  };
  const timer = setInterval(() => void poll(), intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
