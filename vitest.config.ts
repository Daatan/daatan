import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/tests/**', '**/*.integration.test.ts', '**/.claude/worktrees/**'],
    coverage: {
      provider: 'v8',
      // `all: true` was removed in vitest v4's coverage options; `include`
      // is the supported replacement — it makes every matching source file
      // show up in the report (0% included) instead of only files touched
      // by a test, which is how api-middleware.ts, auth.ts, cron-auth.ts,
      // and api-edition-guard.ts were invisible in coverage before.
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      reporter: ['text', 'json', 'html'],
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '**/tests/**',
        '**/*.d.ts',
        '**/*.test.ts',
        '**/*.test.tsx',
        '**/__tests__/**',
        'src/test/**',
        'src/types/**',
        'next.config.js',
        'tailwind.config.js',
        'postcss.config.js',
      ],
      thresholds: {
        global: {
          statements: 80,
          branches: 75,
          functions: 80,
          lines: 80,
        },
        'src/lib/services/**': {
          statements: 75,
          branches: 60,
          functions: 75,
          lines: 75,
        }
      }
    },
    env: {
      TZ: 'UTC',
      DATABASE_URL: process.env.DATABASE_URL || 'postgresql://dummy:dummy@localhost:5432/dummy',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
