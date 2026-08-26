import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prisma } from '@/lib/prisma'
import { hashUrl } from '@/lib/utils/hash'
import {
  checkEvidenceSecondOpinion,
  DEVIATION_TRIGGER_PP,
  SOURCE_DRIFT_TRIGGER_PP,
} from '@/lib/services/evidence-second-opinion'

vi.mock('@/lib/services/oracle', async () => {
  const actual = await vi.importActual<typeof import('@/lib/services/oracle')>('@/lib/services/oracle')
  return { ...actual, getOracleForecast: vi.fn() }
})
import { getOracleForecast } from '@/lib/services/oracle'
const oracleMock = vi.mocked(getOracleForecast)

beforeEach(() => {
  oracleMock.mockReset()
})

/** mean in [-1,1] that maps to a given percent via (mean+1)/2*100. */
function meanForPct(pct: number): number {
  return pct / 50 - 1
}

function oracleResult(pct: number) {
  return {
    forecast: { mean: meanForPct(pct), std: 0, ci_low: 0, ci_high: 0, articles_used: 1, sources: [], placeholder: false, question: 'q' },
    logId: null,
  }
}

let userSeq = 0
async function makeUser() {
  userSeq++
  return prisma.user.create({ data: { email: `u${userSeq}@example.com`, name: `User ${userSeq}`, rs: 100 } })
}

let predSeq = 0
async function makePrediction(authorId: string, overrides: Record<string, unknown> = {}) {
  predSeq++
  return prisma.prediction.create({
    data: {
      claimText: `Claim ${predSeq}`,
      authorId,
      status: 'ACTIVE',
      outcomeType: 'BINARY',
      resolveByDatetime: new Date('2030-01-01'),
      shareToken: `token-${predSeq}-${Date.now()}`,
      confidence: 50,
      claimArchetype: 'DIFFUSE',
      ...overrides,
    } as Parameters<typeof prisma.prediction.create>[0]['data'],
  })
}

let articleSeq = 0
async function makeArticle(predictionId: string, overrides: Record<string, unknown> = {}) {
  articleSeq++
  const url = `https://example.com/a${articleSeq}`
  return prisma.evidencePoolArticle.create({
    data: {
      predictionId,
      url,
      urlHash: hashUrl(url),
      title: `Article ${articleSeq}`,
      snippet: 'snippet text',
      source: 'example.com',
      origin: 'backfill',
      status: 'COMPLETE',
      excluded: false,
      stance: 0,
      certainty: 0.8,
      credibilityWeight: 1,
      relevanceScore: 0.8,
      ...overrides,
    } as Parameters<typeof prisma.evidencePoolArticle.create>[0]['data'],
  })
}

function daysAgo(n: number, from: Date = new Date()): Date {
  return new Date(from.getTime() - n * 24 * 60 * 60 * 1000)
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

describe('checkEvidenceSecondOpinion — detector 1 candidate window (Gate-0 fix)', () => {
  it('excludes an article whose date falls outside the Gate-0 window, even though it deviates sharply, and includes an in-window one', async () => {
    const now = new Date()
    const user = await makeUser()
    const prediction = await makePrediction(user.id, { createdAt: now, claimDeadline: daysAgo(-30, now), confidence: 50 })

    // Outside window: published 200 days before the claim was created — the
    // adjacent-event class Gate-0 exists to zero. Deviates by 50pp from
    // confidence (stance=1 -> 100%), which is exactly the false-positive the
    // 2026-08-26 manual scan found before this fix.
    await makeArticle(prediction.id, {
      stance: 1,
      publishedDate: isoDate(daysAgo(200, now)),
    })
    // Inside window: published 2 days ago, same deviation.
    const inWindow = await makeArticle(prediction.id, {
      stance: 1,
      publishedDate: isoDate(daysAgo(2, now)),
    })

    oracleMock.mockResolvedValue(oracleResult(100) as never)

    await checkEvidenceSecondOpinion(now, { dryRun: true })

    expect(oracleMock).toHaveBeenCalledTimes(1)
    expect(oracleMock.mock.calls[0][1]).toMatchObject({
      articles: [expect.objectContaining({ url: inWindow.url })],
    })
  })

  it('treats a scheduled-archetype claim as exempt from the window check, same as retro', async () => {
    const now = new Date()
    const user = await makeUser()
    const prediction = await makePrediction(user.id, {
      createdAt: now,
      claimArchetype: 'SCHEDULED',
      claimDeadline: daysAgo(-30, now),
      confidence: 50,
    })
    const old = await makeArticle(prediction.id, { stance: 1, publishedDate: isoDate(daysAgo(200, now)) })

    oracleMock.mockResolvedValue(oracleResult(100) as never)

    await checkEvidenceSecondOpinion(now, { dryRun: true })

    expect(oracleMock).toHaveBeenCalledTimes(1)
    expect(oracleMock.mock.calls[0][1]).toMatchObject({ articles: [expect.objectContaining({ url: old.url })] })
  })

  it('does not flag a candidate below the deviation trigger', async () => {
    const now = new Date()
    const user = await makeUser()
    const prediction = await makePrediction(user.id, { createdAt: now, confidence: 50 })
    // stance 0.05 -> ~52.5%, well under DEVIATION_TRIGGER_PP from 50.
    await makeArticle(prediction.id, { stance: 0.05, publishedDate: isoDate(daysAgo(1, now)) })

    const { issues, articlesChecked } = await checkEvidenceSecondOpinion(now, { dryRun: true })

    expect(articlesChecked).toBe(0)
    expect(issues).toEqual([])
    expect(oracleMock).not.toHaveBeenCalled()
    expect(DEVIATION_TRIGGER_PP).toBeGreaterThan(0)
  })
})

describe('checkEvidenceSecondOpinion — detector 1 model disagreement', () => {
  it('escalates when the expensive re-read disagrees with the cheap reading', async () => {
    const now = new Date()
    const user = await makeUser()
    const prediction = await makePrediction(user.id, { createdAt: now, confidence: 70 })
    // cheap stance -> 30%, deviates 40pp from confidence=70 (candidate)
    await makeArticle(prediction.id, { stance: -0.4, publishedDate: isoDate(daysAgo(1, now)) })

    // Expensive model reads 60% -> 30pp disagreement with the cheap 30%.
    oracleMock.mockResolvedValue(oracleResult(60) as never)

    const { issues } = await checkEvidenceSecondOpinion(now, { dryRun: true })

    expect(issues).toEqual([
      expect.objectContaining({ kind: 'model_disagreement', cheapPct: 30, expensivePct: 60, publishedPct: 70 }),
    ])
  })

  it('does not escalate when the expensive re-read agrees with the cheap reading', async () => {
    const now = new Date()
    const user = await makeUser()
    const prediction = await makePrediction(user.id, { createdAt: now, confidence: 70 })
    await makeArticle(prediction.id, { stance: -0.4, publishedDate: isoDate(daysAgo(1, now)) })

    // Expensive model reads 32% -> only 2pp disagreement with the cheap 30%.
    oracleMock.mockResolvedValue(oracleResult(32) as never)

    const { issues } = await checkEvidenceSecondOpinion(now, { dryRun: true })

    expect(issues.filter((i) => i.kind === 'model_disagreement')).toEqual([])
  })

  it('skips a candidate when the Oracle re-read comes back null, rather than escalating', async () => {
    const now = new Date()
    const user = await makeUser()
    const prediction = await makePrediction(user.id, { createdAt: now, confidence: 70 })
    await makeArticle(prediction.id, { stance: -0.4, publishedDate: isoDate(daysAgo(1, now)) })

    oracleMock.mockResolvedValue({ forecast: null, logId: null } as never)

    const { issues } = await checkEvidenceSecondOpinion(now, { dryRun: true })

    expect(issues).toEqual([])
  })
})

describe('checkEvidenceSecondOpinion — detector 2 same-source drift', () => {
  it('flags a source whose stance moved sharply between an older and a newer article', async () => {
    const now = new Date()
    const user = await makeUser()
    const prediction = await makePrediction(user.id, { createdAt: now })
    const older = await makeArticle(prediction.id, {
      source: 'reuters.com',
      stance: -0.6, // 20%
      publishedDate: isoDate(daysAgo(10, now)),
    })
    const newer = await makeArticle(prediction.id, {
      source: 'reuters.com',
      stance: 0.6, // 80%
      publishedDate: isoDate(daysAgo(1, now)),
    })
    // The 60pp gap between these two also makes each one a detector-1 candidate
    // against the default confidence=50 — have the "expensive" mock agree with
    // whichever article it's asked about, so detector 1 stays silent and this
    // test isolates detector 2.
    oracleMock.mockImplementation(async (_q, opts) => {
      const url = (opts as { articles: Array<{ url: string }> }).articles[0].url
      const pct = url === older.url ? 20 : url === newer.url ? 80 : 50
      return oracleResult(pct) as never
    })

    const { issues } = await checkEvidenceSecondOpinion(now, { dryRun: true })

    expect(issues.filter((i) => i.kind === 'model_disagreement')).toEqual([])
    expect(issues).toContainEqual(
      expect.objectContaining({ kind: 'source_drift', source: 'reuters.com', olderPct: 20, newerPct: 80 }),
    )
    expect(SOURCE_DRIFT_TRIGGER_PP).toBeLessThanOrEqual(60)
  })

  it('does not flag two different sources drifting, only the same source over time', async () => {
    const now = new Date()
    const user = await makeUser()
    const prediction = await makePrediction(user.id, { createdAt: now })
    await makeArticle(prediction.id, { source: 'reuters.com', stance: -0.6, publishedDate: isoDate(daysAgo(10, now)) })
    await makeArticle(prediction.id, { source: 'apnews.com', stance: 0.6, publishedDate: isoDate(daysAgo(1, now)) })
    oracleMock.mockResolvedValue(oracleResult(50) as never)

    const { issues } = await checkEvidenceSecondOpinion(now, { dryRun: true })

    expect(issues.filter((i) => i.kind === 'source_drift')).toEqual([])
  })
})

describe('checkEvidenceSecondOpinion — dedup + dry run', () => {
  it('dry run never writes to the dedup ledger', async () => {
    const now = new Date()
    const user = await makeUser()
    const prediction = await makePrediction(user.id, { createdAt: now, confidence: 70 })
    await makeArticle(prediction.id, { stance: -0.4, publishedDate: isoDate(daysAgo(1, now)) })
    oracleMock.mockResolvedValue(oracleResult(60) as never)

    await checkEvidenceSecondOpinion(now, { dryRun: true })

    expect(await prisma.evidenceSecondOpinionAlert.count()).toBe(0)
  })

  it('fires a case once, then suppresses it on the next run while the condition persists', async () => {
    const now = new Date()
    const user = await makeUser()
    const prediction = await makePrediction(user.id, { createdAt: now, confidence: 70 })
    await makeArticle(prediction.id, { stance: -0.4, publishedDate: isoDate(daysAgo(1, now)) })
    oracleMock.mockResolvedValue(oracleResult(60) as never)

    const first = await checkEvidenceSecondOpinion(now)
    expect(first.issues).toHaveLength(1)

    const second = await checkEvidenceSecondOpinion(now)
    expect(second.issues).toEqual([])
    expect(second.suppressed).toBe(1)
  })
})
