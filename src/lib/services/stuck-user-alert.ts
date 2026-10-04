import { notifyStuckUser } from '@/lib/services/telegram'

/**
 * "Stuck user" detector (#1787). A validation failure (400 / ZodError) is
 * user-input noise individually, so withAuth never alerts on it — which is how a
 * new user hit the same tags ZodError on 8 Publish clicks without anyone noticing.
 * Repeated failures by one user on the create/publish path within a short window
 * mean the UI is not letting them recover, which is worth one Telegram ping.
 *
 * In-memory: correct for the single app container this runs in. A blue-green
 * switch or restart resets the counters, and if the app is ever scaled to more
 * than one replica each replica counts on its own (an alert may need more clicks).
 */

export const STUCK_USER_THRESHOLD = 3
export const STUCK_USER_WINDOW_MS = 10 * 60 * 1000
const MAX_TRACKED_USERS = 1000

const TRACKED_ROUTES: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /^\/api\/forecasts\/?$/, label: 'POST /api/forecasts' },
  { pattern: /^\/api\/forecasts\/[^/]+\/publish\/?$/, label: 'POST /api/forecasts/[id]/publish' },
]

interface UserFailures {
  timestamps: number[]
  routes: Set<string>
  firstIssue: string
  alertedAt: number | null
}

const failures = new Map<string, UserFailures>()

/** Route label when this method+path is watched for stuck users, else null. */
export function stuckUserRouteLabel(method: string, pathname: string): string | null {
  if (method !== 'POST') return null
  return TRACKED_ROUTES.find(r => r.pattern.test(pathname))?.label ?? null
}

function prune(now: number): void {
  if (failures.size < MAX_TRACKED_USERS) return
  for (const [userId, entry] of failures) {
    const last = entry.timestamps[entry.timestamps.length - 1] ?? 0
    if (now - last > STUCK_USER_WINDOW_MS) failures.delete(userId)
  }
}

/**
 * Record one validation failure. Alerts when a user reaches THRESHOLD failures
 * within the window, then stays quiet for that user for a full window — a burst
 * of clicks produces one alert, a user still stuck 10+ minutes later another.
 */
export function recordValidationFailure(input: {
  user: { id: string; name?: string | null; email?: string | null }
  route: string
  issue: string
  now?: number
}): void {
  const now = input.now ?? Date.now()
  prune(now)

  let entry = failures.get(input.user.id)
  if (!entry) {
    entry = { timestamps: [], routes: new Set(), firstIssue: input.issue, alertedAt: null }
    failures.set(input.user.id, entry)
  }
  entry.timestamps = entry.timestamps.filter(t => now - t < STUCK_USER_WINDOW_MS)
  if (entry.timestamps.length === 0) {
    entry.routes = new Set()
    entry.firstIssue = input.issue
  }

  entry.timestamps.push(now)
  entry.routes.add(input.route)

  if (entry.alertedAt !== null && now - entry.alertedAt < STUCK_USER_WINDOW_MS) return
  if (entry.timestamps.length < STUCK_USER_THRESHOLD) return

  entry.alertedAt = now
  notifyStuckUser({
    user: input.user,
    routes: [...entry.routes],
    firstIssue: entry.firstIssue,
    count: entry.timestamps.length,
    windowMinutes: STUCK_USER_WINDOW_MS / 60_000,
  })
}

/** Test-only. */
export function resetStuckUserTracker(): void {
  failures.clear()
}
