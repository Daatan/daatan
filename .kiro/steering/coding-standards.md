# Coding Standards

## General Rules
- Write minimal code that solves the problem
- Prefer mainstream solutions over custom implementations
- Use TypeScript strict mode
- No console.log in production code (use proper logging)

## React/Next.js
- Use functional components with hooks
- Prefer Server Components where possible
- Use App Router patterns (not Pages Router)
- Client components must have "use client" directive
- For pages with useSearchParams, split into Server/Client components:
  - Server Component: page.tsx with a `<Suspense>` wrapper (no `export const dynamic` — with Cache Components on it is a build error)
  - Client Component: *Client.tsx with hooks and UI logic
- Always wrap useSearchParams in Suspense boundary

## Database
- Always use Prisma for database operations
- Use transactions for multi-step operations
- Add indexes for frequently queried fields

## API Routes
- Use Zod for request validation (schemas in src/lib/validations/)
- Return consistent error responses
- Include proper HTTP status codes

## Testing
- Use Vitest for unit tests
- Tests go in __tests__/ or adjacent to source files
- Mock external services

## Git
- **NEVER merge to main without explicit user approval** - always create PR and wait
- **NEVER use `gh pr merge`** - user will merge PRs manually
- After creating PR, stop and wait for user review
- Use conventional commits: feat:, fix:, chore:, etc.
- Keep PRs focused and small
