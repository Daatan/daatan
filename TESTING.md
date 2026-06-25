# Testing Guide

## Overview

DAATAN uses Vitest for unit and integration testing. All tests must pass before code can be committed.

## Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode (development)
npm test -- --watch

# Run specific test file
npm test -- __tests__/api/profile.test.ts

# Run with coverage
npm test -- --coverage
```

## Test Structure

### API Route Tests
Location: `__tests__/api/`

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
```typescript
vi.mock('next-auth/next', () => ({
  getServerSession: vi.fn(() => Promise.resolve({ user: { id: '123' } })),
}))
```

### Next.js Navigation
Already mocked globally in `src/test/setup.ts`

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
1. Version-bump check (for feature/fix branches)
2. `lint-staged` (lints staged `*.{ts,tsx}` files)

The **pre-push** hook runs the heavier verification:
1. Type check (`npm run typecheck`)
2. Targeted tests (`vitest related` on changed `.ts`/`.tsx` files, excluding integration tests)
3. Auth-change detection (non-blocking warning)

Full test suite + integration tests run in CI. If any blocking check fails, the commit/push is blocked.

## CI/CD Integration

GitHub Actions runs the same checks on every PR:
- Build
- Tests
- Linter

All checks must pass before merging.
