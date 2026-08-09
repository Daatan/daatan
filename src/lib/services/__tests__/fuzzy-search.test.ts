import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockQueryRaw } = vi.hoisted(() => ({ mockQueryRaw: vi.fn() }))

vi.mock('@/lib/prisma', () => ({
    prisma: {
        $queryRaw: mockQueryRaw,
    },
}))

import { findFuzzyMatches } from '../fuzzy-search'

describe('findFuzzyMatches', () => {
    beforeEach(() => {
        mockQueryRaw.mockReset()
    })

    it('returns matched prediction ids and tag names', async () => {
        mockQueryRaw
            .mockResolvedValueOnce([{ id: 'p1' }, { id: 'p2' }])
            .mockResolvedValueOnce([{ name: 'Politics' }])

        const result = await findFuzzyMatches('netanyau')

        expect(result).toEqual({ predictionIds: ['p1', 'p2'], tagNames: ['Politics'] })
        expect(mockQueryRaw).toHaveBeenCalledTimes(2)
    })

    it('returns empty arrays when nothing matches', async () => {
        mockQueryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([])

        const result = await findFuzzyMatches('zzzzzz')

        expect(result).toEqual({ predictionIds: [], tagNames: [] })
    })

    it('uses word_similarity, not similarity, against claimText and tag names', async () => {
        mockQueryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([])

        await findFuzzyMatches('netanyau')

        for (const call of mockQueryRaw.mock.calls) {
            const sql = call[0].join(' ')
            expect(sql).toContain('word_similarity')
            expect(sql).not.toMatch(/(?<!word_)similarity\(/)
        }
    })
})
