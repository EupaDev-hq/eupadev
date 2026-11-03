// Global (self-hosted) Renovate configuration for the FORGE's repositories
// (generated tools, template). NOT RUN YET: today Renovate only runs on
// GitHub for this repository (.github/workflows/renovate.yml, renovate.json);
// Renovate CLI on the forge is ROADMAP §8.14 C. Written now so that the
// core's part (registry of the @eupadev scope, read access) is settled
// (ADR-023).
//
// Secrets and installation values come from the environment only, never from
// a repository file: FORGE_DOMAIN (e.g. git.example.com) and RENOVATE_TOKEN
// (robot account; Gitea scopes write:repository, write:issue,
// read:organization, read:user and read:package — Renovate's Gitea platform
// page asks for the package scope when Gitea packages are used).
const forge = process.env.FORGE_DOMAIN;
// Own owner of the core (ADR-023): only svc-core writes packages there.
const registry = `https://${forge}/api/packages/eupadev-core/npm/`;

module.exports = {
  platform: 'gitea',
  endpoint: `https://${forge}/api/v1/`,
  token: process.env.RENOVATE_TOKEN,
  // A tool's .npmrc is a protected file and holds nothing: the scope's
  // registry is set here (Renovate then ignores any .npmrc of the repository).
  npmrc: `@eupadev:registry=${registry}\n`,
  // Read access to the forge's npm registry; Renovate writes it into the
  // .npmrc it generates for pnpm when it updates pnpm-lock.yaml.
  hostRules: [{ hostType: 'npm', matchHost: registry, token: process.env.RENOVATE_TOKEN }],
  packageRules: [
    {
      description: 'Core of the tools: exact version (guard G4), its own branch, never merged automatically.',
      matchPackageNames: ['@eupadev/core'],
      rangeStrategy: 'pin',
      groupName: 'core',
      automerge: false,
      labels: ['dependencies', 'core'],
    },
  ],
};
