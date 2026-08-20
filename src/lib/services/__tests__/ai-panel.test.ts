import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    prediction: { findMany: vi.fn() },
    aiEstimateRun: { findFirst: vi.fn(), create: vi.fn() },
    aiEstimate: { createMany: vi.fn() },
  },
}))

vi.mock('@/lib/llm/bedrock-prompts', () => ({
  getPromptTemplate: vi.fn(),
  fillPrompt: vi.fn((t: string, v: Record<string, string | number>) =>
    t.replace(/\{\{(\w+)\}\}/g, (m, k: string) => (k in v ? String(v[k]) : m)),
  ),
}))

vi.mock('@/lib/services/settings', () => ({ getOpenRouterKey: vi.fn() }))

// The sweep refreshes the SSM secret cache before reading the key; never hit AWS in unit tests.
vi.mock('@/lib/aws/secrets', () => ({ warmAwsSecrets: vi.fn().mockResolvedValue(undefined) }))

// Keep the real PanelAuthError: ai-panel.ts branches on `instanceof`, and a stubbed
// class would make that check silently never match.
vi.mock('@/lib/llm/panel/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/llm/panel/client')>()),
  callPanelMember: vi.fn(),
  logMemberFailure: vi.fn(),
}))

// The 402 recorder writes through Prisma; here only the hook-up matters (daatan#1504).
vi.mock('@/lib/services/panel-failures', () => ({ recordPanelPaymentFailure: vi.fn() }))

// Retrieval is network; the pure helpers (fingerprint, articles block) stay real so
// hashes and prompts in these tests match production byte-for-byte.
vi.mock('@/lib/llm/panel/context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/llm/panel/context')>()),
  retrievePanelContext: vi.fn(),
  groundedPanelTag: vi.fn(() => null),
}))

import { prisma } from '@/lib/prisma'
import { getPromptTemplate } from '@/lib/llm/bedrock-prompts'
import { getOpenRouterKey } from '@/lib/services/settings'
import { callPanelMember, PanelAuthError, PanelPaymentError } from '@/lib/llm/panel/client'
import { recordPanelPaymentFailure } from '@/lib/services/panel-failures'
import {
  buildPanelPrompt,
  computeInputHash,
  daysRemaining,
  isDormant,
  promptVersionOf,
  runPanelForPrediction,
  runPanelSweep,
  utcDay,
} from '@/lib/services/ai-panel'
import { PANEL_MEMBERS, GROUNDED_PANEL_MEMBERS } from '@/lib/llm/panel/roster'
import {
  contextFingerprint,
  groundedPanelTag,
  retrievePanelContext,
  type PanelContextSnapshot,
} from '@/lib/llm/panel/context'

const findFirst = vi.mocked(prisma.aiEstimateRun.findFirst)
const createRun = vi.mocked(prisma.aiEstimateRun.create)
const appendEstimates = vi.mocked(prisma.aiEstimate.createMany)
const findManyPredictions = vi.mocked(prisma.prediction.findMany)
const retrieve = vi.mocked(retrievePanelContext)
const groundedTag = vi.mocked(groundedPanelTag)
const getTemplate = vi.mocked(getPromptTemplate)
const getKey = vi.mocked(getOpenRouterKey)
const callMember = vi.mocked(callPanelMember)

const TEMPLATE = 'Claim: {{claimText}}\nToday: {{todayDate}}\nDays: {{daysRemaining}}'
const NOW = new Date('2026-07-09T12:00:00.000Z')

const prediction = {
  id: 'pred-1',
  claimText: 'Bitcoin reaches $100k',
  resolutionRules: null,
  resolveByDatetime: new Date('2026-08-08T00:00:00.000Z'),
}

function ok(probability: number | null) {
  return { probability, promptTokens: 250, completionTokens: 12, latencyMs: 400 }
}

/** Today's run as the date-gate would find it, covering the given members. */
function todaysRun(members: readonly (typeof PANEL_MEMBERS)[number][] = PANEL_MEMBERS) {
  return {
    id: 'run-1',
    inputHash: computeInputHash(prediction, NOW, promptVersionOf(TEMPLATE)),
    estimates: members.map((m) => ({ model: m.model, mode: m.mode })),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  getTemplate.mockResolvedValue(TEMPLATE)
  getKey.mockReturnValue('sk-test')
  findFirst.mockResolvedValue(null)
  createRun.mockResolvedValue({ id: 'run-1' } as never)
  callMember.mockResolvedValue(ok(42))
})

describe('date helpers', () => {
  it('uses the UTC calendar day, not local time', () => {
    expect(utcDay(new Date('2026-07-09T23:59:59.000Z'))).toBe('2026-07-09')
  })

  it('never reports negative days remaining', () => {
    expect(daysRemaining(new Date('2026-07-01T00:00:00Z'), NOW)).toBe(0)
    expect(daysRemaining(new Date('2026-07-19T12:00:00Z'), NOW)).toBe(10)
  })
})

describe('computeInputHash', () => {
  const version = promptVersionOf(TEMPLATE)

  it('is stable across the same UTC day', () => {
    const a = computeInputHash(prediction, new Date('2026-07-09T00:01:00Z'), version)
    const b = computeInputHash(prediction, new Date('2026-07-09T23:58:00Z'), version)
    expect(a).toBe(b)
  })

  it('changes when the day rolls over — the only input that ever moves', () => {
    const a = computeInputHash(prediction, new Date('2026-07-09T12:00:00Z'), version)
    const b = computeInputHash(prediction, new Date('2026-07-10T12:00:00Z'), version)
    expect(a).not.toBe(b)
  })

  it('changes when the prompt version changes, so Brier stays comparable', () => {
    const a = computeInputHash(prediction, NOW, version)
    const b = computeInputHash(prediction, NOW, promptVersionOf(TEMPLATE + ' tweak'))
    expect(a).not.toBe(b)
  })

  it('changes when the claim is edited', () => {
    const a = computeInputHash(prediction, NOW, version)
    const b = computeInputHash({ ...prediction, claimText: 'Something else' }, NOW, version)
    expect(a).not.toBe(b)
  })

  it('changes when a member is added or dropped', () => {
    const a = computeInputHash(prediction, NOW, version, PANEL_MEMBERS)
    const b = computeInputHash(prediction, NOW, version, PANEL_MEMBERS.slice(1))
    expect(a).not.toBe(b)
  })
})

describe('buildPanelPrompt', () => {
  it('substitutes the date and the remaining window', () => {
    const prompt = buildPanelPrompt(TEMPLATE, prediction, NOW)
    expect(prompt).toContain('Bitcoin reaches $100k')
    expect(prompt).toContain('Today: 2026-07-09')
    expect(prompt).toContain('Days: 30')
  })

  it('renders a placeholder when the forecast has no resolution rules', () => {
    const prompt = buildPanelPrompt('Rules: {{resolutionRules}}', prediction, NOW)
    expect(prompt).toBe('Rules: (none specified)')
  })

  it('never injects article text — the panel is ungrounded by construction', () => {
    const prompt = buildPanelPrompt(TEMPLATE, prediction, NOW)
    expect(prompt).not.toContain('{{articlesText}}')
    expect(prompt).not.toContain('Related News')
  })
})

describe('runPanelForPrediction', () => {
  it('calls every member once and writes one estimate per member', async () => {
    const result = await runPanelForPrediction(prediction, { now: NOW, apiKey: 'sk-test' })

    expect(callMember).toHaveBeenCalledTimes(PANEL_MEMBERS.length)
    expect(result.status).toBe('written')
    expect(result.estimated).toBe(PANEL_MEMBERS.length)

    const written = createRun.mock.calls[0][0].data as {
      estimates: { create: { model: string; probability: number | null }[] }
    }
    expect(written.estimates.create).toHaveLength(PANEL_MEMBERS.length)
    expect(written.estimates.create.map((e) => e.model).sort()).toEqual(
      PANEL_MEMBERS.map((m) => m.model).sort(),
    )
  })

  it('skips entirely when the input hash is unchanged and every member is recorded', async () => {
    findFirst.mockResolvedValue(todaysRun() as never)

    const result = await runPanelForPrediction(prediction, { now: NOW, apiKey: 'sk-test' })

    expect(result.status).toBe('skipped-unchanged')
    expect(callMember).not.toHaveBeenCalled()
    expect(createRun).not.toHaveBeenCalled()
    expect(appendEstimates).not.toHaveBeenCalled()
  })

  // The 2026-07-10 shape: a dead key latched mid-sweep, so the day's run holds only the
  // Bedrock member. Once the key works again, the same-day sweep must fill the hole —
  // temperature 0 + a date-only prompt make the appended number exactly what it would
  // have been at the run's original instant.
  it('completes a partial run: asks only the missing members and appends to the day\'s run', async () => {
    const bedrock = PANEL_MEMBERS.filter((m) => m.route === 'bedrock')
    const openrouter = PANEL_MEMBERS.filter((m) => m.route === 'openrouter')
    findFirst.mockResolvedValue(todaysRun(bedrock) as never)

    const result = await runPanelForPrediction(prediction, { now: NOW, apiKey: 'sk-test' })

    expect(result.status).toBe('completed-partial')
    expect(result.estimated).toBe(openrouter.length)

    // Recorded members are never re-asked: one call per member per forecast per day stands.
    const asked = callMember.mock.calls.map(([m]) => m.model).sort()
    expect(asked).toEqual(openrouter.map((m) => m.model).sort())

    expect(createRun).not.toHaveBeenCalled()
    const append = appendEstimates.mock.calls[0][0] as {
      data: { runId: string; model: string; promptVersion: string }[]
      skipDuplicates: boolean
    }
    expect(append.skipDuplicates).toBe(true)
    expect(append.data).toHaveLength(openrouter.length)
    for (const row of append.data) {
      expect(row.runId).toBe('run-1')
      expect(row.promptVersion).toBe(promptVersionOf(TEMPLATE))
    }
  })

  it('stays quietly skipped when the missing members still cannot be authenticated', async () => {
    findFirst.mockResolvedValue(todaysRun(PANEL_MEMBERS.filter((m) => m.route === 'bedrock')) as never)

    // No key: deliberate Bedrock-only mode. The second tick must not report failures.
    const result = await runPanelForPrediction(prediction, { now: NOW, apiKey: '' })

    expect(result.status).toBe('skipped-unchanged')
    expect(callMember).not.toHaveBeenCalled()
    expect(appendEstimates).not.toHaveBeenCalled()
  })

  it('appends nothing when every missing member\'s call fails, so the next tick retries', async () => {
    findFirst.mockResolvedValue(todaysRun(PANEL_MEMBERS.filter((m) => m.route === 'bedrock')) as never)
    callMember.mockRejectedValue(new Error('upstream 500'))

    const result = await runPanelForPrediction(prediction, { now: NOW, apiKey: 'sk-test' })

    expect(result.status).toBe('failed')
    expect(appendEstimates).not.toHaveBeenCalled()
  })

  it('a dry run over a partial run calls nothing and appends nothing', async () => {
    findFirst.mockResolvedValue(todaysRun(PANEL_MEMBERS.filter((m) => m.route === 'bedrock')) as never)

    const result = await runPanelForPrediction(prediction, { now: NOW, apiKey: 'sk-test', dryRun: true })

    expect(result.status).toBe('dry-run')
    expect(callMember).not.toHaveBeenCalled()
    expect(appendEstimates).not.toHaveBeenCalled()
  })

  it('records a null probability as an abstention, not a number', async () => {
    callMember.mockResolvedValue(ok(null))

    const result = await runPanelForPrediction(prediction, { now: NOW, apiKey: 'sk-test' })

    expect(result.status).toBe('written')
    expect(result.estimated).toBe(0)
    expect(result.abstained).toBe(PANEL_MEMBERS.length)

    const written = createRun.mock.calls[0][0].data as {
      estimates: { create: { probability: number | null; insufficientData: boolean; callFailed: boolean }[] }
    }
    for (const estimate of written.estimates.create) {
      expect(estimate.probability).toBeNull()
      expect(estimate.insufficientData).toBe(true)
      // The model answered "too vague" — a decline, not a transport failure.
      expect(estimate.callFailed).toBe(false)
    }
  })

  it('records a failed member as an abstention and never substitutes another model', async () => {
    const [first, ...rest] = PANEL_MEMBERS
    callMember.mockImplementation(async (member) => {
      if (member.model === first.model) throw new Error('provider exploded')
      return ok(60)
    })

    const result = await runPanelForPrediction(prediction, { now: NOW, apiKey: 'sk-test' })

    expect(result.status).toBe('written')
    expect(result.estimated).toBe(rest.length)

    const written = createRun.mock.calls[0][0].data as {
      estimates: { create: { model: string; probability: number | null; callFailed: boolean }[] }
    }
    const failed = written.estimates.create.find((e) => e.model === first.model)
    expect(failed?.probability).toBeNull()
    // Persisted as a CALL failure — distinguishable from a deliberate "too vague" null,
    // so provider reliability never blends into model calibration stats.
    expect(failed?.callFailed).toBe(true)
    for (const e of written.estimates.create.filter((e) => e.model !== first.model)) {
      expect(e.callFailed).toBe(false)
    }
    // Every row still names exactly the model that produced it.
    expect(written.estimates.create).toHaveLength(PANEL_MEMBERS.length)
  })

  it('records a 402 for the evidence-health digest, while the member still just abstains', async () => {
    const [first, ...rest] = PANEL_MEMBERS
    callMember.mockImplementation(async (member) => {
      if (member.model === first.model) throw new PanelPaymentError('Insufficient credits')
      return ok(60)
    })

    const result = await runPanelForPrediction(prediction, { now: NOW, apiKey: 'sk-test' })

    // The burst is written down for the digest (daatan#1504)…
    expect(recordPanelPaymentFailure).toHaveBeenCalledWith(first.model)
    // …but sweep behaviour is unchanged: an abstention, no latch, siblings unaffected.
    expect(result.status).toBe('written')
    expect(result.estimated).toBe(rest.length)
  })

  it('a non-402 failure records nothing — the counter only ever means credit exhaustion', async () => {
    const [first] = PANEL_MEMBERS
    callMember.mockImplementation(async (member) => {
      if (member.model === first.model) throw new Error('provider exploded')
      return ok(60)
    })

    await runPanelForPrediction(prediction, { now: NOW, apiKey: 'sk-test' })

    expect(recordPanelPaymentFailure).not.toHaveBeenCalled()
  })

  it('writes nothing when every member fails, so the next tick retries', async () => {
    callMember.mockRejectedValue(new Error('bad api key'))

    const result = await runPanelForPrediction(prediction, { now: NOW, apiKey: 'sk-test' })

    expect(result.status).toBe('failed')
    expect(createRun).not.toHaveBeenCalled()
  })

  it('is idempotent: a concurrent identical run is a no-op, not an error', async () => {
    const conflict = Object.assign(new Error('unique'), {
      code: 'P2002',
      clientVersion: '7',
      name: 'PrismaClientKnownRequestError',
    })
    Object.setPrototypeOf(conflict, (await import('@prisma/client')).Prisma.PrismaClientKnownRequestError.prototype)
    createRun.mockRejectedValue(conflict)

    const result = await runPanelForPrediction(prediction, { now: NOW, apiKey: 'sk-test' })
    expect(result.status).toBe('skipped-duplicate')
  })

  it('calls no model on a dry run', async () => {
    const result = await runPanelForPrediction(prediction, {
      now: NOW,
      apiKey: 'sk-test',
      dryRun: true,
    })

    expect(result.status).toBe('dry-run')
    expect(callMember).not.toHaveBeenCalled()
    expect(createRun).not.toHaveBeenCalled()
  })
})

describe('runPanelSweep', () => {
  // The whole reason the Bedrock member exists: no OpenRouter key must NOT stop the panel.
  it('runs Bedrock members only when no OpenRouter key is configured', async () => {
    getKey.mockReturnValue('')
    findManyPredictions.mockResolvedValue([prediction] as never)

    const summary = await runPanelSweep({ now: NOW })

    expect(summary.dormant).toBeUndefined()
    expect(summary.written).toBe(1)

    const called = callMember.mock.calls.map(([m]) => m.route)
    expect(called).toEqual(['bedrock'])
    expect(called).not.toContain('openrouter')
  })

  it('is dormant only when nothing at all can authenticate', () => {
    const openRouterOnly = [{ model: 'a', mode: 'ungrounded', route: 'openrouter' }] as const
    const withBedrock = [{ model: 'b', mode: 'ungrounded', route: 'bedrock' }] as const

    expect(isDormant('', openRouterOnly)).toBe(true)
    expect(isDormant('', withBedrock)).toBe(false) // IAM role, no key needed
    expect(isDormant('sk-test', openRouterOnly)).toBe(false)
  })

  it('selects only open BINARY forecasts that have not passed their deadline', async () => {
    findManyPredictions.mockResolvedValue([])

    await runPanelSweep({ now: NOW })

    const where = findManyPredictions.mock.calls[0][0]?.where
    expect(where).toMatchObject({
      status: 'ACTIVE',
      outcomeType: 'BINARY',
      resolveByDatetime: { gt: NOW },
    })
  })

  it('does not gate on having a commitment — runs must lead commits for matched-time Brier', async () => {
    findManyPredictions.mockResolvedValue([])

    await runPanelSweep({ now: NOW })

    expect(JSON.stringify(findManyPredictions.mock.calls[0][0]?.where)).not.toContain('commitments')
  })

  it('resolves the prompt template once per sweep, not once per forecast', async () => {
    findManyPredictions.mockResolvedValue([
      prediction,
      { ...prediction, id: 'pred-2' },
      { ...prediction, id: 'pred-3' },
    ] as never)

    await runPanelSweep({ now: NOW })

    // Per-forecast fetches would hammer SSM (the fallback path does not cache), and a
    // mid-sweep prompt edit would split one member across two promptVersions.
    expect(getTemplate).toHaveBeenCalledTimes(1)
  })

  // Regression: a dead OpenRouter key produced 57 forecasts × 5 members = 285 identical
  // 401s, and the cron still answered 200 with "✅ Panel sweep OK". It now latches after
  // the first rejection — but only for the OpenRouter members.
  it('a rejected key disables OpenRouter members without silencing Bedrock ones', async () => {
    findManyPredictions.mockResolvedValue([
      prediction,
      { ...prediction, id: 'pred-2' },
      { ...prediction, id: 'pred-3' },
    ] as never)
    callMember.mockImplementation(async (m) => {
      if (m.route === 'openrouter') throw new PanelAuthError(401, 'User not found.')
      return ok(44)
    })

    const summary = await runPanelSweep({ now: NOW })

    // Reported as an incident even though the sweep produced data.
    expect(summary.unauthorized).toBe(true)
    // The Bedrock member carried all three forecasts.
    expect(summary.written).toBe(3)

    const openRouterCalls = callMember.mock.calls.filter(([m]) => m.route === 'openrouter')
    const bedrockCalls = callMember.mock.calls.filter(([m]) => m.route === 'bedrock')
    // Latched: at most one 401 per concurrent worker, not 4 members × 3 forecasts = 12.
    expect(openRouterCalls.length).toBeLessThanOrEqual(3)
    expect(bedrockCalls.length).toBe(3)
  })

  it('writes nothing when every route is unauthenticated', async () => {
    findManyPredictions.mockResolvedValue([prediction] as never)
    callMember.mockImplementation(async (m) => {
      if (m.route === 'openrouter') throw new PanelAuthError(401, 'User not found.')
      throw new Error('AccessDeniedException: bedrock:InvokeModel') // terraform not applied
    })

    const summary = await runPanelSweep({ now: NOW })

    expect(summary.unauthorized).toBe(true)
    expect(summary.written).toBe(0)
    expect(summary.failed).toBe(1)
    expect(createRun).not.toHaveBeenCalled()
  })

  // An unapplied IAM grant must not take the OpenRouter members down with it.
  it('a Bedrock AccessDenied is a per-member abstention, not a sweep-wide failure', async () => {
    findManyPredictions.mockResolvedValue([prediction] as never)
    callMember.mockImplementation(async (m) => {
      if (m.route === 'bedrock') throw new Error('AccessDeniedException')
      return ok(55)
    })

    const summary = await runPanelSweep({ now: NOW })

    expect(summary.unauthorized).toBeUndefined()
    expect(summary.written).toBe(1)

    const written = createRun.mock.calls[0][0].data as {
      estimates: { create: { model: string; probability: number | null }[] }
    }
    // The Bedrock member still occupies a row — as an abstention, with no number.
    const bedrockRow = written.estimates.create.find((e) => e.model.startsWith('qwen.'))
    expect(bedrockRow?.probability).toBeNull()
    expect(written.estimates.create).toHaveLength(PANEL_MEMBERS.length)
  })

  it('a non-auth failure is still per-forecast, not fatal to the sweep', async () => {
    findManyPredictions.mockResolvedValue([prediction, { ...prediction, id: 'pred-2' }] as never)
    callMember.mockRejectedValue(new Error('upstream 500'))

    const summary = await runPanelSweep({ now: NOW })

    expect(summary.unauthorized).toBeUndefined()
    expect(summary.failed).toBe(2) // both attempted
  })

  it('one failing forecast does not abort the sweep', async () => {
    findManyPredictions.mockResolvedValue([prediction, { ...prediction, id: 'pred-2' }] as never)
    findFirst.mockRejectedValueOnce(new Error('db blip'))

    const summary = await runPanelSweep({ now: NOW })

    expect(summary.considered).toBe(2)
    expect(summary.failed).toBe(1)
    expect(summary.written).toBe(1)
  })

  it('a dry run reports zero written and counts dryRun instead', async () => {
    findManyPredictions.mockResolvedValue([
      prediction,
      { ...prediction, id: 'pred-2' },
    ] as never)

    const summary = await runPanelSweep({ now: NOW, dryRun: true })

    // The bug this replaces reported "written: 2" for a run that persisted nothing.
    expect(summary.written).toBe(0)
    expect(summary.dryRun).toBe(2)
    expect(summary.considered).toBe(2)
    expect(createRun).not.toHaveBeenCalled()
    expect(callMember).not.toHaveBeenCalled()
  })

  it('a real sweep reports writes, and no dry runs', async () => {
    findManyPredictions.mockResolvedValue([
      prediction,
      { ...prediction, id: 'pred-2' },
    ] as never)

    const summary = await runPanelSweep({ now: NOW })

    expect(summary.written).toBe(2)
    expect(summary.dryRun).toBe(0)
  })

  it('counts a completed partial run separately from fresh writes', async () => {
    findManyPredictions.mockResolvedValue([prediction] as never)
    findFirst.mockResolvedValue(todaysRun(PANEL_MEMBERS.filter((m) => m.route === 'bedrock')) as never)

    const summary = await runPanelSweep({ now: NOW })

    expect(summary.completedPartial).toBe(1)
    expect(summary.written).toBe(0)
    expect(summary.failed).toBe(0)
  })

  it('a dry run without a key still calls no model and writes nothing', async () => {
    getKey.mockReturnValue('')
    findManyPredictions.mockResolvedValue([prediction] as never)

    const summary = await runPanelSweep({ now: NOW, dryRun: true })

    // Not dormant (a Bedrock member exists), but dryRun short-circuits before any call.
    expect(summary).toMatchObject({ written: 0, dryRun: 1 })
    expect(callMember).not.toHaveBeenCalled()
    expect(createRun).not.toHaveBeenCalled()
  })
})

describe('grounded-indexer (docs/LASSO.md §9a)', () => {
  const GROUNDED_TEMPLATE = TEMPLATE + '\nArticles:\n{{articlesBlock}}'
  const FULL_ROSTER = [...PANEL_MEMBERS, ...GROUNDED_PANEL_MEMBERS]
  const SNAPSHOT: PanelContextSnapshot = {
    query: prediction.claimText,
    retrievedAt: NOW.toISOString(),
    articles: [
      {
        title: 'Dissolution vote set',
        url: 'https://news.example/a1',
        snippet: 'Vote due Wednesday.',
        source: 'ynet',
        publishedDate: '2026-07-08',
      },
    ],
  }
  const grounded = { ...prediction, grounded: true }

  function groundedHashOf(snap: PanelContextSnapshot): string {
    return computeInputHash(prediction, NOW, promptVersionOf(TEMPLATE), FULL_ROSTER, {
      promptVersion: promptVersionOf(GROUNDED_TEMPLATE),
      contextFingerprint: contextFingerprint(snap),
    })
  }

  beforeEach(() => {
    getTemplate.mockImplementation(async (name) =>
      name === 'panel-estimate-grounded' ? GROUNDED_TEMPLATE : TEMPLATE,
    )
    // clearAllMocks clears calls, not return values — reset the default explicitly so
    // one test's configured tag can't leak into the next.
    groundedTag.mockReturnValue(null)
  })

  it('a fresh grounded run retrieves once, feeds only the twins articles, and freezes the snapshot', async () => {
    retrieve.mockResolvedValue(SNAPSHOT)

    const result = await runPanelForPrediction(grounded, { now: NOW, apiKey: 'sk-test' })

    expect(result.status).toBe('written')
    expect(retrieve).toHaveBeenCalledTimes(1)
    expect(callMember).toHaveBeenCalledTimes(FULL_ROSTER.length)

    for (const [member, prompt] of callMember.mock.calls) {
      if (member.mode === 'grounded-indexer') expect(prompt).toContain('Dissolution vote set')
      else expect(prompt).not.toContain('Dissolution vote set')
    }

    const data = createRun.mock.calls[0][0].data as {
      inputHash: string
      contextSnapshot?: PanelContextSnapshot
      estimates: { create: { model: string; mode: string; promptVersion: string }[] }
    }
    expect(data.inputHash).toBe(groundedHashOf(SNAPSHOT))
    expect(data.contextSnapshot).toEqual(SNAPSHOT)
    expect(data.estimates.create).toHaveLength(FULL_ROSTER.length)
    for (const e of data.estimates.create) {
      expect(e.promptVersion).toBe(
        e.mode === 'grounded-indexer' ? promptVersionOf(GROUNDED_TEMPLATE) : promptVersionOf(TEMPLATE),
      )
    }
  })

  it('the completion pass re-asks against the FROZEN snapshot — no fresh retrieval', async () => {
    findFirst.mockResolvedValue({
      id: 'run-1',
      inputHash: groundedHashOf(SNAPSHOT),
      contextSnapshot: SNAPSHOT,
      estimates: PANEL_MEMBERS.map((m) => ({ model: m.model, mode: m.mode })),
    } as never)

    const result = await runPanelForPrediction(grounded, { now: NOW, apiKey: 'sk-test' })

    expect(result.status).toBe('completed-partial')
    expect(retrieve).not.toHaveBeenCalled()

    const asked = callMember.mock.calls.map(([m]) => `${m.model}:${m.mode}`).sort()
    expect(asked).toEqual(GROUNDED_PANEL_MEMBERS.map((m) => `${m.model}:${m.mode}`).sort())
    for (const [, prompt] of callMember.mock.calls) expect(prompt).toContain('Dissolution vote set')

    const append = appendEstimates.mock.calls[0][0] as { data: { promptVersion: string }[] }
    for (const row of append.data) expect(row.promptVersion).toBe(promptVersionOf(GROUNDED_TEMPLATE))
  })

  it('retrieval failure degrades the tick to ungrounded-only, self-healing on recovery', async () => {
    retrieve.mockResolvedValue(null)

    const result = await runPanelForPrediction(grounded, { now: NOW, apiKey: 'sk-test' })

    expect(result.status).toBe('written')
    expect(callMember).toHaveBeenCalledTimes(PANEL_MEMBERS.length)

    const data = createRun.mock.calls[0][0].data as { inputHash: string; contextSnapshot?: unknown }
    expect(data.contextSnapshot).toBeUndefined()
    // The pre-grounding hash: a recovered retrieval later today computes a different
    // one, so that tick starts a fresh full-roster run instead of being gated out.
    expect(data.inputHash).toBe(computeInputHash(prediction, NOW, promptVersionOf(TEMPLATE)))
  })

  it('an empty index result still grounds: the twins run, told there is no matching news', async () => {
    const empty: PanelContextSnapshot = { ...SNAPSHOT, articles: [] }
    retrieve.mockResolvedValue(empty)

    await runPanelForPrediction(grounded, { now: NOW, apiKey: 'sk-test' })

    const twins = callMember.mock.calls.filter(([m]) => m.mode === 'grounded-indexer')
    expect(twins).toHaveLength(GROUNDED_PANEL_MEMBERS.length)
    for (const [, prompt] of twins) expect(prompt).toContain('no matching articles')

    const data = createRun.mock.calls[0][0].data as { contextSnapshot?: PanelContextSnapshot }
    expect(data.contextSnapshot).toEqual(empty)
  })

  it('the sweep grounds only the forecasts carrying the configured tag', async () => {
    groundedTag.mockReturnValue('israeli-elections-2026')
    retrieve.mockResolvedValue(SNAPSHOT)
    const unscoped = { ...prediction, id: 'pred-2' }
    findManyPredictions
      .mockResolvedValueOnce([{ id: prediction.id }] as never) // tag-scoped ids
      .mockResolvedValueOnce([prediction, unscoped] as never) // the sweep set

    const summary = await runPanelSweep({ now: NOW })

    expect(summary.written).toBe(2)
    // Full roster for the scoped forecast, plain roster for the other.
    expect(callMember).toHaveBeenCalledTimes(FULL_ROSTER.length + PANEL_MEMBERS.length)
    expect(retrieve).toHaveBeenCalledTimes(1)
    expect(findManyPredictions.mock.calls[0][0]?.where?.tags).toEqual({
      some: { slug: 'israeli-elections-2026' },
    })
  })

  it('the sweep never queries tags or the grounded template when grounding is unconfigured', async () => {
    findManyPredictions.mockResolvedValue([prediction] as never)

    await runPanelSweep({ now: NOW })

    expect(findManyPredictions).toHaveBeenCalledTimes(1)
    expect(getTemplate).toHaveBeenCalledWith('panel-estimate')
    expect(getTemplate).not.toHaveBeenCalledWith('panel-estimate-grounded')
    expect(retrieve).not.toHaveBeenCalled()
  })
})
