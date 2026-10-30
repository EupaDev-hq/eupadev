// Real test of the deployer adapter (E5d, run by the lab's deployer verify playbooks), run inside the engine image on the
// engine VM: `externalWorld` builds `SshDeployer` from the same variables as the service (EUPADEV_EXTERNAL with
// deployer=ssh, DEPLOYER_HOSTS, DEPLOYER_KEY_FILE, DEPLOYER_KNOWN_HOSTS_FILE, FORGE_URL), then makes one call.
//   node scripts/trial-deployment.ts deploy <env> <slug> <cycle> <sha256:…> | served <env> <slug> | remove <env> <slug> <cycle>
// Output: one JSON line (the adapter's result). Exit 0 = answer; 1 = error; 2 = usage.
import { externalWorld } from '../src/external/world.ts';
import type { Environment } from '../src/external/contracts.ts';

const [action, env, slug, cycle, digest] = process.argv.slice(2) as [string, Environment, string, string?, string?];
try {
  const { deployer } = externalWorld(process.env, 'trial').external;
  let r: unknown;
  if (action === 'deploy') r = await deployer.deploy(env, slug, Number(cycle), digest ?? null);
  else if (action === 'served') r = await deployer.served(env, slug);
  else if (action === 'remove') r = (await deployer.remove(env, slug, Number(cycle))) ?? 'done';
  else {
    console.error('usage: trial-deployment.ts deploy|served|remove <env> <slug> [cycle] [digest]');
    process.exit(2);
  }
  console.log(JSON.stringify(r));
} catch (e) {
  console.error(`FAILED: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
