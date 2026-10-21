import 'vitest'
import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers'

// vitest 5 no longer folds the global `jest.Matchers` into its Assertion type,
// so the jest-dom and jest-axe augmentations (which target `jest`) stopped
// applying. Register them on vitest's own `Matchers` instead.
declare module 'vitest' {
  interface Matchers<R extends void | Promise<void> = void | Promise<void>, T = unknown>
    extends TestingLibraryMatchers<unknown, R> {
    toHaveNoViolations(): R
  }
}
