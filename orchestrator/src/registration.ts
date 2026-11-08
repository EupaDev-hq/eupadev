/**
 * Gate 1 registration helper of a core tool (D-E5 kept, friction removed): the NAMES the admin needs to write the
 * tool's entry of `infra/ansible/group_vars/all/core-tools.yml` — the client roles of the contract (`x-roles` of
 * `openapi.yaml`) and the retention periods the purge reads (`current_setting('purge.retention_<x>')` of `db/purge.sql`,
 * plus `RETENTION_AUDIT`, which the core always purges). Both files are agent-written: the names are shown to the admin,
 * who decides the durations and pastes the entry; nothing here reaches the targets (S8). Pure functions, no I/O.
 */
import { parse } from 'yaml';

export interface Registration {
  /** Client roles, in order of first appearance in the contract, each a valid Keycloak role name of the core's linter. */
  roles: string[];
  /** `RETENTION_<X>` names, `RETENTION_AUDIT` first, then those of `db/purge.sql` in order of first appearance. */
  retentions: string[];
}

/** Same pattern as the core's contract linter (`core/src/contract-lint.js`, ROLE). */
const ROLE = /^[a-z][a-z0-9_-]{0,63}$/;
/** Same pattern as `register-tools.yml` and the deployer (RETENTION). */
const RETENTION = /^RETENTION_[A-Z][A-Z0-9_]*$/;
export const AUDIT = 'RETENTION_AUDIT';
const PURGE_SETTING = /current_setting\(\s*'purge\.retention_([a-z0-9_]+)'/g;

/** `x-roles` of every operation of the contract, deduplicated; an unreadable contract or an invalid name gives nothing for it. */
export function rolesOf(openapi: string): string[] {
  let doc: unknown;
  try {
    doc = parse(openapi);
  } catch {
    return [];
  }
  const roles: string[] = [];
  const walk = (x: unknown): void => {
    if (Array.isArray(x)) return x.forEach(walk);
    if (x === null || typeof x !== 'object') return;
    for (const [k, v] of Object.entries(x as Record<string, unknown>)) {
      if (k === 'x-roles' && Array.isArray(v)) {
        for (const r of v) if (typeof r === 'string' && ROLE.test(r) && !roles.includes(r)) roles.push(r);
      } else walk(v);
    }
  };
  walk(doc);
  return roles;
}

/** `RETENTION_AUDIT`, then each `purge.retention_<x>` setting of the tool's purge as `RETENTION_<X>`. */
export function retentionsOf(purgeSql: string): string[] {
  const names = [AUDIT];
  for (const m of purgeSql.matchAll(PURGE_SETTING)) {
    const name = `RETENTION_${m[1]!.toUpperCase()}`;
    if (RETENTION.test(name) && !names.includes(name)) names.push(name);
  }
  return names;
}
