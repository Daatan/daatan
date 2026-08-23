import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./src/test/integration-test-env.ts'],
    include: ['**/*.integration.test.ts'],
    hookTimeout: 60000, // DB setup can be slow
    testTimeout: 30000,
    // Every file's beforeAll/afterAll drives the same fixed-name Docker
    // container and the same shared database (integration-helper.ts). With
    // more than one *.integration.test.ts file, vitest's default file
    // parallelism races: one file's teardown `docker compose down` against
    // another's `up`, and — even past that — two files' bodies running
    // concurrently against one Postgres would corrupt each other's state via
    // `truncateDatabase()` in beforeEach. Serialize file execution instead.
    fileParallelism: false,
    env: {
      TZ: 'UTC',
      NODE_ENV: 'test',
      SKIP_ENV_VALIDATION: '1',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
