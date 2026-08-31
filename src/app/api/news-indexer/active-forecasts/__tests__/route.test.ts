/**
 * @jest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/env', () => ({ env: { NEWS_INDEXER_SECRET: 'test-secret' } }))

vi.mock('@/lib/prisma', () => ({
  prisma: { prediction: { findMany: vi.fn() } },
}))

vi.mock('@/lib/api-error', () => ({
  apiError: (msg: string, status: number) =>
    new Response(JSON.stringify({ error: msg }), { status }),
}))

import { GET } from '../route'
import { prisma } from '@/lib/prisma'

function get(secret: string | null) {
  return new NextRequest('http://localhost/api/news-indexer/active-forecasts', {
    headers: secret === null ? {} : { 'x-news-indexer-secret': secret },
  })
}

describe('GET /api/news-indexer/active-forecasts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects a missing or wrong secret', async () => {
    const res1 = await GET(get(null))
    expect(res1.status).toBe(401)

    const res2 = await GET(get('wrong-secret'))
    expect(res2.status).toBe(401)

    expect(prisma.prediction.findMany).not.toHaveBeenCalled()
  })

  it('queries only ACTIVE, public predictions — daatan#1603', async () => {
    vi.mocked(prisma.prediction.findMany).mockResolvedValue([])

    await GET(get('test-secret'))

    expect(prisma.prediction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'ACTIVE', isPublic: true },
      }),
    )
  })

  it('shapes the response from the query result', async () => {
    vi.mocked(prisma.prediction.findMany).mockResolvedValue([
      {
        id: 'pred-1',
        claimText: 'Will X happen?',
        createdAt: new Date('2026-08-04T09:30:00.000Z'),
        claimArchetype: 'threshold',
        translations: [{ language: 'he', translatedText: 'האם X יקרה?' }],
      },
    ] as never)

    const res = await GET(get('test-secret'))
    const body = await res.json()

    expect(body).toEqual([
      {
        id: 'pred-1',
        question: 'Will X happen?',
        createdAt: '2026-08-04T09:30:00.000Z',
        claimArchetype: 'threshold',
        translations: [{ language: 'he', text: 'האם X יקרה?' }],
      },
    ])
  })

  it('carries the evidence-window inputs — news-indexer#394', async () => {
    vi.mocked(prisma.prediction.findMany).mockResolvedValue([
      {
        id: 'pred-2',
        claimText: 'Will Y happen?',
        createdAt: new Date('2026-08-04T09:30:00.000Z'),
        claimArchetype: null,
        translations: [],
      },
    ] as never)

    await GET(get('test-secret'))

    expect(prisma.prediction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({ createdAt: true, claimArchetype: true }),
      }),
    )
  })
})
