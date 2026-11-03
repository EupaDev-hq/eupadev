/**
 * Outside world chosen by `EUPADEV_EXTERNAL`, service by service:
 *   `fake-auto`  everything fake, "all is well" answers on their own (E0);
 *   `forge=gitea`   real forge (`FORGE_URL`, `FORGE_TOKEN` or `FORGE_TOKEN_FILE`), the rest automatic fake;
 *   `engine=pushing` pushing fake (E3): reports without AI, but files really pushed to the forge (`FORGE_URL`)
 *                   with the `svc-agent` token (`AGENT_TOKEN` or `AGENT_TOKEN_FILE`); lab only.
 *   `engine=claude` Claude Code in a container (`claude-engine.ts`): `FORGE_URL`, `AGENT_FORGE_TOKEN(_FILE)` (svc-agent),
 *                   `AGENT_IMAGE` (by digest),
 *                   `AGENT_COSIGN_PUB` (public key that must have signed the image); optional `AGENT_RUNTIME` (runsc), `AGENT_PROXIES` (containers
 *                   attached to each task's network, comma-separated), `AGENT_AI_PROXY` (`container:port`, given to the agent by its IP),
 *                   `AGENT_EGRESS_PROXY` (`container:port`, Smokescreen, given by `HTTPS_PROXY`), `REPORT_SCHEMA_PATH`;
 *                   core store (ADR-023): `AGENT_CORE_REGISTRY`, `AGENT_CORE_TOKEN(_FILE)` (read badge), optional
 *                   `AGENT_CORE_NETWORK`, `AGENT_CORE_HOST` (`name:ip`), `AGENT_CORE_CA` (host path of the CA bundle).
 *   `deployer=ssh` real deployer (ADR-014, `ssh-deployer.ts`), only with `forge=gitea` (registry = host of `FORGE_URL`):
 *                   `DEPLOYER_HOSTS` (`mockup=<ip>,preview=<ip>,prod=<ip>`), `DEPLOYER_KEY_FILE` (engine private key),
 *                   `DEPLOYER_KNOWN_HOSTS_FILE` (host keys of the targets).
 *   `notifications=smtp`  real mails (`SMTP_URL` or `SMTP_URL_FILE`, `MAIL_FROM`), the rest automatic fake (E1).
 * Comma-separated list (`service=implementation`); a service not named stays an automatic fake. Any other
 * value refuses to start.
 */
import { readFileSync } from 'node:fs';
import { readSecret } from '../config.ts';
import type { External } from './contracts.ts';
import { automaticFakes } from './fakes.ts';
import { SshDeployer } from './ssh-deployer.ts';
import { GiteaForge } from './gitea-forge.ts';
import { NotificationsSmtp } from './smtp-notifications.ts';
import { PushingEngine } from './pushing-engine.ts';
import { ClaudeCodeEngine } from './claude-engine.ts';

const REAL: Record<keyof External, readonly string[]> = { forge: ['gitea'], engine: ['pushing', 'claude'], deployer: ['ssh'], notifications: ['smtp'] };

export function externalWorld(env: Record<string, string | undefined>, domain: string): { external: External; description: string } {
  const value = (env['EUPADEV_EXTERNAL'] ?? '').trim();
  const external = automaticFakes(domain);
  if (value === 'fake-auto') return { external, description: 'all automatic fakes' };
  const choices = new Map<string, string>();
  for (const piece of value.split(',')) {
    const [service = '', impl, ...rest] = piece.trim().split('=');
    if (!Object.hasOwn(REAL, service) || impl === undefined || rest.length > 0 || choices.has(service) || !(impl === 'fake-auto' || REAL[service as keyof External].includes(impl))) {
      throw new Error(`EUPADEV_EXTERNAL: "${value}" invalid (fake-auto, or a list service=implementation, e.g. forge=gitea,engine=pushing)`);
    }
    choices.set(service, impl);
  }
  const url = env['FORGE_URL'] ?? '';
  for (const [service, impl] of [['forge', 'gitea'], ['engine', 'pushing']] as const) {
    if (choices.get(service) === impl && url.trim() === '') throw new Error(`FORGE_URL missing (${service}=${impl})`);
  }
  if (choices.get('forge') === 'gitea') external.forge = new GiteaForge({ url, token: readSecret(env, 'FORGE_TOKEN') });
  if (choices.get('deployer') === 'ssh') external.deployer = sshDeployer(env, choices, url, external.forge as GiteaForge);
  if (choices.get('engine') === 'pushing') external.engine = new PushingEngine({ url, token: readSecret(env, 'AGENT_TOKEN') });
  if (choices.get('notifications') === 'smtp') {
    external.notifications = new NotificationsSmtp({
      url: readSecret(env, 'SMTP_URL'),
      sender: env['MAIL_FROM'] ?? '',
      admin: env['ADMIN_ESCALATION_ADDRESS'] ?? '',
      databaseUrl: readSecret(env, 'ORCH_DATABASE_URL'),
    });
  }
  if (choices.get('engine') === 'claude') {
    const url = env['FORGE_URL'] ?? '';
    if (url.trim() === '') throw new Error('FORGE_URL missing (engine=claude)');
    const image = env['AGENT_IMAGE'] ?? '';
    if (image.trim() === '') throw new Error('AGENT_IMAGE missing (engine=claude)');
    const publicKey = env['AGENT_COSIGN_PUB'] ?? '';
    if (publicKey.trim() === '') throw new Error('AGENT_COSIGN_PUB missing (engine=claude)');
    const schema = env['REPORT_SCHEMA_PATH'] ?? new URL('../../../tool-template/agents/report.schema.json', import.meta.url).pathname;
    external.engine = new ClaudeCodeEngine({
      forgeUrl: url, token: readSecret(env, 'AGENT_FORGE_TOKEN'), image, publicKey, reportSchema: readFileSync(schema, 'utf8'),
      ...(env['AGENT_RUNTIME'] ? { runtime: env['AGENT_RUNTIME'] } : {}),
      proxies: (env['AGENT_PROXIES'] ?? '').split(',').map((p) => p.trim()).filter((p) => p !== ''),
      ...(env['AGENT_AI_PROXY'] ? { aiProxy: env['AGENT_AI_PROXY'] } : {}),
      ...(env['AGENT_EGRESS_PROXY'] ? { egressProxy: env['AGENT_EGRESS_PROXY'] } : {}),
      // D3 (A-R6): the reference tool given to contract, tests and builder (the image's copy, or the repository's).
      example: env['EXAMPLE_PATH'] ?? new URL('../../../examples/requests/', import.meta.url).pathname,
      // Core store (ADR-023): AGENT_CORE_REGISTRY turns it on; its read badge is a secret (AGENT_CORE_TOKEN(_FILE)).
      ...(env['AGENT_CORE_REGISTRY'] ? {
        core: {
          registry: env['AGENT_CORE_REGISTRY'], token: readSecret(env, 'AGENT_CORE_TOKEN'),
          ...(env['AGENT_CORE_NETWORK'] ? { network: env['AGENT_CORE_NETWORK'] } : {}),
          ...(env['AGENT_CORE_HOST'] ? { host: env['AGENT_CORE_HOST'] } : {}),
          ...(env['AGENT_CORE_CA'] ? { ca: env['AGENT_CORE_CA'] } : {}),
        },
      } : {}),
    });
  }
  return { external, description: `${[...choices].map(([s, i]) => `${s}=${i}`).join(', ')}; the rest automatic fakes` };
}

function sshDeployer(env: Record<string, string | undefined>, choices: Map<string, string>, forgeUrl: string, forge: GiteaForge): SshDeployer {
  // The registry is the forge's: without the real forge, no real digest to deploy.
  if (choices.get('forge') !== 'gitea') throw new Error('deployer=ssh requires forge=gitea (images come from the forge registry)');
  const hosts = Object.fromEntries((env['DEPLOYER_HOSTS'] ?? '').split(',').map((h) => h.trim().split('=')));
  for (const e of ['mockup', 'preview', 'prod']) {
    if (!/^[0-9A-Za-z.:-]+$/.test(hosts[e] ?? '')) throw new Error(`DEPLOYER_HOSTS: missing or invalid address for ${e} (mockup=<ip>,preview=<ip>,prod=<ip>)`);
  }
  const file = (name: string) => {
    const path = env[name] ?? '';
    if (path.trim() === '') throw new Error(`${name} missing (deployer=ssh)`);
    return path;
  };
  return new SshDeployer({ hosts, key: file('DEPLOYER_KEY_FILE'), knownHosts: file('DEPLOYER_KNOWN_HOSTS_FILE'), registry: new URL(forgeUrl).host,
    archive: (slug, cycleId, signal) => forge.scopingArchive(slug, cycleId, signal) });
}
