# Workflow Preferences

## Decision Making
- Be decisive and take action without excessive confirmation
- For routine tasks (file edits, refactoring, bug fixes): just do it
- Only ask for confirmation on:
  - Destructive operations (deleting files, dropping tables)
  - Major architectural changes
  - Changes to production infrastructure
  - Ambiguous requirements

## Communication Style
- Be concise and direct
- Skip obvious explanations
- No need to summarize what you just did unless asked
- Don't repeat yourself

## Code Changes
- Make changes directly, don't ask "should I proceed?"
- Fix obvious issues without asking
- Add tests only when explicitly requested
- Keep refactoring minimal unless asked for cleanup

## When Uncertain
- Make reasonable assumptions and state them
- Prefer action over asking clarifying questions
- If truly ambiguous, ask ONE focused question

## Deployment Tasks
- **NEVER EVER merge to main without explicit request from user. Always use PR.**
- **NEVER** push a PR branch to the remote repository without explicit permission from the user.
- **NEVER** deploy to production (via tags, releases, or merges to main) without explicit permission from the user.
- The task is considered complete when the changes are verified locally and the user has been notified.
- Wait for a direct instruction like "push the PR" or "deploy to prod" before taking action on remote environments.
- Check Docker build logs if pages are missing from production - local builds may differ from Docker builds.

## Next.js App Router Gotchas
- `export const dynamic = 'force-dynamic'` only works in Server Components
- If a page has `'use client'` at the top, the dynamic export is IGNORED
- For client pages needing dynamic rendering, split into:
  - `page.tsx` (Server Component with dynamic export + Suspense wrapper)
  - `*Client.tsx` (Client Component with hooks and UI)
- `useSearchParams()` requires Suspense boundary in Next.js 14+
- Add `transpilePackages: ['next-auth']` in next.config.js for Docker builds

## File Operations
- Create/modify files directly
- Don't ask permission for each file
- Group related changes together

## Git Commands
- Git commands can hang waiting for pager input in non-interactive mode
- ALWAYS use this pattern: `GIT_PAGER=cat git log ...` (set env var before command)
- For extra safety, also add `--no-pager` flag: `GIT_PAGER=cat git --no-pager log -5`
- Always limit output with `-n` or `| head` to prevent large outputs

## Interactive Commands
- NEVER run commands that require user input (password prompts, interactive menus, etc.)
- Server access: SSH port 22 is closed on the EC2 hosts; use AWS SSM (`aws ssm send-command`), never SSH
- Linters: Skip or use `--fix` flag if linter requires interactive setup
- If a command prompts for input, stop and inform the user what needs to be configured
