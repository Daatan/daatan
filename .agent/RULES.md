# Antigravity Project Rules

## 🚨 CRITICAL GIT WORKFLOW RULES

### NEVER Push to the Remote Repository Without Permission
- **NEVER EVER merge to main without explicit request from user. Always use PR.**
- **NEVER** push a feature branch or PR branch to origin without explicit permission.
- **NEVER** merge or push directly to `main` or `staging`.
- **STOP** after local verification and wait for the user to say "push the PR" or "deploy to prod."

### NO UNAUTHORIZED PRODUCTION UPDATES
- **NEVER** create or push a version tag (e.g., `git tag v1.x.x`) without explicit permission.
- **NEVER** apply Terraform changes to the production environment unless specifically instructed for a targeted resource (e.g., `-target=...`).
- **NEVER** use SSM or direct server commands to modify production configuration or files unless it is an emergency restoration requested by the user.

## PR Quality Requirements

### Before Creating Any PR
ALWAYS run these checks locally before pushing:
1. **Run tests**: `npm test`
2. **Run build**: `npm run build`
3. **Run linter**: `npm run lint`

### Zero Tolerance for Errors
- PRs must have 0 test failures.
- PRs must have 0 build errors.
- PRs must have 0 lint errors.

## Decision Making

### Be Decisive
- For routine tasks (file edits, refactoring, bug fixes): just do it.
- Only ask for confirmation on:
  - Destructive operations (deleting files, dropping tables).
  - Major architectural changes.
  - Production infrastructure modifications.
  - Ambiguous requirements.

### When Uncertain
- Make reasonable assumptions and state them.
- Prefer action over asking clarifying questions.
- If truly ambiguous, ask ONE focused question.

## Communication Style
- Be concise and direct.
- Skip obvious explanations.
- No need to summarize what you just did unless asked.
- Don't repeat yourself.

## Coding Standards

### React/Next.js
- Use functional components with hooks.
- Prefer Server Components where possible.
- Use App Router patterns.
- Always wrap `useSearchParams()` in a `<Suspense>` boundary.
- All database-connected pages must use `export const runtime = 'nodejs'`.

### Database & API
- Always use Prisma for database operations.
- Use Zod for request validation (schemas in `src/lib/validations/`).
- Add indexes for frequently queried fields.

### Testing
- Use Vitest for unit tests.
- Mock external services using `vi.hoisted` for stability.

## Interactive Commands
- **NEVER** run commands that require user input.
- Server access: SSH port 22 is closed on the EC2 hosts; use AWS SSM (`aws ssm send-command`).
- Git commands: Use `GIT_PAGER=cat` and `--no-pager` to prevent hangs.

## Next.js App Router Gotchas
- `export const dynamic = 'force-dynamic'` only works in Server Components.
- If a page has `'use client'`, the dynamic export is IGNORED.
- Add `transpilePackages: ['next-auth']` in `next.config.js` if build issues occur.
