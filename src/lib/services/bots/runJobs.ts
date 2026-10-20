import type { BotRunSummary } from './runner'

// In-process registry of manual "Run now" jobs (#1947). A bot run can take
// minutes (LLM calls with per-leg timeouts), longer than nginx will hold a
// request, so the route starts the job and returns 202; the admin UI polls.
// One entry per bot: a second start while one is running joins the first
// instead of launching a duplicate run. Lost on restart, which is fine for a
// manual admin action — the UI then sees "none" and stops polling.

export type BotRunJob =
  | { status: 'running'; dryRun: boolean; startedAt: number }
  | { status: 'done'; dryRun: boolean; startedAt: number; finishedAt: number; summary: BotRunSummary }
  | { status: 'failed'; dryRun: boolean; startedAt: number; finishedAt: number; error: string }

const FINISHED_TTL_MS = 10 * 60_000

const jobs = new Map<string, BotRunJob>()

export function getBotRunJob(botId: string, now = Date.now()): BotRunJob | undefined {
  const job = jobs.get(botId)
  if (job && job.status !== 'running' && now - job.finishedAt > FINISHED_TTL_MS) {
    jobs.delete(botId)
    return undefined
  }
  return job
}

/** Starts the run in the background. Returns false when one is already running. */
export function startBotRunJob(
  botId: string,
  dryRun: boolean,
  run: () => Promise<BotRunSummary>,
): boolean {
  if (getBotRunJob(botId)?.status === 'running') return false

  const startedAt = Date.now()
  jobs.set(botId, { status: 'running', dryRun, startedAt })
  run().then(
    (summary) => jobs.set(botId, { status: 'done', dryRun, startedAt, finishedAt: Date.now(), summary }),
    (err: unknown) =>
      jobs.set(botId, {
        status: 'failed',
        dryRun,
        startedAt,
        finishedAt: Date.now(),
        error: err instanceof Error ? err.message : String(err),
      }),
  )
  return true
}

export function resetBotRunJobsForTest(): void {
  jobs.clear()
}
