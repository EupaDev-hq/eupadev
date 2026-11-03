/**
 * Real deployer (ADR-014, step E5d): one SSH call per method to the forced command `eupadev-deployer` of the target VM
 * (the deployer role of infra/ansible). The script validates everything again; this side only builds the request line from
 * values it checked itself, and reads the one-line JSON answer.
 * Exit codes of the script: 0 = answer, 2 = request refused (never retried: `health: 'failed'` with the reason, or an error),
 * 1 = error on the target. 255 = ssh itself failed (connection refused or cut): bounded retry, safe because the script
 * converges (lock, "already done" check).
 * The mock-up (E5e) and the Prod switch (E5g) go through the same calls.
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import type { Deployer, Environment, DeploymentResult } from './contracts.ts';

export interface SshDeployerOptions {
  /** Address of the target VM per environment (mockup and preview: CI VM; prod: tools VM). */
  hosts: Record<Environment, string>;
  /** Engine private key (file readable by the engine only) and the targets' host keys (StrictHostKeyChecking=yes). */
  key: string;
  knownHosts: string;
  /** Registry host of the forge (the script accepts only its own registry; it is fixed there, never an argument). */
  registry: string;
  /** Attempts when ssh fails (exit 255), and pause between them. */
  attempts?: number;
  pauseMs?: number;
  /** E5e: archive of the scoping commit (GiteaForge.scopingArchive), sent on stdin to `deploy mockup`. */
  archive?: (slug: string, cycleId: number, signal?: AbortSignal) => Promise<Buffer>;
  /** Bound of one call (a deploy pulls an image and waits for health). */
  timeoutMs?: number;
}

export class DeployerError extends Error {
  override name = 'DeployerError';
}

const DIGEST = /^sha256:[0-9a-f]{64}$/;

export class SshDeployer implements Deployer {
  readonly #o: Required<Omit<SshDeployerOptions, 'archive'>> & Pick<SshDeployerOptions, 'archive'>;

  constructor(o: SshDeployerOptions) {
    this.#o = { attempts: 3, pauseMs: 2000, timeoutMs: 10 * 60_000, ...o };
  }

  async deploy(env: Environment, slug: string, cycleId: number, digest: string | null, signal?: AbortSignal): Promise<DeploymentResult> {
    if (env === 'mockup') return this.#mockup(slug, cycleId, signal);
    if (digest === null || !DIGEST.test(digest)) {
      return { digest: digest ?? '', url: '', health: 'failed', reason: `missing or invalid digest ("${digest}"): nothing asked of the target` };
    }
    const r = await this.#call(env, `deploy ${env} ${slug} ${cycleId} ${this.#o.registry}/eupadev/${slug}@${digest}`, signal);
    if (r.refusal !== undefined) return { digest: digest, url: '', health: 'failed', reason: `refused by the target: ${r.refusal}` };
    const d = r.answer as { digest: string | null; url: string; health: 'ok' | 'failed'; reason?: string };
    // M5: the digest the target reports as served (RepoDigests of the running image), never the requested one.
    return { digest: d.digest ?? 'unknown', url: d.url, health: d.health, ...(d.reason === undefined ? {} : { reason: d.reason }) };
  }

  /** The mock-up is the scoping commit's archive itself (ADR-009): its sha256 is the digest, checked again by the target. */
  async #mockup(slug: string, cycleId: number, signal?: AbortSignal): Promise<DeploymentResult> {
    if (this.#o.archive === undefined) return { digest: '', url: '', health: 'failed', reason: 'no forge to read the mock-up archive from' };
    const data = await this.#o.archive(slug, cycleId, signal);
    const sha = createHash('sha256').update(data).digest('hex');
    const r = await this.#call('mockup', `deploy mockup ${slug} ${cycleId} ${sha}`, signal, data);
    if (r.refusal !== undefined) return { digest: `sha256:${sha}`, url: '', health: 'failed', reason: `refused by the target: ${r.refusal}` };
    const d = r.answer as { digest: string; url: string; health: 'ok' | 'failed' };
    return { digest: d.digest, url: d.url, health: d.health };
  }

  async stop(env: Environment, slug: string, cycleId: number): Promise<void> {
    await this.#action('stop', env, slug, cycleId);
  }

  async remove(env: Environment, slug: string, cycleId: number): Promise<void> {
    await this.#action('remove', env, slug, cycleId);
  }

  async served(env: Environment, slug: string): Promise<{ digest: string; cycleId: number } | null> {
    const r = await this.#call(env, `served ${env} ${slug}`);
    if (r.refusal !== undefined) throw new DeployerError(`served ${env} ${slug} refused by the target: ${r.refusal}`);
    const s = r.answer as { digest: string | null; cycle: number } | null;
    // Digest unreadable on the target: "unknown", which never equals a tested digest.
    return s === null ? null : { digest: s.digest ?? 'unknown', cycleId: s.cycle };
  }

  /** stop / remove: "nothing to do" and "owned by another cycle" (G4) are answers, not errors. */
  async #action(command: string, env: Environment, slug: string, cycleId: number): Promise<void> {
    const r = await this.#call(env, `${command} ${env} ${slug} ${cycleId}`);
    if (r.refusal !== undefined) throw new DeployerError(`${command} ${env} ${slug} refused by the target: ${r.refusal}`);
  }

  async #call(env: Environment, line: string, signal?: AbortSignal, input?: Buffer): Promise<{ answer: unknown; refusal?: string }> {
    for (let trial = 1; ; trial++) {
      const s = await this.#ssh(this.#o.hosts[env], line, signal, input);
      if (s.code === 0 || s.code === 2) {
        let answer: unknown;
        try {
          answer = JSON.parse(s.stdout);
        } catch {
          throw new DeployerError(`${line.split(' ')[0]} ${env}: unreadable answer from the target ("${s.stdout.slice(0, 200)}")`);
        }
        return s.code === 2 ? { answer, refusal: String((answer as { refusal?: unknown }).refusal) } : { answer };
      }
      if (s.code === 255 && trial < this.#o.attempts) {
        await new Promise<void>((ok, ko) => {
          const t = setTimeout(ok, this.#o.pauseMs);
          signal?.addEventListener('abort', () => { clearTimeout(t); ko(signal.reason); }, { once: true });
        });
        continue;
      }
      throw new DeployerError(`${line.split(' ')[0]} ${env}: exit code ${s.code} after ${trial} attempt(s): ${(s.stdout + s.stderr).trim().slice(-300)}`);
    }
  }

  #ssh(host: string, line: string, signal?: AbortSignal, input?: Buffer): Promise<{ code: number; stdout: string; stderr: string }> {
    const argv = ['-i', this.#o.key, '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=yes',
      '-o', `UserKnownHostsFile=${this.#o.knownHosts}`, '-o', 'ConnectTimeout=20', `deployment@${host}`, line];
    return new Promise((ok, ko) => {
      const child = execFile('ssh', argv, { timeout: this.#o.timeoutMs, maxBuffer: 1 << 20, ...(signal ? { signal } : {}) }, (e, stdout, stderr) => {
        if (e === null) return ok({ code: 0, stdout, stderr });
        if (typeof e.code === 'number') return ok({ code: e.code, stdout, stderr });
        ko(e.name === 'AbortError' ? e : new DeployerError(`ssh to ${host}: ${e.killed ? `no answer within ${this.#o.timeoutMs} ms` : e.message}`));
      });
      // A target that answers without reading (mock-up already in place) closes stdin early: not an error.
      child.stdin?.on('error', () => {});
      child.stdin?.end(input);
    });
  }
}
