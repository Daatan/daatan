import { vi } from 'vitest'

const { mockAuth } = vi.hoisted(() => ({
    mockAuth: vi.fn(),
}))

vi.mock('@/auth', () => ({
    auth: mockAuth,
}))

import { describe, it, expect, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '../route'

vi.mock('@/lib/prisma', () => ({
    prisma: {
        prediction: {
            findMany: vi.fn(),
            count: vi.fn(),
        },
    },
}))

vi.mock('@/lib/services/prediction-lifecycle', () => ({
    transitionExpiredPredictions: vi.fn().mockResolvedValue(0),
}))

vi.mock('@/lib/services/moderation', () => ({
    checkContent: vi.fn().mockResolvedValue({ isOffensive: false, reason: '' }),
}))

describe('/api/forecasts sort parameters', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    describe('GET sortOrder', () => {
        it('defaults to desc for newest sort', async () => {
            const { prisma } = await import('@/lib/prisma')
            vi.mocked(prisma.prediction.findMany).mockResolvedValue([])
            vi.mocked(prisma.prediction.count).mockResolvedValue(0)

            const request = new NextRequest('http://localhost/api/forecasts')
            await GET(request)

            const findManyCall = vi.mocked(prisma.prediction.findMany).mock.calls[0][0] as any
            expect(findManyCall.orderBy).toEqual({ createdAt: 'desc' })
        })

        it('uses explicit sortOrder for newest sort', async () => {
            const { prisma } = await import('@/lib/prisma')
            vi.mocked(prisma.prediction.findMany).mockResolvedValue([])
            vi.mocked(prisma.prediction.count).mockResolvedValue(0)

            const request = new NextRequest('http://localhost/api/forecasts?sortOrder=asc')
            await GET(request)

            const findManyCall = vi.mocked(prisma.prediction.findMany).mock.calls[0][0] as any
            expect(findManyCall.orderBy).toEqual({ createdAt: 'asc' })
        })

        it('uses explicit sortOrder for deadline sort', async () => {
            const { prisma } = await import('@/lib/prisma')
            vi.mocked(prisma.prediction.findMany).mockResolvedValue([])
            vi.mocked(prisma.prediction.count).mockResolvedValue(0)

            const request = new NextRequest('http://localhost/api/forecasts?sortBy=deadline&sortOrder=desc')
            await GET(request)

            const findManyCall = vi.mocked(prisma.prediction.findMany).mock.calls[0][0] as any
            expect(findManyCall.orderBy).toEqual({ resolveByDatetime: 'desc' })
        })

        it('uses updatedAt for updated sort (desc default)', async () => {
            const { prisma } = await import('@/lib/prisma')
            vi.mocked(prisma.prediction.findMany).mockResolvedValue([])
            vi.mocked(prisma.prediction.count).mockResolvedValue(0)

            const request = new NextRequest('http://localhost/api/forecasts?sortBy=updated')
            await GET(request)

            const findManyCall = vi.mocked(prisma.prediction.findMany).mock.calls[0][0] as any
            expect(findManyCall.orderBy).toEqual({ updatedAt: 'desc' })
        })

        it('uses explicit sortOrder for updated sort', async () => {
            const { prisma } = await import('@/lib/prisma')
            vi.mocked(prisma.prediction.findMany).mockResolvedValue([])
            vi.mocked(prisma.prediction.count).mockResolvedValue(0)

            const request = new NextRequest('http://localhost/api/forecasts?sortBy=updated&sortOrder=asc')
            await GET(request)

            const findManyCall = vi.mocked(prisma.prediction.findMany).mock.calls[0][0] as any
            expect(findManyCall.orderBy).toEqual({ updatedAt: 'asc' })
        })

        it('sorts by CU in memory (desc default)', async () => {
            const { prisma } = await import('@/lib/prisma')
            
            const mockForecasts = [
                { id: '1', claimText: 'Low CU', commitments: [{ cuCommitted: 10 }] },
                { id: '2', claimText: 'High CU', commitments: [{ cuCommitted: 100 }] },
            ]

            vi.mocked(prisma.prediction.findMany).mockResolvedValue(mockForecasts as any)
            vi.mocked(prisma.prediction.count).mockResolvedValue(2)

            const request = new NextRequest('http://localhost/api/forecasts?sortBy=cu')
            const response = await GET(request)
            const data = await response.json()

            expect(data.predictions[0].id).toBe('2') // High CU first (desc)
            expect(data.predictions[1].id).toBe('1')
        })

        it('sorts by CU in memory (asc explicit)', async () => {
            const { prisma } = await import('@/lib/prisma')
            
            const mockForecasts = [
                { id: '1', claimText: 'Low CU', commitments: [{ cuCommitted: 10 }] },
                { id: '2', claimText: 'High CU', commitments: [{ cuCommitted: 100 }] },
            ]

            vi.mocked(prisma.prediction.findMany).mockResolvedValue(mockForecasts as any)
            vi.mocked(prisma.prediction.count).mockResolvedValue(2)

            const request = new NextRequest('http://localhost/api/forecasts?sortBy=cu&sortOrder=asc')
            const response = await GET(request)
            const data = await response.json()

            expect(data.predictions[0].id).toBe('1') // Low CU first (asc)
            expect(data.predictions[1].id).toBe('2')
        })
    })
})
