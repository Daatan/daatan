import { describe, it, expect, vi } from 'vitest'
import { getTagBySlug, getVisibleTagPredictionCount } from '@/lib/services/tag'

const { mockFindUnique, mockCount } = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockCount: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    tag: {
      findUnique: mockFindUnique,
    },
    prediction: {
      count: mockCount,
    },
  },
}))

describe('getTagBySlug', () => {
  it('returns the tag with its prediction count when found', async () => {
    mockFindUnique.mockResolvedValue({
      id: 'tag1',
      name: 'Chess',
      slug: 'chess',
      _count: { predictions: 5 },
    })

    const result = await getTagBySlug('chess')

    expect(result).toEqual({ id: 'tag1', name: 'Chess', slug: 'chess', count: 5 })
    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { slug: 'chess' },
      select: { id: true, name: true, slug: true, _count: { select: { predictions: true } } },
    })
  })

  it('returns null when no tag matches the slug', async () => {
    mockFindUnique.mockResolvedValue(null)

    const result = await getTagBySlug('nonexistent')

    expect(result).toBeNull()
  })
})

describe('getVisibleTagPredictionCount', () => {
  it('counts only active, public predictions for the given tag', async () => {
    mockCount.mockResolvedValue(7)

    const result = await getVisibleTagPredictionCount('tag1')

    expect(result).toBe(7)
    expect(mockCount).toHaveBeenCalledWith({
      where: { status: 'ACTIVE', isPublic: true, tags: { some: { id: 'tag1' } } },
    })
  })
})
