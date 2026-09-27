# Testing Guide

## Overview

DAATAN uses Vitest for unit and integration testing and Playwright for end-to-end tests. Tests related to your changes must pass before code can be pushed (pre-push hook), and CI must be green before merging.

## Running Tests

```bash
# Run all unit tests (vitest.config.ts — happy-dom environment)
npm test

# Run tests in watch mode (development)
npx vitest

# Run specific test file
npm test -- __tests__/api/profile-language.test.ts

# Run only tests related to given source files
npm run test:related -- src/lib/foo.ts

# Run with coverage (thresholds in vitest.config.ts)
npm run test:coverage

# Integration tests (vitest.config.integration.ts — node environment, real Postgres)
# *.integration.test.ts files; they start the pgvector test DB from
# docker-compose.test.yml (host port 5433) and run serially
npm run test:integration

# End-to-end (Playwright): tests/e2e (playwright.config.ts, dev server on :3000)
npm run test:e2e
# Self-host edition e2e: tests/e2e-selfhost (playwright.selfhost.config.ts)
npm run test:e2e:selfhost
```

`npm test` excludes `tests/**` and `*.integration.test.ts`; it does pick up the Lambda tests in
`infra/**/index.test.mjs`.

## Test Structure

Unit tests live in two places:
- top-level `__tests__/{api,lib,services,config,components}/`
- co-located `__tests__/` folders next to the code under `src/` (most of them)

### API Route Tests
Location: `__tests__/api/` or `src/app/api/**/__tests__/`

Example:
```typescript
import { GET } from '@/app/api/endpoint/route'
import { vi, describe, it, expect } from 'vitest'

describe('API Endpoint', () => {
  it('returns expected data', async () => {
    // Test implementation
  })
})
```

### Component Tests
Location: `src/app/**/__tests__/` or `src/components/__tests__/`

Example:
```typescript
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import Component from '../Component'

describe('Component', () => {
  it('renders correctly', () => {
    render(<Component />)
    expect(screen.getByText('Expected Text')).toBeInTheDocument()
  })
})
```

## Mocking

### Prisma
```typescript
const prismaMock = {
  user: {
    findMany: vi.fn(),
    update: vi.fn(),
  },
}

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))
```

### NextAuth
Server-side session comes from `auth()` in `src/auth.ts` (NextAuth v5):
```typescript
vi.mock('@/auth', () => ({
  auth: vi.fn(() => Promise.resolve({ user: { id: '123' } })),
}))
```

### Next.js Navigation / `next-auth/react`
Already mocked globally in `src/test/setup.ts` (which also sets dummy env vars and
`SKIP_ENV_VALIDATION`).

## Test Coverage Requirements

- **API Routes**: Must have tests for:
  - Success cases
  - Error handling
  - Authentication checks
  - Input validation

- **Components**: Must have tests for:
  - Rendering
  - User interactions
  - Edge cases (loading, error states)

- **Utilities**: Must have tests for:
  - Core logic
  - Edge cases
  - Error handling

## Best Practices

1. **Test behavior, not implementation**
   - Focus on what the user sees/experiences
   - Don't test internal state unless necessary

2. **Use descriptive test names**
   ```typescript
   it('returns 401 when user is not authenticated', async () => {})
   ```

3. **Arrange-Act-Assert pattern**
   ```typescript
   // Arrange
   const mockData = { ... }
   
   // Act
   const result = await function(mockData)
   
   // Assert
   expect(result).toBe(expected)
   ```

4. **Mock external dependencies**
   - Database calls
   - API requests
   - Authentication

5. **Test error cases**
   - Always test both success and failure paths
   - Test edge cases (null, undefined, empty arrays)

## Common Issues

### Tests failing locally but passing in CI
- Check environment variables
- Ensure all dependencies are installed
- Clear node_modules and reinstall

### Mock not working
- Ensure mock is defined before import
- Use `vi.clearAllMocks()` in `beforeEach`
- Check mock path matches actual import path

### Async test timeout
- Increase timeout: `it('test', async () => {}, 10000)`
- Ensure all promises are awaited
- Check for infinite loops

## Pre-commit & Pre-push Checks

The **pre-commit** hook runs fast checks only:
1. Version-bump check (`scripts/check-version-bump.sh` — the version must advance past `origin/main`'s on any non-`main` branch)
2. `lint-staged` (lints staged `*.{ts,tsx}` files)

The **pre-push** hook runs the heavier verification:
1. Type check (`npm run typecheck`)
2. Targeted tests (`scripts/run-related-tests.sh origin/main` — `vitest related` on changed `.ts`/`.tsx` files, excluding integration tests)
3. Auth-change detection (non-blocking warning)

Full test suite + integration tests run in CI. If any blocking check fails, the commit/push is blocked.

## CI/CD Integration

GitHub Actions (`.github/workflows/deploy.yml`) runs on every PR:
- `Type check`, `Lint`
- `Unit tests` — related tests only, same script as pre-push (on pushes to `main`/tags the full suite runs instead, in 4 shards)
- `Integration Tests` (`npm run test:integration`)
- `Build & Test` — `next build`, `npm audit --audit-level=critical`, env-var parity check

plus the separate `Version bump` workflow (`.github/workflows/version.yml`). Playwright e2e
tests are not part of CI.

All checks must pass before merging.
