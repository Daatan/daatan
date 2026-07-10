import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    prediction: { findMany: vi.fn() },
    aiEstimateRun: { findFirst: vi.fn(), create: vi.fn() },
  },
}))

vi.mock('@/lib/llm/bedrock-prompts', () => ({
  getPromptTemplate: vi.fn(),
  fillPrompt: vi.fn((t: string, v: Record<string, string | number>) =>
    t.replace(/\{\{(\w+)\}\}/g, (m, k: string) => (k in v ? String(v[k]) : m)),
  ),
}))

vi.mock('@/lib/services/settings', () => ({ getOpenRouterKey: vi.fn() }))

// Keep the real PanelAuthError: ai-panel.ts branches on `instanceof`, and a stubbed
// class would make that check silently never match.
vi.mock('@/lib/llm/panel/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/llm/panel/client')>()),
  callPanelMember: vi.fn(),
  logMemberFailure: vi.fn(),
}))

import { prisma } from '@/lib/prisma'
import { getPromptTemplate } from '@/lib/llm/bedrock-prompts'
import { getOpenRouterKey } from '@/lib/services/settings'
import { callPanelMember, PanelAuthError } from '@/lib/llm/panel/client'
import {
  buildPanelPrompt,
  computeInputHash,
  daysRemaining,
  promptVersionOf,
  runPanelForPrediction,
  runPanelSweep,
  utcDay,
} from '@/lib/services/ai-panel'
import { PANEL_MEMBERS } from '@/lib/llm/panel/roster'

const findFirst = vi.mocked(prisma.aiEstimateRun.findFirst)
const createRun = vi.mocked(prisma.aiEstimateRun.create)
const findManyPredictions = vi.mocked(prisma.prediction.findMany)
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

  it('skips entirely when the input hash is unchanged', async () => {
    const version = promptVersionOf(TEMPLATE)
    findFirst.mockResolvedValue({ inputHash: computeInputHash(prediction, NOW, version) } as never)

    const result = await runPanelForPrediction(prediction, { now: NOW, apiKey: 'sk-test' })

    expect(result.status).toBe('skipped-unchanged')
    expect(callMember).not.toHaveBeenCalled()
    expect(createRun).not.toHaveBeenCalled()
  })

  it('records a null probability as an abstention, not a number', async () => {
    callMember.mockResolvedValue(ok(null))

    const result = await runPanelForPrediction(prediction, { now: NOW, apiKey: 'sk-test' })

    expect(result.status).toBe('written')
    expect(result.estimated).toBe(0)
    expect(result.abstained).toBe(PANEL_MEMBERS.length)

    const written = createRun.mock.calls[0][0].data as {
      estimates: { create: { probability: number | null; insufficientData: boolean }[] }
    }
    for (const estimate of written.estimates.create) {
      expect(estimate.probability).toBeNull()
      expect(estimate.insufficientData).toBe(true)
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
      estimates: { create: { model: string; probability: number | null }[] }
    }
    const failed = written.estimates.create.find((e) => e.model === first.model)
    expect(failed?.probability).toBeNull()
    // Every row still names exactly the model that produced it.
    expect(written.estimates.create).toHaveLength(PANEL_MEMBERS.length)
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
  it('is dormant, not broken, without an OpenRouter key', async () => {
    getKey.mockReturnValue('')

    const summary = await runPanelSweep({ now: NOW })

    expect(summary.dormant).toBe(true)
    expect(findManyPredictions).not.toHaveBeenCalled()
    expect(callMember).not.toHaveBeenCalled()
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

  // Regression: a dead OpenRouter key produced 57 forecasts × 5 members = 285
  // identical 401s, and the cron still answered 200 with "✅ Panel sweep OK".
  it('aborts the whole sweep on a rejected key instead of retrying it 285 times', async () => {
    findManyPredictions.mockResolvedValue([
      prediction,
      { ...prediction, id: 'pred-2' },
      { ...prediction, id: 'pred-3' },
    ] as never)
    callMember.mockRejectedValue(new PanelAuthError(401, 'User not found.'))

    const summary = await runPanelSweep({ now: NOW })

    expect(summary.unauthorized).toBe(true)
    expect(summary.considered).toBe(3)
    // Stopped at the first forecast — the other two were never attempted.
    expect(summary.written + summary.failed + summary.skipped).toBeLessThan(3)
    expect(createRun).not.toHaveBeenCalled()
  })

  it('stops calling the remaining members once one reports a bad key', async () => {
    findManyPredictions.mockResolvedValue([prediction] as never)
    callMember.mockRejectedValue(new PanelAuthError(401, 'User not found.'))

    await runPanelSweep({ now: NOW })

    // MEMBER_CONCURRENCY workers may each have one call in flight; none should retry.
    expect(callMember.mock.calls.length).toBeLessThanOrEqual(3)
    expect(callMember.mock.calls.length).toBeLessThan(PANEL_MEMBERS.length)
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

  it('reports dryRun: 0 when dormant, so the shape never varies', async () => {
    getKey.mockReturnValue('')

    const summary = await runPanelSweep({ now: NOW, dryRun: true })

    expect(summary).toMatchObject({ dormant: true, written: 0, dryRun: 0 })
  })
})
