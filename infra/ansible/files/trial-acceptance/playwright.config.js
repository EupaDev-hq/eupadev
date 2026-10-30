// Acceptance suite of the test tool of verify-engine-preview.yml (not a real tool's suite): one Gherkin scenario run
// against the deployed Preview by the `acceptance` job, people found by role in KIT_REALM_FILE.
import { defineConfig } from '@playwright/test';
import { defineBddConfig } from 'playwright-bdd';

export default defineConfig({
  testDir: defineBddConfig({ features: 'features/*.feature', steps: 'steps/*.js' }),
  workers: 1,
  timeout: 60_000,
});
