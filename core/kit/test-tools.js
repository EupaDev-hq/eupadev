// External tools of the kit (§2.10) run in containers, images pinned by digest (ADR-005), with the static headers
// (`REQUEST_HEADERS`) and the session of a signed-in person (`Cookie`): without them, every `/api/**` request gets
// 403 `CSRF_BLOCKED` and the tool only tests the refusal. Each function returns the arguments of `docker`.
// Host network: the tool is reached at the address published by the test Compose (`base`).
import { dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REQUEST_HEADERS } from './headers.js';

export const IMAGES = Object.freeze({
  schemathesis: 'schemathesis/schemathesis:4.31.0@sha256:58a4ffa68cd690a04eb70fd2d1c790acd54cd73986c777ec2556c901b6b707e4',
  zap: 'ghcr.io/zaproxy/zaproxy:2.17.0@sha256:7aaa659b0d43078febd82e29bad112285c370727e86ab8340444220e17d9f0d2',
  k6: 'grafana/k6:2.3.0@sha256:9c2dee7f8ed74d317e4027c06a10f169b625638189de8d4555d0b3486a5aeb34',
});

/** @typedef {{ base: string, cookie: string, headers?: Record<string, string> }} Target */

/** @param {Target} t */
const headers = (t) => ({ ...REQUEST_HEADERS, ...t.headers, cookie: t.cookie });

/**
 * Schemathesis on the contract (`st run`), every default check; `options`: extra arguments
 * (`--max-time`, `--phases`, `--checks`…). `config`: the tool's `schemathesis.toml`, for what the schema cannot say
 * (e.g. 422 as the expected answer of a business rule). The kit's hooks (`schemathesis_hooks.py`) are always loaded:
 * they serialise the core's upload bodies (raw file bytes).
 * @param {Target & { contract: string, config?: string, options?: string[] }} c
 */
export function argsSchemathesis(c) {
  const config = c.config ? ['-v', `${c.config}:/contract/schemathesis.toml:ro`] : [];
  const hooks = ['-v', `${fileURLToPath(new URL('./schemathesis_hooks.py', import.meta.url))}:/hooks/eupadev_hooks.py:ro`,
    '-e', 'PYTHONPATH=/hooks', '-e', 'SCHEMATHESIS_HOOKS=eupadev_hooks'];
  return ['run', '--rm', '--network', 'host', '-v', `${c.contract}:/contract/openapi.yaml:ro`, ...config, ...hooks, IMAGES.schemathesis,
    ...(c.config ? ['--config-file', '/contract/schemathesis.toml'] : []), 'run', '/contract/openapi.yaml',
    // The core refuses U+0000 in any string (400, PostgreSQL text cannot hold it): not generated, by rule.
    '--url', c.base, '--generation-allow-x00', 'false', ...Object.entries(headers(c)).flatMap(([k, v]) => ['-H', `${k}: ${v}`]), ...(c.options ?? [])];
}

/**
 * Authenticated ZAP api-scan (`-f openapi`): the session through `ZAP_AUTH_HEADER`, the static headers through
 * "replacer" rules (a header added to every request). HTML report in `report` (mounted directory).
 * @param {Target & { contract: string, report: string }} c
 */
export function argsZap(c) {
  const rules = Object.entries({ ...REQUEST_HEADERS, ...c.headers }).flatMap(([k, v], i) => [
    `-config replacer.full_list(${i}).description=eupadev-${i}`, `-config replacer.full_list(${i}).enabled=true`,
    `-config replacer.full_list(${i}).matchtype=REQ_HEADER`, `-config replacer.full_list(${i}).matchstr=${k}`,
    `-config replacer.full_list(${i}).regex=false`, `-config replacer.full_list(${i}).replacement=${v}`,
  ]);
  return ['run', '--rm', '--network', 'host', '-e', 'ZAP_AUTH_HEADER=Cookie', '-e', `ZAP_AUTH_HEADER_VALUE=${c.cookie}`,
    '-v', `${dirname(c.contract)}:/zap/contract:ro`, '-v', `${c.report}:/zap/wrk:rw`, IMAGES.zap,
    'zap-api-scan.py', '-t', `/zap/contract/${basename(c.contract)}`, '-f', 'openapi', '-O', c.base, '-r', 'zap-report.html', '-I', '-z', rules.join(' ')];
}

/**
 * k6 on a script of the tool, which imports `REQUEST_HEADERS` from the kit's `headers.js`, reads the sessions in
 * `__ENV.COOKIES` (JSON array, one per person of the test realm: one VU = one person, K4) and the origin in
 * `__ENV.BASE`. The per-person rate limit stays whole: never an exemption in the tool. `dir` is mounted on
 * `/scripts` (it holds the script and the kit).
 * @param {{ base: string, cookies: string[], dir: string, script: string, options?: string[] }} c
 */
export function argsK6(c) {
  return ['run', '--rm', '--network', 'host', '-e', `BASE=${c.base}`, '-e', `COOKIES=${JSON.stringify(c.cookies)}`, '-v', `${c.dir}:/scripts:ro`,
    IMAGES.k6, 'run', ...(c.options ?? []), `/scripts/${c.script}`];
}
