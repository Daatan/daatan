import { defineConfig, devices } from '@playwright/test'

/**
 * Self-hosted edition E2E (Layer 2 of docs/SELF_HOST_TEST_PLAN.md).
 *
 * Boots the app with DAATAN_EDITION=self_hosted + branding, AI add-ons OFF,
 * on a dedicated port (3100) so it never collides with the default e2e server.
 * No ALLOWED_EMAIL_DOMAINS here — so the Playwright test provider can sign in;
 * the domain gate is exercised against Keycloak (Layer 3), not this spec.
 *
 *   npm run test:e2e:selfhost
 */
const PORT = 3100
const BASE = `http://localhost:${PORT}`

export default defineConfig({
  testDir: './tests/e2e-selfhost',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: BASE,
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], storageState: 'playwright/.auth/selfhost.json' },
      dependencies: ['setup'],
    },
  ],
  webServer: {
    command: `npm run start -- -p ${PORT}`,
    url: BASE,
    // Always boot a fresh self-host server — never reuse a possibly-SaaS one.
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      PLAYWRIGHT_TEST: 'true',
      DATABASE_URL: process.env.DATABASE_URL || 'postgresql://dummy:dummy@localhost:5432/dummy',
      NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET || 'test-secret-32-chars-minimum-length!!',
      NEXTAUTH_URL: BASE,
      // The edition under test:
      DAATAN_EDITION: 'self_hosted',
      APP_NAME: 'Acme Forecasting',
      APP_URL: BASE,
      // AI + external markets intentionally unset → off by default.
      SKIP_ENV_VALIDATION: process.env.SKIP_ENV_VALIDATION || '1',
    },
  },
})
