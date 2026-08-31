import { NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logger'
import { env } from '@/env'
import { getOraculSearchHealth, SEARCH_LOW_CREDITS_THRESHOLD } from '@/lib/services/oracleSearch'
import { notifySearchHealthDigest, type SearchHealthIssue } from '@/lib/services/telegram'
import { secretsMatch } from '@/lib/cron-auth'

const log = createLogger('cron-search-health')

/**
 * GET /api/cron/search-health
 * Polls oracle /search/health and fires Telegram alerts for exhausted or
 * low-credit providers. Protected by x-cron-secret header.
 *
 * GitHub Actions: .github/workflows/search-health.yml (hourly)
 */
export async function GET(request: NextRequest) {
  const secret = request.headers.get('x-cron-secret')
  const expected = env.BOT_RUNNER_SECRET

  if (!expected || !secret || !secretsMatch(secret, expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const health = await getOraculSearchHealth()

  if (!health) {
    log.warn('Oracul search health unavailable — skipping notifications')
    return NextResponse.json({ ok: true, skipped: true, reason: 'oracle_not_configured' })
  }

  log.info({ overall: health.overall, usable_count: health.usable_count }, 'Oracul search health check')

  const issues: SearchHealthIssue[] = []

  for (const [name, provider] of Object.entries(health.providers)) {
    if (!provider.configured) continue

    if (provider.exhausted) {
      issues.push({ provider: name, kind: 'exhausted' })
      continue
    }

    if (typeof provider.credits === 'number' && provider.credits < SEARCH_LOW_CREDITS_THRESHOLD) {
      issues.push({ provider: name, kind: 'low', credits: provider.credits })
    }
  }

  // One grouped message instead of one per provider.
  notifySearchHealthDigest({ issues, overall: health.overall, usableCount: health.usable_count })

  const alerts = issues.map((i) =>
    i.kind === 'exhausted' ? `${i.provider}: exhausted` : `${i.provider}: ${i.credits} credits remaining`,
  )
  if (health.overall === 'unhealthy' || health.usable_count === 0) {
    alerts.push('all providers failed')
  }

  log.info({ alerts, overall: health.overall }, 'Search health cron complete')

  return NextResponse.json({
    ok: true,
    overall: health.overall,
    usable_count: health.usable_count,
    alerts,
  })
}
