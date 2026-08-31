import { NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logger'
import { env } from '@/env'
import { notifyDailySummary } from '@/lib/services/telegram'
import { getOraculSearchHealth } from '@/lib/services/oracleSearch'
import { prisma } from '@/lib/prisma'
import { secretsMatch } from '@/lib/cron-auth'

const log = createLogger('cron-heartbeat')

/**
 * GET /api/cron/heartbeat
 *
 * Sends a "server is alive" Telegram message directly from the app process
 * running on EC2 — independent of GitHub Actions. This means if GitHub Actions
 * has an outage and the watchdog stops running, daily heartbeats from this
 * endpoint will still prove the server itself is healthy.
 *
 * Trigger options:
 *  1. GitHub Actions (.github/workflows/heartbeat.yml) — daily, monitors GH Actions health
 *  2. EC2 crontab (recommended for true independence):
 *       0 12 * * * curl -sf -H "x-cron-secret: $BOT_RUNNER_SECRET" https://daatan.com/api/cron/heartbeat
 *
 * Protected by x-cron-secret header (same secret as BOT_RUNNER_SECRET).
 */
export async function GET(request: NextRequest) {
  const secret = request.headers.get('x-cron-secret')
  const expected = env.BOT_RUNNER_SECRET

  if (!expected || !secret || !secretsMatch(secret, expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const version = env.NEXT_PUBLIC_APP_VERSION || 'unknown'
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000)

  const [newUsers, published, commitments, resolutions, health] = await Promise.all([
    prisma.user.count({ where: { createdAt: { gte: since } } }),
    prisma.prediction.count({ where: { publishedAt: { gte: since } } }),
    prisma.commitment.count({ where: { createdAt: { gte: since } } }),
    prisma.prediction.count({ where: { resolvedAt: { gte: since } } }),
    getOraculSearchHealth(),
  ])

  const search = health
    ? { usable: health.usable_count, total: Object.keys(health.providers).length }
    : null

  notifyDailySummary({ version, newUsers, published, commitments, resolutions, search })
  log.info({ version, newUsers, published, commitments, resolutions }, 'Daily summary sent')

  return NextResponse.json({ ok: true, version, newUsers, published, commitments, resolutions })
}
