/**
 * Real engine: Claude Code in a throwaway container, behind `AgentEngine` (ROADMAP §8.16 L1-L5; ADR-013). Runs on the
 * agents VM, with the local Docker. No dependency: `docker`, `git` and `tar` on the command line, arguments as an array
 * (never a shell on the launcher side).
 *
 * Security:
 * - the agent sees no secret: the `svc-agent` token stays with the launcher (HTTP header passed to Git through
 *   `GIT_CONFIG_*` variables, never as an argument, in a URL or a message); the AI key is added by the AI proxy;
 * - the launcher NEVER runs Git in the repository written by the agent: it receives a `git bundle` (data) and
 *   fetches it into its own bare clone, objects checked (`transfer.fsckObjects`), hooks off (`core.hooksPath`);
 * - it pushes itself, without force, to the task's branch only; the commits must descend from the base;
 * - the inputs go through the container's standard input (no host mount, no giant argument).
 *
 * Replay (DBOS resumes the step after a hard stop): everything carrying the task's name is removed first, and the
 * base is the tip of the task's branch if it exists: no duplicate container, fast-forward push.
 * Base (E7): main, or the task's branch when it exists (replay, next round) with main merged into it by the launcher:
 * the agent continues its work AND gets what main received since (published scoping and contract, squashes of earlier
 * rounds), instead of a conflict deferred to the integration; the merge commit is the launcher's, never counted as the
 * agent's content.
 * Stop (`signal`): immediate `docker rm -f` of the container; the cleanup (network, volume, folder) is done in every case.
 */
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import { join } from 'node:path';
import { PATHS_BY_ROLE, EFFORTS, CODE_ROLES, REVIEW_ROLES, inScope, type TaskInput, type CoreUpdate, type AgentEngine, type Role, type RoleCode, type TaskOutput } from './contracts.ts';
import { forbiddenPath } from '../agent-engine/forbidden-paths.ts';
import { invisibleCharacter } from '../text.ts';
/**
 * Roles that change nothing (reviewers; overlap search): no permission, and the launcher fetches
 * no bundle, so nothing is pushed (ADR-020: a reviewer's clone is ordinary; the harness refuses writes,
 * the launcher discards them).
 */
export const READ_ROLES: readonly Role[] = ['overlap', 'security-reviewer', 'quality-reviewer'];
/**
 * Roles without a repository: `overlap` runs before the tool's repository is created. No clone,
 * no bundle, no push; empty working folder, `task.md` (with the tool catalogue as data) is its only input.
 */
export const ROLES_WITHOUT_REPO: readonly Role[] = ['overlap'];
/** A-R6: roles given the reference tool, and what of it they get (no lockfile, no dependency folder). */
export const EXAMPLE_ROLES: readonly Role[] = ['contract', 'tests', 'builder'];
const EXAMPLE_CONTENT =['README.md', 'openapi.yaml', 'api', 'db', 'web', 'tests'] as const;
/**
 * Never WebSearch nor WebFetch: they would go out around the egress proxy. In `--bare` mode, Claude Code exposes
 * only Bash, Read and Edit (headless doc: "In bare mode Claude has access to the Bash, file read, and file edit tools";
 * trial against the fake upstream on 2026-10-15: Write, Glob and Grep named in `--tools` stay absent from `tools[]`). So the
 * lists say what exists: a code role creates its files through Bash and changes them through Edit.
 */
const CODE_TOOLS = 'Bash,Read,Edit';
/** `overlap`: `Read` only (no repository, no need to search); never Bash as a side effect of the reviewers. */
const READ_TOOLS = 'Read';
/**
 * Reviewers (A-R4, ADR-020): Bash WITHOUT permission. In `dontAsk`, Bash runs only Claude Code's read-only set
 * (cat, grep, find, read-only git…), everything else is refused (permissions doc); reads outside the working
 * folders are cut by `blockReadsOutsideWorkingDirectories` of the image's managed settings.
 */
const REVIEW_TOOLS = 'Bash,Read';
/** Margin under the cap: `--max-budget-usd` is an estimate that can be exceeded (doc: "leave headroom"). */
const BUDGET_SHARE = 5 / 6;
/** Bounded container output (report + bundle in base64). */
const MAX_OUTPUT_BYTES = 256 * 1024 * 1024;
const PROMPT = 'Read /tmp/task/task.md (the data of your task) and carry out the task following your instructions. End with your report.';
export const LABEL = 'eupadev.task';

/**
 * Script run in the container (the only launcher code that runs there). Inputs: tar archive on standard input.
 * Framed output: lines `EUPADEV-<FIELD> <base64>`; the launcher reads the last one of each.
 */
/**
 * Claude Code command line (cli-reference doc), parameterised by the `FA_*` variables.
 * Replayed as is, without network, by the agents image's CI (`images/agent/check/claude.sh`, generated by
 * `scripts/generate-claude-check.ts`), and with a fake upstream server by `images/agent/check/upstream-trial/`.
 * - `--bare`: no hooks, no MCP, no CLAUDE.md, no skills; `--restricted`: the clone's user, project and local settings
 *   (written by an agent: `env` block, `ANTHROPIC_BASE_URL`…) are no longer read, only the image's managed settings
 *   and `--settings` count; `bypassPermissions` refused; file tools confined to the working folders.
 * - `--permission-mode dontAsk` for ALL roles: whatever would ask for a confirmation is refused (the harness's protected
 *   paths included); code roles get Bash and Edit through `--allowedTools` (`$FA_PERMISSIONS`,
 *   unquoted: zero or more words), read-only roles nothing more (reviewers: Bash reduced to the read-only set).
 * - `Read(//tmp/task/**)` + `--add-dir /tmp/task`: the task's data is outside the working folder; without the
 *   rule, a role in dontAsk did not read its task (paid trial of 2026-10-15); under `--restricted`, the folder must
 *   also be a working folder (`--add-dir`; under `--bare` it loads no configuration from there).
 * - `--strict-mcp-config`: no MCP server from a file of the clone.
 */
export const CLAUDE_LINE = `claude --bare --restricted -p "$FA_PROMPT" --append-system-prompt-file /tmp/task/instructions.md \\
  --model "$FA_MODEL" --effort "$FA_EFFORT" --tools "$FA_TOOLS" --permission-mode dontAsk \\
  --allowedTools 'Read(//tmp/task/**)' $FA_PERMISSIONS --add-dir /tmp/task --strict-mcp-config \\
  --max-turns "$FA_TURNS" --max-budget-usd "$FA_BUDGET" \\
  --output-format json --json-schema "$(cat /tmp/task/report.schema.json)" --no-session-persistence`;

export function containerScript(withRepo: boolean): string {
  const enter = withRepo
    ? `git clone -q -b work /tmp/task/input.bundle "$HOME/repo" || exit 91
cd "$HOME/repo" || exit 92`
    : `mkdir "$HOME/work" && cd "$HOME/work" || exit 92`;
  const exit = withRepo
    ? `cd "$HOME/repo" && git bundle create -q /tmp/output/output.bundle HEAD 2>/dev/null || : >/tmp/output/output.bundle`
    : ': >/tmp/output/output.bundle';
  return `set -u
mkdir /tmp/task /tmp/output && tar -x -f - -C /tmp/task || exit 90
${enter}
${CLAUDE_LINE} \\
  </dev/null >/tmp/output/result.json 2>/tmp/output/errors.txt
code=$?
${exit}
b64() { base64 | tr -d '\\n'; }
printf '\\nEUPADEV-CODE %s\\n' "$code"
printf 'EUPADEV-RESULT %s\\n' "$(b64 </tmp/output/result.json)"
printf 'EUPADEV-ERRORS %s\\n' "$(tail -c 65536 /tmp/output/errors.txt | b64)"
printf 'EUPADEV-BUNDLE '; b64 </tmp/output/output.bundle; printf '\\n'
`;
}
export const CONTAINER_SCRIPT = containerScript(true);

/**
 * Core of the tools (ADR-023): `pnpm fetch` in a SEPARATE short-lived container, before the agent's, into the task
 * volume. Inputs on stdin (tar): `npmrc` (scope registry + read badge) and the tool's `pnpm-lock.yaml`, extracted in
 * /tmp (tmpfs of this container only). The store lands in pnpm's default place (`~/.local/share/pnpm/store`, same
 * volume as the agent's clone: hard links work); `~/.npmrc` gets the scope's registry WITHOUT the badge, so the
 * agent's pnpm resolves `@eupadev/core` from the store (frozen lockfile) and fails clearly on any other version
 * (the forge is unreachable from its network). Only the lockfile comes from the repository; pnpm settings are fixed
 * here (core exempt from the minimum release age, like the template's pnpm-workspace.yaml).
 */
export const CORE_SCRIPT = `set -eu
mkdir /tmp/core && tar -x -f - -C /tmp/core
printf '@eupadev:registry=%s\\n' "$FA_CORE_REGISTRY" > "$HOME/.npmrc"
mkdir "$HOME/.core-fetch" && cp /tmp/core/pnpm-lock.yaml "$HOME/.core-fetch/"
printf 'minimumReleaseAgeExclude:\\n  - "@eupadev/core"\\n' > "$HOME/.core-fetch/pnpm-workspace.yaml"
cd "$HOME/.core-fetch"
code=0
NPM_CONFIG_USERCONFIG=/tmp/core/npmrc pnpm fetch --ignore-scripts --ignore-pnpmfile || code=$?
cd / && rm -rf "$HOME/.core-fetch" /tmp/core
exit $code
`;

/**
 * Decision A: core bump in the same kind of container as the fetch (badge on stdin, route to the registry, no task
 * volume: `HOME` on the tmpfs). Inputs on stdin (tar): `npmrc`, the tool's `package.json` and `pnpm-lock.yaml`, nothing
 * else of the repository (no project `.npmrc`, no pnpmfile). `pnpm add --save-exact --lockfile-only` resolves the `latest`
 * tag and rewrites the two files only; pnpm's own output goes to stderr, the framed files to stdout.
 */
export const CORE_UPDATE_SCRIPT = `set -eu
mkdir -p "$HOME" /tmp/core && tar -x -f - -C /tmp/core
cd /tmp/core
printf 'minimumReleaseAgeExclude:\\n  - "@eupadev/core"\\n' > pnpm-workspace.yaml
NPM_CONFIG_USERCONFIG=/tmp/core/npmrc pnpm add --save-exact --lockfile-only --ignore-scripts --ignore-pnpmfile '@eupadev/core@latest' >&2
b64() { base64 | tr -d '\\n'; }
printf '\\nEUPADEV-PACKAGE %s\\n' "$(b64 <package.json)"
printf 'EUPADEV-LOCKFILE %s\\n' "$(b64 <pnpm-lock.yaml)"
`;

/**
 * Decision A: the bumped `package.json` may differ from the tool's only by the core version (`to`): pnpm ran on files
 * written by agents, and the result is committed into main by the platform. First reason to refuse it, or null.
 */
export function packageJsonRefused(before: string, after: string, to: string): string | null {
  let a: unknown;
  let b: unknown;
  try {
    a = JSON.parse(before);
    b = JSON.parse(after);
  } catch (e) {
    return `package.json unreadable (${(e as Error).message.slice(0, 80)})`;
  }
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return 'package.json is not an object';
  const deps = (b as { dependencies?: Record<string, unknown> }).dependencies;
  if (deps?.['@eupadev/core'] !== to) return `package.json does not name @eupadev/core at ${to}`;
  const expected = { ...(a as Record<string, unknown>), dependencies: { ...((a as { dependencies?: Record<string, unknown> }).dependencies ?? {}), '@eupadev/core': to } };
  const key = (o: unknown): string => JSON.stringify(o, (_, v: unknown) => (typeof v === 'object' && v !== null && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort()) : v));
  return key(expected) === key(b) ? null : 'package.json changed beyond the core version';
}

/** Exact core version named by a pnpm lockfile (package key `@eupadev/core@X.Y.Z`), or null if the tool has none. */
export function coreFromLockfile(lockfile: string): string | null {
  return /^ {2}'?@eupadev\/core@(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)'?:\s*$/m.exec(lockfile)?.[1] ?? null;
}

/**
 * The lockfile is written by agents: before the fetch container (which has the badge and a direct route) reads it,
 * every resolution must be a registry one — a tarball only under the forge's registry (so the badge and the requests
 * go nowhere else), no git, directory or path resolution. First reason to refuse, or null.
 */
export function lockfileRefused(lockfile: string, registry: string): string | null {
  for (const line of lockfile.split('\n')) {
    if (!/^\s*resolution:/.test(line)) continue;
    const tarball = /tarball:\s*([^,}\s]+)/.exec(line)?.[1];
    if (tarball !== undefined && !tarball.startsWith(registry)) return `tarball outside the forge registry: ${tarball.slice(0, 120)}`;
    if (/\b(type|directory|commit|repo|path):/.test(line)) return `non-registry resolution: ${line.trim().slice(0, 120)}`;
  }
  return null;
}

export interface ClaudeEngineOptions {
  /** The forge's address, without `/api/v1`; `file:` accepted for the tests (local repositories). */
  forgeUrl: string;
  /** Token of the `svc-agent` account (reads repositories, writes `agent/**` branches). */
  token: string;
  organisation?: string;
  /** The agents' image, by digest in a registry only (`registry/…@sha256:…`): cosign verifies it there. */
  image: string;
  /** Path of the installation's cosign public key: the image must be signed by it (ADR-013). */
  publicKey: string;
  /** Text of `agents/report.schema.json`, passed to `--json-schema`. */
  reportSchema: string;
  /**
   * Diagnostics (real trial): file where, if the task ends without a report, Claude Code's full JSON output and its
   * stderr are written. No secret: the container only has a fake key and never sees the forge's token.
   */
  log?: string;
  /** Docker runtime: `runsc` (gVisor, L2) by default. */
  runtime?: string;
  memory?: string;
  pids?: number;
  /** Containers (AI proxy, egress proxy) attached to each task's internal network. */
  proxies?: readonly string[];
  /**
   * AI proxy, `container:port`: attached to each task's network, and given to the agent by its IP on that network
   * (`ANTHROPIC_BASE_URL=http://<IP>:<port>`): under gVisor, Docker's name resolution does not work (trial of
   * 2026-10-15 on the agents VM: name unknown under runsc, resolved under runc). The key passed on is fake.
   */
  aiProxy?: string;
  /**
   * Egress proxy (Smokescreen), `container:port`: attached like the AI proxy and given by its IP
   * (`HTTPS_PROXY`), with `NO_PROXY` = AI proxy and loopback: Claude Code uses a single proxy for all its
   * traffic (network-config doc), so its call to `ANTHROPIC_BASE_URL` would otherwise go to Smokescreen, which refuses it.
   */
  egressProxy?: string;
  /**
   * Core from the forge's npm registry (ADR-023). Without it, a tool that depends on the core cannot be installed
   * by its agent (no route to the forge). `registry`: `https://<forge>/api/packages/<org>/npm/`; `token`: read-only
   * badge (`read:package`), given only to the fetch container, on its stdin; `network`: Docker network of the fetch
   * container (direct route to the forge and npmjs, never the task's), `bridge` by default; `host`: `name:ip` added to
   * its /etc/hosts (lab); `ca`: host path of the CA bundle that trusts the forge (lab), mounted read-only.
   */
  core?: { registry: string; token: string; network?: string; host?: string; ca?: string };
  /**
   * Folder of the reference tool (`examples/requests`; `/app/example` in the engine image): its README, contract, code
   * and tests are given read-only to the roles that imitate it (A-R6, D3), like the suite.
   */
  example?: string;
}

interface Execution { code: number | null; output: Buffer; errors: string; overflowed: boolean }

/** Runs a command (arguments as an array), optional standard input, bounded output. Never a shell. */
function launch(cmd: string, args: readonly string[], o: { env?: NodeJS.ProcessEnv; input?: Buffer; cwd?: string; max?: number; signal?: AbortSignal } = {}): Promise<Execution> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { env: o.env ?? process.env, cwd: o.cwd, stdio: ['pipe', 'pipe', 'pipe'], ...(o.signal === undefined ? {} : { signal: o.signal }) });
    const chunks: Buffer[] = [];
    let size = 0;
    let overflowed = false;
    let errors = '';
    p.stdout.on('data', (d: Buffer) => {
      size += d.length;
      if (size > (o.max ?? MAX_OUTPUT_BYTES)) { overflowed = true; p.kill('SIGKILL'); return; }
      chunks.push(d);
    });
    p.stderr.on('data', (d: Buffer) => { errors = (errors + d.toString()).slice(-4000); });
    p.on('error', reject);
    p.on('close', (code) => resolve({ code, output: Buffer.concat(chunks), errors: errors, overflowed }));
    p.stdin.on('error', () => { /* the process left before reading everything: its exit code will say so */ });
    p.stdin.end(o.input ?? Buffer.alloc(0));
  });
}

// ── Reading Claude Code's output (pure, tested without Docker) ─────────────────────────────────────────────────────

export interface ClaudeRead {
  /** `structured_output` of a `success` result; null otherwise. */
  report: unknown | null;
  error?: string;
  /** Stopped by its cap (`error_max_turns`, `error_max_budget_usd`): the work done so far is worth keeping. */
  capped?: true;
  cost_usd: number | null;
  tokens?: { input: number; output: number };
}

const REASONS: Record<string, string> = {
  error_max_turns: 'turns cap reached',
  error_max_budget_usd: 'budget cap reached',
  error_during_execution: 'error during execution',
  error_max_structured_output_retries: 'structured report non-compliant after the retries',
};

const positiveInteger = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;

/** Tokens: `modelUsage` first (doc: "prefer modelUsage for token/cost accounting"), otherwise `usage`. Input = cache included. */
function readTokens(j: Record<string, unknown>): { input: number; output: number } | undefined {
  const byModel = j['modelUsage'];
  const lines = byModel !== null && typeof byModel === 'object' && Object.keys(byModel).length > 0
    ? Object.values(byModel as Record<string, Record<string, unknown>>).map((u) => [u?.['inputTokens'], u?.['cacheReadInputTokens'], u?.['cacheCreationInputTokens'], u?.['outputTokens']])
    : [[(j['usage'] as Record<string, unknown> | undefined)?.['input_tokens'], (j['usage'] as Record<string, unknown> | undefined)?.['cache_read_input_tokens'] ?? 0,
      (j['usage'] as Record<string, unknown> | undefined)?.['cache_creation_input_tokens'] ?? 0, (j['usage'] as Record<string, unknown> | undefined)?.['output_tokens']]];
  let input = 0;
  let output = 0;
  for (const [e, cl, cc, s] of lines) {
    if (![e, cl ?? 0, cc ?? 0, s].every(positiveInteger)) return undefined;
    input += (e as number) + ((cl ?? 0) as number) + ((cc ?? 0) as number);
    output += s as number;
  }
  return Number.isSafeInteger(input) && Number.isSafeInteger(output) ? { input: input, output: output } : undefined;
}

/** JSON output of `claude -p --output-format json` (the SDK's `result` message: `subtype`, `is_error`, `total_cost_usd`…). */
export function readClaudeResult(text: string, exitCode: number | null): ClaudeRead {
  let j: unknown;
  try {
    j = JSON.parse(text);
  } catch {
    return { report: null, error: `unreadable Claude Code output (code ${exitCode}, not JSON)`, cost_usd: null };
  }
  if (j === null || typeof j !== 'object' || Array.isArray(j) || (j as { type?: unknown }).type !== 'result') {
    return { report: null, error: `unreadable Claude Code output (code ${exitCode}, not a "result" message)`, cost_usd: null };
  }
  const r = j as Record<string, unknown>;
  const c = r['total_cost_usd'];
  const cost_usd = typeof c === 'number' && Number.isFinite(c) && c >= 0 ? c : null;
  const tokens = readTokens(r);
  const base = { cost_usd: cost_usd, ...(tokens === undefined ? {} : { tokens }) };
  const subtype = typeof r['subtype'] === 'string' ? r['subtype'] : '?';
  if (subtype === 'success' && r['is_error'] === false && exitCode === 0) {
    if (r['structured_output'] === undefined || r['structured_output'] === null) return { report: null, error: 'Claude Code finished without a structured report', ...base };
    return { report: r['structured_output'], ...base };
  }
  const details = Array.isArray(r['errors']) ? r['errors'].filter((e) => typeof e === 'string').join('; ').slice(0, 300) : '';
  const turns = positiveInteger(r['num_turns']) ? `, ${r['num_turns']} turns` : '';
  const capped = subtype === 'error_max_turns' || subtype === 'error_max_budget_usd' ? { capped: true as const } : {};
  return { report: null, error: `Claude Code stopped: ${REASONS[subtype] ?? 'failure'} (${subtype.slice(0, 60)}${turns}, code ${exitCode})${details === '' ? '' : `: ${details}`}`, ...capped, ...base };
}

/** The container's framed output: last line of each field (a line written earlier by the agent does not count). */
export function readFrame(output: string): { code: number; result: string; bundle: Buffer; errors: string } | null {
  const field = (name: string): string | undefined => {
    const prefix = `EUPADEV-${name} `;
    return output.split('\n').filter((l) => l.startsWith(prefix)).at(-1)?.slice(prefix.length);
  };
  const code = field('CODE');
  const result = field('RESULT');
  const bundle = field('BUNDLE');
  if (code === undefined || !/^\d+$/.test(code) || result === undefined || bundle === undefined) return null;
  const b64 = (x: string) => Buffer.from(x.trim(), 'base64');
  return { code: Number(code), result: b64(result).toString('utf8'), bundle: b64(bundle), errors: b64(field('ERRORS') ?? '').toString('utf8') };
}

/** Role-specific command-line options: `--tools`, and the tools allowed without confirmation (`--allowedTools`). Never bypassPermissions. */
export function roleOptions(role: Role): { tools: string; permissions: string } {
  if ((REVIEW_ROLES as readonly Role[]).includes(role)) return { tools: REVIEW_TOOLS, permissions: '' };
  return READ_ROLES.includes(role) ? { tools: READ_TOOLS, permissions: '' } : { tools: CODE_TOOLS, permissions: 'Bash Edit' };
}

/** Keywords specific to 2020-12 (or 2019-09), with no draft-07 equivalent: a schema containing any is refused. */
const ONLY_2020 = ['prefixItems', 'unevaluatedItems', 'unevaluatedProperties', 'dependentRequired', 'dependentSchemas', '$dynamicRef', '$dynamicAnchor', '$recursiveRef', '$recursiveAnchor', '$anchor', '$vocabulary', 'minContains', 'maxContains'];

/**
 * Report schema for `--json-schema`: Claude Code validates in draft-07 and refuses a schema declaring a more recent
 * version (agent-sdk/structured-outputs doc, "pass target: "draft-7""). The reference schema stays in 2020-12 (W2
 * validates it again with Ajv 2020); here `$schema` → draft-07, `$defs` → `definitions`, references rewritten. Keyword with
 * no draft-07 equivalent: outright refusal rather than a different validation.
 */
export function schemaDraft07(text: string): string {
  const visit = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(visit);
    if (v === null || typeof v !== 'object') return v;
    const output: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      if (ONLY_2020.includes(k)) throw new Error(`report schema: "${k}" has no draft-07 equivalent`);
      if (k === '$ref' && typeof x === 'string') output[k] = x.replace(/^#\/\$defs\//, '#/definitions/');
      else output[k === '$defs' ? 'definitions' : k] = visit(x);
    }
    return output;
  };
  const s = visit(JSON.parse(text)) as Record<string, unknown>;
  if (s['$schema'] !== undefined && s['$schema'] !== 'https://json-schema.org/draft/2020-12/schema') throw new Error(`report schema: unexpected version ${String(s['$schema'])}`);
  return JSON.stringify({ ...s, $schema: 'http://json-schema.org/draft-07/schema#' });
}

/** `--max-budget-usd`: the cap minus the margin, rounded down to the cent. */
export function budgetClaude(budget_usd: number): string {
  return (Math.floor(budget_usd * BUDGET_SHARE * 100) / 100).toFixed(2);
}

// ── The engine ────────────────────────────────────────────────────────────────────────────────────────────────────

const ID = /^[a-z0-9][a-z0-9._-]{0,99}$/i;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MODEL = /^[a-z0-9][a-z0-9.-]{0,99}$/;
const SHA = /^[0-9a-f]{40}$/;

export class ClaudeCodeEngine implements AgentEngine {
  readonly #repos: string;
  readonly #token: string;
  readonly #journal: string | undefined;
  readonly #o: Required<Omit<ClaudeEngineOptions, 'aiProxy' | 'egressProxy' | 'organisation' | 'forgeUrl' | 'token' | 'log' | 'core' | 'example'>>
    & { aiProxy: { container: string; port: string } | undefined; egressProxy: { container: string; port: string } | undefined };
  readonly #core: ClaudeEngineOptions['core'];
  readonly #example: string | undefined;

  constructor(o: ClaudeEngineOptions) {
    let url: URL;
    try {
      url = new URL(o.forgeUrl);
    } catch {
      throw new Error('FORGE_URL invalid');
    }
    if (url.username !== '' || url.password !== '') throw new Error('FORGE_URL: no credentials in the address (token through AGENT_FORGE_TOKEN_FILE)');
    if (url.protocol !== 'https:' && url.protocol !== 'file:' && url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') throw new Error('FORGE_URL: https required (the token never travels in clear)');
    if (o.token.trim() === '' || /\s/.test(o.token)) throw new Error('forge token (svc-agent) empty or invalid');
    if (!/^[^\s@]+@sha256:[0-9a-f]{64}$/.test(o.image)) throw new Error('AGENT_IMAGE: image named by digest only (registry/…@sha256:…)');
    if (o.publicKey.trim() === '') throw new Error('AGENT_COSIGN_PUB: cosign public key missing');
    if (o.reportSchema.trim() === '') throw new Error('report schema empty');
    const schemaClaude = schemaDraft07(o.reportSchema);
    const containerPort = (v: string | undefined, name: string) => {
      if (v === undefined) return undefined;
      const m = /^([a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}):([0-9]{1,5})$/.exec(v);
      if (m === null) throw new Error(`${name}: container:port expected`);
      return { container: m[1]!, port: m[2]! };
    };
    const ia = containerPort(o.aiProxy, 'AGENT_AI_PROXY');
    const output = containerPort(o.egressProxy, 'AGENT_EGRESS_PROXY');
    this.#repos = `${url.href.replace(/\/+$/, '')}/${o.organisation ?? 'eupadev'}`;
    this.#token = o.token;
    this.#journal = o.log;
    if (o.core !== undefined) {
      const s = o.core;
      if (!/^https:\/\/[a-z0-9.-]+(:\d{1,5})?\/api\/packages\/[A-Za-z0-9_.-]+\/npm\/$/.test(s.registry)) throw new Error('AGENT_CORE_REGISTRY: https://<forge>/api/packages/<org>/npm/ expected');
      if (s.token.trim() === '' || /\s/.test(s.token)) throw new Error('AGENT_CORE_TOKEN: empty or invalid read badge');
      if (s.network !== undefined && !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(s.network)) throw new Error('AGENT_CORE_NETWORK: Docker network name expected');
      if (s.host !== undefined && !/^[a-z0-9.-]+:\d{1,3}(\.\d{1,3}){3}$/i.test(s.host)) throw new Error('AGENT_CORE_HOST: name:IPv4 expected');
      if (s.ca !== undefined && !/^\/[^\s,]+$/.test(s.ca)) throw new Error('AGENT_CORE_CA: absolute path expected');
    }
    this.#core = o.core;
    this.#example = o.example;
    this.#o = {
      image: o.image, publicKey: o.publicKey, reportSchema: schemaClaude, runtime: o.runtime ?? 'runsc', memory: o.memory ?? '2g', pids: o.pids ?? 512,
      proxies: [...new Set([...(o.proxies ?? []), ...[ia, output].flatMap((p) => (p === undefined ? [] : [p.container]))])],
      aiProxy: ia, egressProxy: output,
    };
  }

  /** Launcher-side Git: no system or global configuration, hooks off, objects checked, token in a header. */
  async #git(dir: string, args: readonly string[], what: string, signal: AbortSignal): Promise<string> {
    const config: [string, string][] = [
      ['http.extraHeader', `Authorization: token ${this.#token}`], ['core.hooksPath', '/dev/null'], ['transfer.fsckObjects', 'true'],
      ['protocol.allow', 'never'], ['protocol.https.allow', 'always'], ['protocol.http.allow', 'always'], ['protocol.file.allow', 'always'],
      // No automatic maintenance: since Git 2.47, `fetch` starts it in the background (maintenance.autoDetach); it
      // rewrites the packs during the following `fsck` ("pack index not opened", seen in CI with Git 2.55). Throwaway clone.
      ['gc.auto', '0'], ['maintenance.auto', 'false'],
    ];
    const env: NodeJS.ProcessEnv = {
      PATH: process.env['PATH'], HOME: dir, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0',
      // Identity of the launcher's own commit (merge of main into the task's branch).
      GIT_AUTHOR_NAME: 'launcher', GIT_AUTHOR_EMAIL: 'launcher@eupadev.invalid', GIT_COMMITTER_NAME: 'launcher', GIT_COMMITTER_EMAIL: 'launcher@eupadev.invalid',
      GIT_CONFIG_COUNT: String(config.length), ...Object.fromEntries(config.flatMap(([k, v], i) => [[`GIT_CONFIG_KEY_${i}`, k], [`GIT_CONFIG_VALUE_${i}`, v]])),
    };
    const r = await launch('git', args, { env, cwd: dir, max: 64 * 1024 * 1024, signal });
    if (r.code !== 0) throw new Error(`git ${what}: failed (${r.code}) ${r.errors.replaceAll(this.#token, '***').trim().slice(-300)}`);
    return r.output.toString('utf8');
  }

  async #docker(args: readonly string[], o: { input?: Buffer } = {}): Promise<Execution> {
    return launch('docker', args, o);
  }

  /** Removes everything carrying the task's name (replay, end, cancellation). "Does not exist" errors are expected. */
  async #cleanup(container: string, network: string, volume: string): Promise<void> {
    await this.#docker(['rm', '-f', '-v', container.replace(/^fa-/, 'fa-core-')]);
    await this.#docker(['rm', '-f', '-v', container]);
    for (const p of this.#o.proxies) await this.#docker(['network', 'disconnect', '-f', network, p]);
    await this.#docker(['network', 'rm', network]);
    await this.#docker(['volume', 'rm', '-f', volume]);
  }

  /**
   * Fills the task volume's pnpm store with the lockfile's packages (core included), in a separate container that
   * holds the read badge on its stdin only: never in an argument, an environment variable, the agent's archive or the
   * volume (npmrc in this container's tmpfs). Same image (already verified), same hardening; its own network. A
   * failure (version absent from the registry, registry unreachable) stops the task with a clear message.
   */
  async #loadCore(e: TaskInput, container: string, volume: string, label: string, dir: string, core: { version: string; lockfile: string }): Promise<void> {
    const archive = await this.#coreArchive(dir, { 'pnpm-lock.yaml': core.lockfile });
    const r = await this.#coreContainer(container.replace(/^fa-/, 'fa-core-'), label, CORE_SCRIPT, archive, [`--mount=type=volume,src=${volume},dst=/home/agent`], e.signal);
    e.signal.throwIfAborted();
    if (r.code !== 0) {
      const detail = this.#coreOutput(r);
      throw new Error(`core: pnpm fetch failed for @eupadev/core@${core.version} (code ${r.code}): version absent from the forge registry, or registry unreachable — ${detail}`);
    }
  }

  /**
   * Short-lived container of the core store (ADR-023): verified agent image, the hardening of a task, the core network
   * (direct route to the forge), its inputs on stdin; `extra`: its mounts. The badge is in the stdin archive only.
   */
  #coreContainer(name: string, label: string, script: string, input: Buffer, extra: readonly string[], signal?: AbortSignal): Promise<Execution> {
    const s = this.#core!;
    return launch('docker', [
      'run', '-i', '--rm', '--name', name, '--label', label, `--runtime=${this.#o.runtime}`, `--network=${s.network ?? 'bridge'}`,
      ...(s.host === undefined ? [] : ['--add-host', s.host]),
      ...(s.ca === undefined ? [] : [`--mount=type=bind,src=${s.ca},dst=/etc/eupadev-ca.crt,readonly`, '-e', 'NODE_EXTRA_CA_CERTS=/etc/eupadev-ca.crt']),
      '--read-only', '--tmpfs=/tmp', ...extra, '--cap-drop=ALL', '--security-opt=no-new-privileges',
      '--user=10001:10001', `--memory=${this.#o.memory}`, `--memory-swap=${this.#o.memory}`, `--pids-limit=${this.#o.pids}`,
      '-e', `FA_CORE_REGISTRY=${s.registry}`, this.#o.image, 'sh', '-c', script,
    ], { input: input, max: 4 * 1024 * 1024, ...(signal === undefined ? {} : { signal }) });
  }

  /** Output of a core container for an error message: the read badge, if pnpm echoed it, masked. */
  #coreOutput(r: Execution): string {
    const s = this.#core!;
    return `${r.output.toString('utf8')}\n${r.errors}`.replaceAll(s.token, '***').trim().slice(-400);
  }

  /** The stdin archive of a core container: `npmrc` (scope registry + read badge) and `files`, written in a private folder of `dir`, deleted at once. */
  async #coreArchive(dir: string, files: Record<string, string>): Promise<Buffer> {
    const s = this.#core!;
    const inputs = join(dir, 'core');
    mkdirSync(inputs, { mode: 0o700 });
    let archive: Execution;
    try {
      writeFileSync(join(inputs, 'npmrc'), `@eupadev:registry=${s.registry}\n${s.registry.replace(/^https:/, '')}:_authToken=${s.token}\n`, { mode: 0o600 });
      for (const [name, text] of Object.entries(files)) writeFileSync(join(inputs, name), text);
      archive = await launch('tar', ['-c', '-f', '-', '-C', inputs, 'npmrc', ...Object.keys(files)]);
    } finally {
      rmSync(inputs, { recursive: true, force: true });
    }
    if (archive.code !== 0) throw new Error(`core: archive of the fetch inputs failed (${archive.code})`);
    return archive.output;
  }

  /**
   * Decision A: the tool's `package.json` and `pnpm-lock.yaml` of main moved to the latest published core version, as
   * data (nothing is pushed here: the forge commits them, pilot side). Null when the core is not configured, the tool has
   * no core, or it is already on the latest version. The bump container is the fetch container's twin (badge on stdin,
   * registry route), without the repository: the two files only. The result is checked like the lockfile before a fetch
   * (registry-only resolutions) and `package.json` may differ by the core version only.
   */
  async coreUpToDate(tool: string, signal?: AbortSignal): Promise<CoreUpdate | null> {
    if (this.#core === undefined) return null;
    if (!SLUG.test(tool) || tool.length > 100) throw new Error(`invalid tool: ${JSON.stringify(tool).slice(0, 80)}`);
    const sig = signal ?? new AbortController().signal;
    const dir = mkdtempSync(join(tmpdir(), 'fa-core-'));
    const repo = join(dir, 'repo.git');
    const name = `fa-core-update-${tool}-${randomUUID().slice(0, 8)}`;
    try {
      await this.#git(dir, ['clone', '--bare', '-q', `${this.#repos}/${tool}.git`, repo], 'clone', sig);
      const main = (await this.#git(repo, ['for-each-ref', '--format=%(objectname)', 'refs/heads/main'], 'branch listing', sig)).trim();
      if (!SHA.test(main)) throw new Error(`repository ${tool} without a main branch`);
      const present = (await this.#git(repo, ['ls-tree', '--name-only', main, '--', 'package.json', 'pnpm-lock.yaml'], 'lockfile', sig)).split('\n');
      if (!present.includes('package.json') || !present.includes('pnpm-lock.yaml')) return null;
      const lockfile = await this.#git(repo, ['cat-file', 'blob', `${main}:pnpm-lock.yaml`], 'lockfile', sig);
      const from = coreFromLockfile(lockfile);
      if (from === null) return null;
      const refusal = lockfileRefused(lockfile, this.#core.registry);
      if (refusal !== null) throw new Error(`core: pnpm-lock.yaml refused before the update (${refusal})`);
      const packageJson = await this.#git(repo, ['cat-file', 'blob', `${main}:package.json`], 'package.json', sig);
      const archive = await this.#coreArchive(dir, { 'package.json': packageJson, 'pnpm-lock.yaml': lockfile });
      const r = await this.#coreContainer(name, `${LABEL}=core-${tool}`, CORE_UPDATE_SCRIPT, archive, ['-e', 'HOME=/tmp/home'], sig);
      sig.throwIfAborted();
      if (r.code !== 0) throw new Error(`core: update of @eupadev/core to the latest version failed (code ${r.code}): registry unreachable or no version published — ${this.#coreOutput(r)}`);
      const field = (x: string, head = `EUPADEV-${x} `): string | undefined => r.output.toString('utf8').split('\n').filter((l) => l.startsWith(head)).at(-1)?.slice(head.length);
      const [packageAfter, lockfileAfter] = [field('PACKAGE'), field('LOCKFILE')].map((x) => (x === undefined ? undefined : Buffer.from(x.trim(), 'base64').toString('utf8')));
      if (packageAfter === undefined || lockfileAfter === undefined) throw new Error(`core: update container ended without its files — ${this.#coreOutput(r)}`);
      const to = coreFromLockfile(lockfileAfter);
      if (to === null) throw new Error('core: updated pnpm-lock.yaml names no core version');
      if (to === from) return null;
      const refusalAfter = lockfileRefused(lockfileAfter, this.#core.registry) ?? packageJsonRefused(packageJson, packageAfter, to);
      if (refusalAfter !== null) throw new Error(`core: updated files refused (${refusalAfter})`);
      return { from, to, package_json: packageAfter, lockfile: lockfileAfter };
    } finally {
      await this.#docker(['rm', '-f', name]);
      rmSync(dir, { recursive: true, force: true });
    }
  }

  async execute(e: TaskInput): Promise<TaskOutput> {
    const start = Date.now();
    if (!ID.test(e.task_id)) throw new Error(`invalid task id: ${JSON.stringify(e.task_id).slice(0, 80)}`);
    if (!SLUG.test(e.tool) || e.tool.length > 100) throw new Error(`invalid tool: ${JSON.stringify(e.tool).slice(0, 80)}`);
    // L5: the branch is THIS task's (tool and role), never another; a reviewer reviews the round's integration
    // branch (`integration/<cycle>/<round>`), which it never pushes.
    const reviewer = (REVIEW_ROLES as readonly Role[]).includes(e.role);
    if (!new RegExp(reviewer ? '^integration/[0-9]+/[0-9]+$' : `^agent/${e.tool}/[0-9]+/${e.role}$`).test(e.branch)) throw new Error(`branch refused for ${e.tool}/${e.role}: ${JSON.stringify(e.branch).slice(0, 120)}`);
    if (!MODEL.test(e.model)) throw new Error(`invalid model: ${JSON.stringify(e.model).slice(0, 80)}`);
    if (!(EFFORTS as readonly string[]).includes(e.effort)) throw new Error(`invalid effort: ${JSON.stringify(e.effort).slice(0, 40)}`);
    const { turns, budget_usd } = e.cap;
    if (!Number.isSafeInteger(turns) || turns <= 0 || !Number.isFinite(budget_usd) || budget_usd <= 0) throw new Error('invalid task cap');
    e.signal.throwIfAborted();
    // ADR-013: the image's cosign signature verified before EACH launch, before creating anything; unsigned or another key =
    // the agent does not start. Same command as for the engine's image (the image task of the infra's engine role). `docker run`
    // of the same `…@sha256:…` reference runs only that content: no gap between verified and launched.
    const signature = await launch('cosign', ['verify', '--key', this.#o.publicKey, '--insecure-ignore-tlog=true', this.#o.image], { signal: e.signal });
    if (signature.code !== 0) throw new Error(`agents' image refused, cosign signature not verified: ${signature.errors.trim().slice(-300)}`);

    const container = `fa-${e.task_id}`;
    const network = `fa-net-${e.task_id}`;
    const volume = `fa-ws-${e.task_id}`;
    const dir = mkdtempSync(join(tmpdir(), 'fa-task-'));
    const repo = join(dir, 'repo.git');
    // Stop: the container is removed at once (W2 does not wait for the engine); `docker run` then returns. Repeated
    // until `docker run` ends: a stop arriving just before the container is created still reaches it.
    let finished = false;
    const stop = async () => {
      while (!finished) {
        await this.#docker(['rm', '-f', '-v', container]);
        await sleep(500);
      }
    };
    const onStop = () => void stop();
    // The launcher's Git interrupted by the same signal (a stuck clone does not hold the task back).
    const git = (cwd: string, args: readonly string[], what: string) => this.#git(cwd, args, what, e.signal);
    e.signal.addEventListener('abort', onStop, { once: true });
    try {
      await this.#cleanup(container, network, volume);
      e.signal.throwIfAborted();

      // Prepare: bare clone, base = main, or the task's branch if it exists (replay, next round) with main merged
      // into it when main has moved since (E7). Role without a repository: none of this.
      const withRepo = !ROLES_WITHOUT_REPO.includes(e.role);
      const points = async (ref: string) => (await git(repo, ['for-each-ref', '--format=%(objectname)', ref], 'reading the branches')).trim();
      let base = '';
      if (withRepo) {
        await git(dir, ['clone', '--bare', '-q', `${this.#repos}/${e.tool}.git`, repo], 'clone');
        const main = await points('refs/heads/main');
        if (!SHA.test(main)) throw new Error(`repository ${e.tool} without a main branch`);
        const branch = await points(`refs/heads/${e.branch}`);
        // A reviewer reads the integrated code of the round, never main (which has not received it yet): absent = clear failure.
        if (reviewer && branch === '') throw new Error(`integration branch ${e.branch} missing: nothing to review for ${e.role}`);
        base = branch || main;
        if (base !== main && (await git(repo, ['merge-base', main, base], 'common base with main')).trim() !== main) {
          // No working tree in a bare clone: `merge-tree --write-tree` (git ≥ 2.38) builds the merged tree; a conflict
          // (exit 1) fails the task with its reason (perimeters are disjoint: never normal).
          const tree = (await git(repo, ['merge-tree', '--write-tree', base, main], 'merging main into the task branch')).split('\n')[0]!;
          base = (await git(repo, ['commit-tree', tree, '-p', base, '-p', main, '-m', `Merge main into ${e.branch}`], 'merge commit of main')).trim();
        }
        await git(repo, ['update-ref', 'refs/heads/work', base], 'base');
        await git(repo, ['bundle', 'create', '-q', join(dir, 'input.bundle'), 'refs/heads/work'], 'input bundle');
      }
      // Core (ADR-023): roles that install dependencies get it from a store filled before they start. Lockfile read
      // as data in the launcher's clone, checked before the fetch container sees it.
      let core: { version: string; lockfile: string } | null = null;
      if (this.#core !== undefined && withRepo && !READ_ROLES.includes(e.role)
        && (await git(repo, ['ls-tree', '--name-only', base, '--', 'pnpm-lock.yaml'], 'lockfile')).trim() === 'pnpm-lock.yaml') {
        const lockfile = await git(repo, ['cat-file', 'blob', `${base}:pnpm-lock.yaml`], 'lockfile');
        const version = coreFromLockfile(lockfile);
        if (version !== null) {
          const refusal = lockfileRefused(lockfile, this.#core.registry);
          if (refusal !== null) throw new Error(`core: pnpm-lock.yaml refused before fetching (${refusal})`);
          core = { version, lockfile };
        }
      }
      // ADR-021: the builder gets the tests role's acceptance suite (branch `agent/<tool>/<cycle>/tests` of the same cycle)
      // read-only under /tmp/task/suite/, never in its clone; `tests/acceptance/` stays refused to it at push time.
      let withSuite = false;
      if (e.role === 'builder') {
        const testsBranch = e.branch.replace(/\/builder$/, '/tests');
        if ((await points(`refs/heads/${testsBranch}`)) !== '' && (await git(repo, ['ls-tree', '-d', testsBranch, '--', 'tests/acceptance'], 'acceptance suite')).trim() !== '') {
          await git(repo, ['archive', '--format=tar', '--prefix=suite/', '-o', join(dir, 'suite.tar'), testsBranch, '--', 'tests/acceptance'], 'suite archive');
          const excerpt = await launch('tar', ['-x', '-f', join(dir, 'suite.tar'), '-C', dir]);
          if (excerpt.code !== 0) throw new Error(`acceptance suite: extraction failed (${excerpt.code}) ${excerpt.errors.slice(-200)}`);
          withSuite = true;
        }
      }
      // D3 (A-R6): the reference tool, read-only, for the roles that imitate it.
      const withExample = this.#example !== undefined && EXAMPLE_ROLES.includes(e.role);
      if (withExample) {
        for (const x of EXAMPLE_CONTENT) if (existsSync(join(this.#example!, x))) cpSync(join(this.#example!, x), join(dir, 'example', x), { recursive: true });
      }
      writeFileSync(join(dir, 'instructions.md'), e.instructions); // as is: W2 holds its digest
      writeFileSync(join(dir, 'task.md'), taskMd(e, withRepo, withSuite, withExample));
      writeFileSync(join(dir, 'report.schema.json'), this.#o.reportSchema);
      const archive = await launch('tar', ['-c', '-f', '-', '-C', dir, 'instructions.md', 'task.md', 'report.schema.json', ...(withRepo ? ['input.bundle'] : []), ...(withSuite ? ['suite'] : []), ...(withExample ? ['example'] : [])]);
      if (archive.code !== 0) throw new Error(`inputs archive: failed (${archive.code}) ${archive.errors.slice(-200)}`);
      e.signal.throwIfAborted();

      // Launch: the task's internal network, working volume, hardened container.
      const label = `${LABEL}=${e.task_id}`;
      // inhibit_ipv4: without it, the bridge keeps an IP of the VM and the agent reaches its services (sshd…); observed, verify-agents.yml.
      const net = await this.#docker(['network', 'create', '--internal', '-o', 'com.docker.network.bridge.inhibit_ipv4=true', '--label', label, network]);
      if (net.code !== 0) throw new Error(`task network: ${net.errors.trim().slice(-200)}`);
      for (const p of this.#o.proxies) {
        const r = await this.#docker(['network', 'connect', network, p]);
        if (r.code !== 0) throw new Error(`proxy ${p} : ${r.errors.trim().slice(-200)}`);
      }
      // Proxies given by their IP on the task's network: under gVisor, Docker names do not resolve.
      const ipOnNetwork = async (what: string, container: string) => {
        const r = await this.#docker(['inspect', '--format', '{{json .NetworkSettings.Networks}}', container]);
        const ip = r.code === 0 ? (JSON.parse(r.output.toString('utf8')) as Record<string, { IPAddress?: string }>)[network]?.IPAddress : undefined;
        if (ip === undefined || !/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) throw new Error(`${what} ${container}: no IP on the task network`);
        return ip;
      };
      const aiIp = this.#o.aiProxy === undefined ? undefined : await ipOnNetwork('AI proxy', this.#o.aiProxy.container);
      const egressIp = this.#o.egressProxy === undefined ? undefined : await ipOnNetwork('egress proxy', this.#o.egressProxy.container);
      const noProxy = [...(aiIp === undefined ? [] : [aiIp]), 'localhost', '127.0.0.1'].join(',');
      const vol = await this.#docker(['volume', 'create', '--label', label, volume]);
      if (vol.code !== 0) throw new Error(`task volume: ${vol.errors.trim().slice(-200)}`);
      if (core !== null) await this.#loadCore(e, container, volume, label, dir, core);
      const { tools: tools, permissions } = roleOptions(e.role);
      const env: Record<string, string> = {
        FA_PROMPT: PROMPT, FA_MODEL: e.model, FA_EFFORT: e.effort, FA_TOOLS: tools, FA_PERMISSIONS: permissions,
        FA_TURNS: String(turns), FA_BUDGET: budgetClaude(budget_usd),
        // Fake key: the real one is added by the AI proxy (L4), it never enters the container.
        ANTHROPIC_API_KEY: 'fake-key-added-by-the-proxy',
        GIT_AUTHOR_NAME: `agent-${e.role}`, GIT_AUTHOR_EMAIL: 'agent@eupadev.invalid', GIT_COMMITTER_NAME: `agent-${e.role}`, GIT_COMMITTER_EMAIL: 'agent@eupadev.invalid',
        ...(aiIp === undefined ? {} : { ANTHROPIC_BASE_URL: `http://${aiIp}:${this.#o.aiProxy!.port}` }),
        // No HTTP_PROXY: the registry is on HTTPS; a cleartext access has no route (internal network), so it fails.
        ...(egressIp === undefined ? {} : {
          HTTPS_PROXY: `http://${egressIp}:${this.#o.egressProxy!.port}`, https_proxy: `http://${egressIp}:${this.#o.egressProxy!.port}`,
          NO_PROXY: noProxy, no_proxy: noProxy,
        }),
      };
      e.signal.throwIfAborted();
      const run = await this.#docker([
        'run', '-i', '--rm', '--name', container, '--label', label, `--runtime=${this.#o.runtime}`, `--network=${network}`,
        '--read-only', '--tmpfs=/tmp', `--mount=type=volume,src=${volume},dst=/home/agent`, '--cap-drop=ALL', '--security-opt=no-new-privileges',
        '--user=10001:10001', `--memory=${this.#o.memory}`, `--memory-swap=${this.#o.memory}`, `--pids-limit=${this.#o.pids}`,
        ...Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`]),
        this.#o.image, 'sh', '-c', containerScript(withRepo),
      ], { input: archive.output });
      finished = true;
      e.signal.throwIfAborted();
      const duration_s = () => Math.round((Date.now() - start) / 1000);
      if (run.overflowed) throw new Error(`container output beyond ${MAX_OUTPUT_BYTES} bytes`);
      const frame = readFrame(run.output.toString('utf8'));
      if (frame === null) {
        return { report: null, error: `container stopped before the end (code ${run.code}) ${run.errors.trim().slice(-300)}`.trim(), cost_usd: null, duration_s: duration_s(), tree_hash: null };
      }
      const lu = readClaudeResult(frame.result, frame.code);
      const tokens = lu.tokens === undefined ? {} : { tokens: lu.tokens };
      const failure = (error: string): TaskOutput => ({ report: null, error: error, cost_usd: lu.cost_usd, duration_s: duration_s(), tree_hash: null, ...tokens });
      // Tail of Claude Code's errors (its stderr; the container carries no secret): without it, a refusal at start-up is silent.
      const detail = frame.errors.trim() === '' ? '' : `; errors: ${frame.errors.trim().slice(-500)}`;
      if (lu.report === null && this.#journal !== undefined) writeFileSync(this.#journal, `${frame.result}\n--- stderr ---\n${frame.errors}\n`, { mode: 0o600 });
      // A code role cut by its cap (turns, budget) has committed on the way (its instructions: commit in small steps): its
      // commits go through the same checks and the same push as a finished task's, and the task still fails (no report);
      // the next attempt starts from the branch (base above) instead of from zero under the same cap (cycle 5 of the lab:
      // two builder attempts at the cap, nothing kept, the hardening envelope gone).
      const stopped = lu.report === null ? `${lu.error ?? 'no report'}${detail}` : null;
      if (stopped !== null && lu.capped !== true) return failure(stopped);
      const refused = (why: string): TaskOutput => failure(`${stopped === null ? '' : `${stopped}; `}agent's work refused: ${why}`);

      // Fetch: the bundle (data) into the clean clone; never Git in the agent's repository.
      let head = base;
      if (withRepo && !READ_ROLES.includes(e.role) && frame.bundle.length > 0) {
        writeFileSync(join(dir, 'output.bundle'), frame.bundle);
        try {
          await git(repo, ['fetch', '-q', '--no-tags', join(dir, 'output.bundle'), '+HEAD:refs/eupadev/output'], 'fetching the work');
        } catch (err) {
          return refused((err as Error).message);
        }
        head = (await points('refs/eupadev/output'));
        if (head !== base) {
          // Fetching a bundle does not always check the objects (git 2.43: `transfer.fsckObjects` has no effect; recent Gits
          // refuse at fetch time): explicit strict fsck (`.git` paths, invalid names and modes…).
          try {
            await git(repo, ['fsck', '--strict', '--no-dangling', '--no-progress', head], 'checking the objects');
          } catch (err) {
            return refused((err as Error).message);
          }
          try {
            await git(repo, ['merge-base', '--is-ancestor', base, head], 'lineage');
          } catch {
            return refused('its commits do not descend from the task base');
          }
          if ((await git(repo, ['rev-list', '--min-parents=2', `${base}..${head}`], 'checking merges')).trim() !== '') {
            return refused('merge commit');
          }
          // Net content of the task: forbidden paths, the role's scope, symbolic links,
          // submodules, booby-trapped names. The guarantee is here; the harness (dontAsk, deny) and Gitea are belts.
          const refusal = contentRefused(e.role, await git(repo, ['diff-tree', '-r', '--no-renames', '--raw', '-z', base, head], 'task content'));
          if (refusal !== null) return refused(refusal);
          // Push without force to the task's branch only.
          await git(repo, ['push', '-q', 'origin', `${head}:refs/heads/${e.branch}`], 'push');
        }
      }
      if (stopped !== null) return failure(head === base ? stopped : `${stopped}; its commits are kept on ${e.branch}`);
      const tree_hash = withRepo && (CODE_ROLES as readonly string[]).includes(e.role)
        ? createHash('sha256').update(await git(repo, ['ls-tree', head, '--', ...PATHS_BY_ROLE[e.role as RoleCode]], 'tree digest')).digest('hex')
        : null;
      return { report: lu.report, cost_usd: lu.cost_usd, duration_s: duration_s(), tree_hash: tree_hash, ...tokens };
    } finally {
      finished = true;
      e.signal.removeEventListener('abort', onStop);
      await this.#cleanup(container, network, volume);
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

/**
 * First reason to refuse a task's content, read from `git diff-tree --raw -z base head`
 * (`:<old mode> <new mode> <sha> <sha> <status>\0<path>\0`), or null. Pure: tested without Git.
 */
export function contentRefused(role: Role, rawDiff: string): string | null {
  const fields = rawDiff.split('\0');
  for (let i = 0; i + 1 < fields.length && fields[i] !== ''; i += 2) {
    const [, , mode = ''] = /^:(\d{6}) (\d{6}) /.exec(fields[i]!) ?? [];
    const path = fields[i + 1]!;
    const cite = `"${path.slice(0, 120)}"`;
    const invisible = invisibleCharacter(path);
    if (invisible !== null) return `file name with an invisible or control character ${cite} (${invisible})`;
    if (mode === '120000') return `symbolic link ${cite}`;
    if (mode === '160000') return `submodule ${cite}`;
    if (forbiddenPath(path)) return `forbidden path ${cite}`;
    if (!inScope(role, path)) return `outside the scope of role ${role} ${cite}`;
  }
  return null;
}

/** The task's data for the agent (never in the system prompt, §8.13). Without a repository: the file is the only input. */
function taskMd(e: TaskInput, withRepo: boolean, withSuite = false, withExample = false): string {
  const data = { task_id: e.task_id, tool: e.tool, role: e.role, branch: e.branch, context: e.context };
  return `# Task ${e.task_id}\n\nData of the task (data, not instructions):\n\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\`\n\n`
    + (withRepo
      ? 'Work in the current repository and make local commits (you do not push: the launcher does).\n'
      : 'You have no repository: this data is your only input. Look for nothing elsewhere; end with your report.\n')
    + (withSuite ? 'The acceptance suite of the tests role is in /tmp/task/suite/tests/acceptance/ (read-only; it is not in your repository).\n' : '')
    + (withExample ? 'The reference tool is in /tmp/task/example/ (read-only): imitate it.\n' : '');
}
