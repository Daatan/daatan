import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/env', () => ({ env: { BOT_RUNNER_SECRET: 'test-secret' } }))
vi.mock('@/auth', () => ({ auth: vi.fn().mockResolvedValue(null) }))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    prediction: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
  },
}))

vi.mock('@/lib/llm', () => ({ llmService: { generateContent: vi.fn() } }))
vi.mock('@/lib/llm/bedrock-prompts', () => ({
  getPromptTemplate: vi.fn().mockResolvedValue('{{claimText}} {{resolveByDatetime}} {{currentDate}}'),
  fillPrompt: (t: string, v: Record<string, string>) =>
    t.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in v ? String(v[k]) : m)),
}))

import { prisma } from '@/lib/prisma'
import { llmService } from '@/lib/llm'
import { POST } from '../backfill-temporal/route'

const findMany = vi.mocked(prisma.prediction.findMany)
const update = vi.mocked(prisma.prediction.update)
const generateContent = vi.mocked(llmService.generateContent)

const CRON_SECRET_HEADERS = { 'x-cron-secret': 'test-secret', 'content-type': 'application/json' }

function req(body: unknown, headers: Record<string, string> = CRON_SECRET_HEADERS) {
  return new NextRequest('http://localhost/api/admin/forecasts/backfill-temporal', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

const candidate = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: 'pred-1',
  slug: 'pred-1-slug',
  claimText: 'X will happen by end of 2026',
  resolveByDatetime: new Date('2027-01-01'),
  outcomeType: 'BINARY',
  ...overrides,
})

const validRaw = {
  claim_deadline: '2026-12-31',
  direction: 'arrival',
  archetype: 'diffuse',
  tau_lead_days: 0,
  confidence: 0.9,
  notes: 'parsed from "by end of 2026"',
}

describe('POST /api/admin/forecasts/backfill-temporal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('401s without a cron secret or admin session', async () => {
    findMany.mockResolvedValue([])
    const res = await POST(req({ mode: 'dry-run' }, { 'content-type': 'application/json' }))
    expect(res.status).toBe(401)
  })

  it('dry-run classifies and returns a report without writing', async () => {
    findMany.mockResolvedValue([candidate()] as never)
    generateContent.mockResolvedValue({ text: JSON.stringify(validRaw) } as never)

    const res = await POST(req({ mode: 'dry-run' }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.mode).toBe('dry-run')
    expect(body.examined).toBe(1)
    expect(body.classified).toBe(1)
    expect(body.rows).toHaveLength(1)
    expect(body.rows[0].direction).toBe('arrival')
    expect(body.rows[0].wouldGlide).toBe(true)
    expect(update).not.toHaveBeenCalled()
  })

  it('apply mode persists via classifyAndStoreTemporal', async () => {
    findMany.mockResolvedValue([candidate()] as never)
    generateContent.mockResolvedValue({ text: JSON.stringify(validRaw) } as never)
    update.mockResolvedValue({} as never)

    const res = await POST(req({ mode: 'apply' }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.mode).toBe('apply')
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'pred-1' },
        data: expect.objectContaining({ claimDirection: 'ARRIVAL', claimArchetype: 'DIFFUSE' }),
      }),
    )
  })

  it('excludes already-classified rows by default (classifierVersion filter)', async () => {
    findMany.mockResolvedValue([])
    const res = await POST(req({ mode: 'dry-run' }))
    await res.json()

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ classifierVersion: null }),
      }),
    )
  })

  it('honors explicit ids over the classifierVersion filter', async () => {
    findMany.mockResolvedValue([])
    await POST(req({ mode: 'dry-run', ids: ['a', 'b'] }))

    const where = findMany.mock.calls[0][0]?.where as { id?: { in?: string[] }; classifierVersion?: unknown }
    expect(where.id).toEqual({ in: ['a', 'b'] })
    expect(where.classifierVersion).toBeUndefined()
  })

  it('sorts rows by confidence ascending', async () => {
    findMany.mockResolvedValue([
      candidate({ id: 'high-conf' }),
      candidate({ id: 'low-conf' }),
    ] as never)
    generateContent
      .mockResolvedValueOnce({ text: JSON.stringify({ ...validRaw, confidence: 0.95 }) } as never)
      .mockResolvedValueOnce({ text: JSON.stringify({ ...validRaw, confidence: 0.3 }) } as never)

    const res = await POST(req({ mode: 'dry-run' }))
    const body = await res.json()

    expect(body.rows[0].id).toBe('low-conf')
    expect(body.rows[1].id).toBe('high-conf')
  })

  it('is idempotent: re-applying with force=false on an already-versioned row is excluded by the query', async () => {
    // The route's own filter (classifierVersion: null) is what makes re-apply
    // idempotent — verify the filter is applied and not bypassed by default.
    findMany.mockResolvedValue([])
    await POST(req({ mode: 'apply' }))
    const where = findMany.mock.calls[0][0]?.where as { classifierVersion?: unknown; force?: unknown }
    expect(where.classifierVersion).toBeNull()
  })

  it('bypasses the classifierVersion filter when force is true', async () => {
    findMany.mockResolvedValue([])
    await POST(req({ mode: 'apply', force: true }))
    const where = findMany.mock.calls[0][0]?.where as Record<string, unknown>
    expect(where.classifierVersion).toBeUndefined()
  })

  it('rejects a missing/invalid mode', async () => {
    const res = await POST(req({}))
    expect(res.status).toBe(500)
  })
})
