// Acceptance suite (decision E10): Gherkin scenarios of docs/spec.md through playwright-bdd, and the security specs
// of tests/acceptance/security/, against the core's test stack (tests/stack.js), in Chromium.
import { defineConfig } from '@playwright/test';
import { defineBddConfig } from 'playwright-bdd';
import { BASE } from './tests/stack.js';

const features = defineBddConfig({
  features: 'tests/acceptance/features/*.feature',
  steps: 'tests/acceptance/steps/*.js',
});

export default defineConfig({
  globalSetup: './tests/acceptance/setup.js',
  // One shared database and real logins: one worker keeps the run readable; every scenario makes its own data.
  workers: 1,
  timeout: 60_000,
  reporter: 'list',
  use: { baseURL: BASE },
  projects: [
    { name: 'features', testDir: features },
    { name: 'security', testDir: 'tests/acceptance/security' },
  ],
});
