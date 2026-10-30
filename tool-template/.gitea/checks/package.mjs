// Check 4 of guard-rails.sh (A-R0): the root package.json declares neither a
// lifecycle script (run by pnpm on install, or by a tool that would not pass
// --ignore-scripts) nor devEngines (pnpm 12 downloads by itself the pnpm or
// Node it asks for, without corepack). CI and the fixed Dockerfile already
// install without scripts: this is the belt, and it makes the attempt
// visible. Protected file (.gitea/**). Reads the file given as argument
// (default: package.json), writes one "GUARD-RAIL …" line per finding, exits
// with 1 if there is any.
// Core reference (G4, agents review 3, M1): every dependency comes from the
// registry (no file:, link:, git, http(s):, workspace:, npm: alias, path or
// tarball), @eupadev/core at an exact version, and pnpm-lock.yaml (next
// to package.json) resolves @eupadev/core from the registry only.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Scripts that npm or pnpm run by themselves (install, publication, pack,
// version), with their pre/post variants, and pnpm's own hook.
const LIFECYCLE = /^(pre|post)?(install|uninstall|prepare|publish|prepublishOnly|pack|version|dependencies|shrinkwrap)$|^pnpm:/;

const CORE = '@eupadev/core';
const EXACT = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
// Registry range or dist-tag only: no protocol (":"), no path or GitHub shorthand ("/"), no tarball name.
const fromRegistry = (spec) => typeof spec === 'string' && /^[\w.^~<>=|* +-]*$/.test(spec) && !/\.(tgz|tar|tar\.gz)$/i.test(spec);

export function findings(text) {
  let p;
  try { p = JSON.parse(text); } catch (e) { return [`package.json unreadable (${e.message})`]; }
  if (p === null || typeof p !== 'object' || Array.isArray(p)) return ['package.json: a JSON object is expected'];
  const output = [];
  const scripts = p.scripts ?? {};
  if (scripts === null || typeof scripts !== 'object' || Array.isArray(scripts)) output.push('package.json: "scripts" must be an object');
  else for (const name of Object.keys(scripts)) if (LIFECYCLE.test(name)) output.push(`package.json: lifecycle script "${name}" refused`);
  if (Object.hasOwn(p, 'devEngines')) output.push('package.json: "devEngines" refused (the platform sets the pnpm and Node versions)');
  const sections = {
    dependencies: p.dependencies, devDependencies: p.devDependencies, optionalDependencies: p.optionalDependencies,
    peerDependencies: p.peerDependencies, resolutions: p.resolutions, 'pnpm.overrides': p.pnpm?.overrides,
  };
  for (const [section, deps] of Object.entries(sections)) {
    if (deps === undefined) continue;
    if (deps === null || typeof deps !== 'object' || Array.isArray(deps)) { output.push(`package.json: "${section}" must be an object`); continue; }
    for (const [name, spec] of Object.entries(deps)) {
      if (!fromRegistry(spec)) output.push(`package.json: ${section} "${name}": ${JSON.stringify(spec)} refused (registry version only: no file:, link:, git, http(s):, workspace:, npm: alias, path or tarball)`);
      else if (name === CORE && !EXACT.test(spec)) output.push(`package.json: ${section} "${CORE}": "${spec}" refused (exact version required, e.g. 0.1.0)`);
    }
  }
  return output;
}

/**
 * pnpm-lock.yaml (v9), read line by line (no YAML parser in this protected check): every @eupadev/core entry
 * (importer, package key, snapshot) is an exact version, and its resolution is a registry one: an integrity, no
 * directory or git, a tarball only from the core owner's npm registry (/api/packages/eupadev-core/npm/, ADR-023:
 * packages are written per owner; a core published under any other owner is refused).
 */
export function lockfileFindings(text) {
  const output = [];
  const exact = (v) => EXACT.test(v.trim().replace(/^['"]|['"]$/g, '').replace(/\(.*$/, '')); // "(…)" = peer suffix
  let block = null; let blockIndent = 0;
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (t === '' || t.startsWith('#')) continue;
    const indent = line.length - line.trimStart().length;
    if (block !== null && indent <= blockIndent) block = null;
    const key = /^['"]?@eupadev\/core(?:@([^'"]*))?['"]?:(.*)$/.exec(t);
    if (key !== null) {
      const [, version, rest] = key;
      if (version !== undefined && !exact(version)) output.push(`pnpm-lock.yaml: ${CORE}@${version} refused (registry version only)`);
      else if (version === undefined && rest.trim() !== '' && !exact(rest)) output.push(`pnpm-lock.yaml: ${CORE}: ${rest.trim()} refused (registry version only)`);
      if (rest.trim() === '') { block = version === undefined ? 'importer' : 'package'; blockIndent = indent; }
      continue;
    }
    if (block === 'importer' && /^(specifier|version):/.test(t) && !exact(t.replace(/^\w+:/, ''))) {
      output.push(`pnpm-lock.yaml: ${CORE} ${t} refused (registry version only)`);
    }
    if (block === 'package' && t.startsWith('resolution:')) {
      const tarball = /tarball:\s*([^,}\s]+)/.exec(t)?.[1];
      if (!/integrity:/.test(t) || /\b(type|directory|commit|repo|path):/.test(t)
          || (tarball !== undefined && !/^https:\/\/[^/]+\/api\/packages\/eupadev-core\/npm\//.test(tarball))) {
        output.push(`pnpm-lock.yaml: ${CORE} ${t} refused (registry resolution only)`);
      }
    }
  }
  return output;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2] ?? 'package.json';
  const lockfile = join(dirname(file), 'pnpm-lock.yaml');
  const list = [...findings(readFileSync(file, 'utf8')), ...(existsSync(lockfile) ? lockfileFindings(readFileSync(lockfile, 'utf8')) : [])];
  for (const f of list) console.log(`GUARD-RAIL ${f}`);
  process.exit(list.length > 0 ? 1 : 0);
}
