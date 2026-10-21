import 'vitest'

// jest-axe ships no vitest types (@types/jest-axe augments the global `jest`
// namespace, which vitest 5 no longer reads), so register its matcher on
// vitest's own `Matchers`. jest-dom's matchers come from
// `@testing-library/jest-dom/vitest`, imported in setup.ts.
declare module 'vitest' {
  interface Matchers<R extends void | Promise<void> = void | Promise<void>, T = unknown> {
    toHaveNoViolations(): R
  }
}
