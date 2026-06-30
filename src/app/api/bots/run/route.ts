import { NextRequest, NextResponse } from 'next/server'
import { createHash, timingSafeEqual } from 'crypto'
import { runDueBots } from '@/lib/services/bots'
import { createLogger } from '@/lib/logger'
import { blockedOnSelfHost } from '@/lib/api-edition-guard'
import { env } from '@/env'

const log = createLogger('api/bots/run')

export const dynamic = 'force-dynamic'
export const maxDuration = 300 // 5 minutes — RSS + LLM calls can be slow

function secretsMatch(provided: string, expected: string): boolean {
  const a = createHash('sha256').update(provided).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b)
}

/**
 * POST /api/bots/run
 * Triggered by GitHub Actions on a schedule (every 5 minutes).
 * Protected by a shared secret in the x-bot-runner-secret header.
 */
export async function POST(request: NextRequest) {
  const blocked = blockedOnSelfHost()
  if (blocked) return blocked

  const secret = request.headers.get('x-bot-runner-secret')
  const expected = env.BOT_RUNNER_SECRET

  if (!expected || !secret || !secretsMatch(secret, expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  log.info('Bot runner triggered')

  try {
    const summaries = await runDueBots(false)
    return NextResponse.json({ ok: true, summaries })
  } catch (err) {
    log.error({ err }, 'Bot runner failed')
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
