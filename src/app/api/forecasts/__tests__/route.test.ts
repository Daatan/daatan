import { vi } from 'vitest'

const { mockAuth, mockCheckContent, mockTranslate, mockNormalize } = vi.hoisted(() => ({
    mockAuth: vi.fn(),
    mockCheckContent: vi.fn().mockResolvedValue({ isOffensive: false, reason: '' }),
    mockTranslate: vi.fn().mockResolvedValue(undefined),
    // Mirror the real fast-path: pure-English input is returned unchanged.
    mockNormalize: vi.fn(async (f: { claimText: string; detailsText?: string | null; resolutionRules?: string | null }) => ({
        language: 'en',
        isEnglish: true,
        english: { claimText: f.claimText, detailsText: f.detailsText ?? null, resolutionRules: f.resolutionRules ?? null },
        original: { claimText: f.claimText, detailsText: f.detailsText ?? null, resolutionRules: f.resolutionRules ?? null },
    })),
}))

vi.mock('@/auth', () => ({
    auth: mockAuth,
}))

vi.mock('@/lib/services/moderation', () => ({
    checkContent: mockCheckContent,
}))

vi.mock('@/lib/services/translation', () => ({
    translatePredictionToAllLocales: mockTranslate,
    normalizeForecastToEnglish: mockNormalize,
    sourceHash: (s: string) => `hash-${s.length}`,
    TRANSLATABLE_FIELDS: ['claimText', 'detailsText', 'resolutionRules'],
}))

vi.mock('@/lib/services/fuzzy-search', () => ({
    findFuzzyMatches: vi.fn().mockResolvedValue({ predictionIds: [], tagNames: [] }),
}))

import { describe, it, expect, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, POST } from '../route'
import { resetRateLimitStore } from '@/lib/rate-limit'

vi.mock('@/lib/prisma', () => ({
    prisma: {
        prediction: {
            findMany: vi.fn(),
            create: vi.fn(),
            count: vi.fn(),
            findUnique: vi.fn(),
            updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
        commitment: {
            groupBy: vi.fn().mockResolvedValue([]),
            findMany: vi.fn().mockResolvedValue([]),
        },
        user: {
            findUnique: vi.fn(),
        },
        newsAnchor: {
            upsert: vi.fn(),
        }
    },
}))

describe('/api/forecasts', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        resetRateLimitStore()
        // Ensure mockCheckContent always returns pass by default
        mockCheckContent.mockResolvedValue({ isOffensive: false, reason: '' })
    })

    describe('GET', () => {
        it('returns a list of forecasts', async () => {
            const { prisma } = await import('@/lib/prisma')

            const mockForecasts = [
                {
                    id: '1',
                    claimText: 'Forecast 1',
                    status: 'ACTIVE',
                    author: { id: 'u1', username: 'user1' },
                    _count: { commitments: 0 },
                    commitments: []
                },
                {
                    id: '2',
                    claimText: 'Forecast 2',
                    status: 'PENDING',
                    author: { id: 'u2', username: 'user2' },
                    _count: { commitments: 5 },
                    commitments: []
                },
            ]

            vi.mocked(prisma.prediction.findMany).mockResolvedValue(mockForecasts as any)
            vi.mocked(prisma.prediction.count).mockResolvedValue(2)

            const request = new NextRequest('http://localhost/api/forecasts')
            const response = await GET(request)
            const data = await response.json()

            expect(response.status).toBe(200)
            expect(data.predictions).toHaveLength(2)
            expect(data.predictions[0].claimText).toBe('Forecast 1')
        })

        it('passes tag filter to prisma where clause', async () => {
            const { prisma } = await import('@/lib/prisma')

            vi.mocked(prisma.prediction.findMany).mockResolvedValue([])
            vi.mocked(prisma.prediction.count).mockResolvedValue(0)

            const request = new NextRequest(
                'http://localhost/api/forecasts?tags=AI,Crypto'
            )
            const response = await GET(request)
            const data = await response.json()

            expect(response.status).toBe(200)
            expect(data.predictions).toHaveLength(0)

            // Verify Prisma was called with tags filter
            const findManyCall = vi.mocked(prisma.prediction.findMany).mock.calls[0][0] as any
            expect(findManyCall.where.tags).toEqual({
                some: {
                    name: { in: ['AI', 'Crypto'] },
                },
            })
        })

        it('returns forecasts without tag filter when no tags param', async () => {
            const { prisma } = await import('@/lib/prisma')

            vi.mocked(prisma.prediction.findMany).mockResolvedValue([])
            vi.mocked(prisma.prediction.count).mockResolvedValue(0)

            const request = new NextRequest('http://localhost/api/forecasts?status=ACTIVE')
            await GET(request)

            const findManyCall = vi.mocked(prisma.prediction.findMany).mock.calls[0][0] as any
            expect(findManyCall.where.tags).toBeUndefined()
        })

        it('status=PENDING matches deadline-passed OR AI-flagged-ACTIVE forecasts', async () => {
            const { prisma } = await import('@/lib/prisma')

            vi.mocked(prisma.prediction.findMany).mockResolvedValue([])
            vi.mocked(prisma.prediction.count).mockResolvedValue(0)

            const request = new NextRequest('http://localhost/api/forecasts?status=PENDING')
            await GET(request)

            const findManyCall = vi.mocked(prisma.prediction.findMany).mock.calls[0][0] as any
            expect(findManyCall.where.status).toBeUndefined()
            expect(findManyCall.where.AND).toEqual([
                {
                    OR: [
                        { status: 'PENDING' },
                        { status: 'ACTIVE', awaitingAiResolution: true },
                    ],
                },
            ])
        })

        it('combines the PENDING OR-clause with a search query without clobbering either', async () => {
            const { prisma } = await import('@/lib/prisma')

            vi.mocked(prisma.prediction.findMany).mockResolvedValue([])
            vi.mocked(prisma.prediction.count).mockResolvedValue(0)

            const request = new NextRequest('http://localhost/api/forecasts?status=PENDING&q=turkey')
            await GET(request)

            const findManyCall = vi.mocked(prisma.prediction.findMany).mock.calls[0][0] as any
            expect(findManyCall.where.AND).toEqual([
                {
                    OR: [
                        { status: 'PENDING' },
                        { status: 'ACTIVE', awaitingAiResolution: true },
                    ],
                },
                {
                    OR: [
                        { claimText: { contains: 'turkey', mode: 'insensitive' } },
                        { tags: { some: { name: { contains: 'turkey', mode: 'insensitive' } } } },
                    ],
                },
            ])
        })

        it('adds trigram-matched predictions and tags to the search OR-clause', async () => {
            const { prisma } = await import('@/lib/prisma')
            const { findFuzzyMatches } = await import('@/lib/services/fuzzy-search')

            vi.mocked(prisma.prediction.findMany).mockResolvedValue([])
            vi.mocked(prisma.prediction.count).mockResolvedValue(0)
            vi.mocked(findFuzzyMatches).mockResolvedValueOnce({
                predictionIds: ['p1', 'p2'],
                tagNames: ['Politics'],
            })

            const request = new NextRequest('http://localhost/api/forecasts?q=netanyau')
            await GET(request)

            expect(findFuzzyMatches).toHaveBeenCalledWith('netanyau')

            const findManyCall = vi.mocked(prisma.prediction.findMany).mock.calls[0][0] as any
            expect(findManyCall.where.AND).toEqual([
                {
                    OR: [
                        { claimText: { contains: 'netanyau', mode: 'insensitive' } },
                        { tags: { some: { name: { contains: 'netanyau', mode: 'insensitive' } } } },
                        { id: { in: ['p1', 'p2'] } },
                        { tags: { some: { name: { in: ['Politics'] } } } },
                    ],
                },
            ])
        })

        it('includes tags in response payload', async () => {
            const { prisma } = await import('@/lib/prisma')

            const mockForecasts = [
                {
                    id: '1',
                    claimText: 'AI will surpass humans',
                    status: 'ACTIVE',
                    author: { id: 'u1', username: 'user1' },
                    tags: [{ name: 'AI' }, { name: 'Technology' }],
                    _count: { commitments: 0 },
                    commitments: [],
                },
            ]

            vi.mocked(prisma.prediction.findMany).mockResolvedValue(mockForecasts as any)
            vi.mocked(prisma.prediction.count).mockResolvedValue(1)

            const request = new NextRequest('http://localhost/api/forecasts')
            const response = await GET(request)
            const data = await response.json()

            expect(response.status).toBe(200)
            expect(data.predictions[0].tags).toEqual([
                { name: 'AI' },
                { name: 'Technology' },
            ])
        })
    })

    describe('POST', () => {
        it('creates a new forecast when authenticated', async () => {
            const { prisma } = await import('@/lib/prisma')

            mockAuth.mockResolvedValue({
                user: { id: 'user1', email: 'user@example.com' },
            } as any)

            vi.mocked(prisma.user.findUnique).mockResolvedValue({
                id: 'user1',
                rs: 100,
            } as any)

            const newForecast = {
                id: 'new-1',
                claimText: 'New Forecast',
                status: 'DRAFT',
            }

            vi.mocked(prisma.prediction.create).mockResolvedValue(newForecast as any)
            vi.mocked(prisma.prediction.findUnique).mockResolvedValue(newForecast as any)
            vi.mocked(prisma.prediction.findMany).mockResolvedValue([])

            const body = {
                claimText: 'New Forecast',
                resolveByDatetime: '2026-12-31T23:59:59Z',
                outcomeType: 'BINARY',
                resolutionRules: 'Resolves YES if the event occurs as described.',
            }

            const request = new NextRequest('http://localhost/api/forecasts', {
                method: 'POST',
                body: JSON.stringify(body),
            })

            const response = await POST(request, { params: {} } as any)
            const data = await response.json()

            expect(response.status).toBe(201)
            expect(data.id).toBe('new-1')
            expect(prisma.prediction.create).toHaveBeenCalled()
        })

        it('returns 401 when not authenticated', async () => {
            mockAuth.mockResolvedValue(null)

            const body = {
                claimText: 'New Forecast',
            }

            const request = new NextRequest('http://localhost/api/forecasts', {
                method: 'POST',
                body: JSON.stringify(body),
            })

            const response = await POST(request, { params: {} } as any)
            expect(response.status).toBe(401)
        })

        it('creates forecast with tags using connectOrCreate', async () => {
            const { prisma } = await import('@/lib/prisma')

            mockAuth.mockResolvedValue({
                user: { id: 'user1', email: 'user@example.com', role: 'USER' },
            } as any)

            vi.mocked(prisma.user.findUnique).mockResolvedValue({
                id: 'user1',
                rs: 100,
            } as any)

            const newForecast = {
                id: 'new-1',
                claimText: 'AI Prediction',
                status: 'DRAFT',
                tags: [{ id: 't1', name: 'AI', slug: 'ai' }],
            }

            vi.mocked(prisma.prediction.create).mockResolvedValue(newForecast as any)
            vi.mocked(prisma.prediction.findUnique).mockResolvedValue(newForecast as any)
            vi.mocked(prisma.prediction.findMany).mockResolvedValue([])

            const body = {
                claimText: 'AI Prediction',
                resolveByDatetime: '2026-12-31T23:59:59Z',
                outcomeType: 'BINARY',
                resolutionRules: 'Resolves YES if the event occurs as described.',
                tags: ['AI', 'Technology'],
            }

            const request = new NextRequest('http://localhost/api/forecasts', {
                method: 'POST',
                body: JSON.stringify(body),
            })

            await POST(request, { params: {} } as any)

            // Verify tags were passed to create with connectOrCreate
            const createCall = vi.mocked(prisma.prediction.create).mock.calls[0][0] as any
            expect(createCall.data.tags).toBeDefined()
            expect(createCall.data.tags.connectOrCreate).toBeDefined()
            expect(Array.isArray(createCall.data.tags.connectOrCreate)).toBe(true)
        })

        it('creates forecast without tags when tags not provided', async () => {
            const { prisma } = await import('@/lib/prisma')

            mockAuth.mockResolvedValue({
                user: { id: 'user1', email: 'user@example.com', role: 'USER' },
            } as any)

            vi.mocked(prisma.user.findUnique).mockResolvedValue({
                id: 'user1',
                rs: 100,
            } as any)

            const newForecast = {
                id: 'new-1',
                claimText: 'Simple Prediction',
                status: 'DRAFT',
            }

            vi.mocked(prisma.prediction.create).mockResolvedValue(newForecast as any)
            vi.mocked(prisma.prediction.findUnique).mockResolvedValue(newForecast as any)
            vi.mocked(prisma.prediction.findMany).mockResolvedValue([])

            const body = {
                claimText: 'Simple Prediction',
                resolveByDatetime: '2026-12-31T23:59:59Z',
                outcomeType: 'BINARY',
                resolutionRules: 'Resolves YES if the event occurs as described.',
            }

            const request = new NextRequest('http://localhost/api/forecasts', {
                method: 'POST',
                body: JSON.stringify(body),
            })

            await POST(request, { params: {} } as any)

            // Verify tags were not passed to create
            const createCall = vi.mocked(prisma.prediction.create).mock.calls[0][0] as any
            expect(createCall.data.tags).toBeUndefined()
        })

        it('includes tags in forecast response', async () => {
            const { prisma } = await import('@/lib/prisma')

            mockAuth.mockResolvedValue({
                user: { id: 'user1', email: 'user@example.com', role: 'USER' },
            } as any)

            vi.mocked(prisma.user.findUnique).mockResolvedValue({
                id: 'user1',
                rs: 100,
            } as any)

            const newForecast = {
                id: 'new-1',
                claimText: 'AI Prediction',
                status: 'DRAFT',
                tags: [
                    { id: 't1', name: 'AI', slug: 'ai' },
                    { id: 't2', name: 'Technology', slug: 'technology' },
                ],
            }

            vi.mocked(prisma.prediction.create).mockResolvedValue(newForecast as any)
            vi.mocked(prisma.prediction.findUnique).mockResolvedValue(newForecast as any)
            vi.mocked(prisma.prediction.findMany).mockResolvedValue([])

            const body = {
                claimText: 'AI Prediction',
                resolveByDatetime: '2026-12-31T23:59:59Z',
                outcomeType: 'BINARY',
                resolutionRules: 'Resolves YES if the event occurs as described.',
                tags: ['AI', 'Technology'],
            }

            const request = new NextRequest('http://localhost/api/forecasts', {
                method: 'POST',
                body: JSON.stringify(body),
            })

            const response = await POST(request, { params: {} } as any)
            const data = await response.json()

            expect(data.tags).toHaveLength(2)
            expect(data.tags[0].name).toBe('AI')
            expect(data.tags[1].name).toBe('Technology')
        })

        // TEST-5: background translation failure path
        it('returns 201 and the created forecast even when background translation throws', async () => {
            const { prisma } = await import('@/lib/prisma')

            mockAuth.mockResolvedValue({
                user: { id: 'user1', email: 'user@example.com', role: 'USER' },
            } as any)
            vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: 'user1', rs: 100 } as any)

            const newForecast = { id: 'fc-1', claimText: 'Forecast with failing translation', status: 'DRAFT' }
            vi.mocked(prisma.prediction.create).mockResolvedValue(newForecast as any)
            vi.mocked(prisma.prediction.findUnique).mockResolvedValue(newForecast as any)
            vi.mocked(prisma.prediction.findMany).mockResolvedValue([])

            // Translation rejects — the route should swallow this via .catch() and still return 201
            mockTranslate.mockRejectedValue(new Error('Translation service unavailable'))

            const request = new NextRequest('http://localhost/api/forecasts', {
                method: 'POST',
                body: JSON.stringify({
                    claimText: 'Forecast with failing translation',
                    resolveByDatetime: '2026-12-31T23:59:59Z',
                    outcomeType: 'BINARY',
                    resolutionRules: 'Resolves YES if the event occurs.',
                }),
            })

            const response = await POST(request, { params: {} } as any)

            expect(response.status).toBe(201)
            // Translation was attempted (fire-and-forget)
            expect(mockTranslate).toHaveBeenCalledWith('fc-1')
        })
    })
})
