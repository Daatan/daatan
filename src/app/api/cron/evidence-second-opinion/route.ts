import { NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logger'
import { env } from '@/env'
import { secretsMatch } from '@/lib/cron-auth'
import { checkEvidenceSecondOpinion } from '@/lib/services/evidence-second-opinion'
import { notifyEvidenceSecondOpinionDigest } from '@/lib/services/telegram'

const log = createLogger('cron-evidence-second-opinion')

/**
 * GET /api/cron/evidence-second-opinion
 * Protected by x-cron-secret header (same secret as the other cron routes).
 *
 * Twice-weekly "interesting cases" audit (daatan#1636): re-reads recently-pooled,
 * Gate-0-in-window articles that deviate sharply from their forecast's published
 * number with a stronger model, and escalates only when the cheap and expensive
 * readings disagree with EACH OTHER (not just with the published number) — plus a
 * pure-SQL same-source stance-drift check. Mechanical only: no GitHub issues are
 * filed here, a human triages via `/audit` or manually.
 *
 * `?dryRun=true` computes the report without posting to Telegram or consuming
 * the dedup ledger — for manual verification before the cron is trusted.
 *
 * GitHub Actions: .github/workflows/evidence-second-opinion.yml (Mon/Thu)
 */
export async function GET(request: NextRequest) {
  const secret = request.headers.get('x-cron-secret')
  const expected = env.BOT_RUNNER_SECRET

  if (!expected || !secret || !secretsMatch(secret, expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const dryRun = request.nextUrl.searchParams.get('dryRun') === 'true'

  try {
    const result = await checkEvidenceSecondOpinion(new Date(), { dryRun })

    if (!dryRun) {
      notifyEvidenceSecondOpinionDigest({
        issues: result.issues,
        articlesChecked: result.articlesChecked,
      })
    }

    return NextResponse.json({
      ok: true,
      dryRun,
      articlesChecked: result.articlesChecked,
      suppressed: result.suppressed,
      issues: result.issues,
    })
  } catch (err) {
    log.error({ err }, 'evidence-second-opinion check failed')
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
