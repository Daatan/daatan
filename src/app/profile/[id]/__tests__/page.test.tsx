import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockFindFirst } = vi.hoisted(() => ({
  mockFindFirst: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: { user: { findFirst: mockFindFirst } },
}))
vi.mock('@/auth', () => ({ auth: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/services/profile', () => ({
  loadProfileScores: vi.fn(),
  loadProfileTab: vi.fn(),
}))
vi.mock('@/components/profile/UserProfileView', () => ({ UserProfileView: () => null }))
vi.mock('@/components/JsonLd', () => ({ JsonLd: () => null }))

import { generateMetadata } from '../page'

describe('profile/[id] page generateMetadata', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const params = Promise.resolve({ id: 'alice' })

  it('queries only public predictions/commitments for the thin-content check', async () => {
    mockFindFirst.mockResolvedValue({
      name: 'Alice',
      username: 'alice',
      isPublic: true,
      _count: { predictions: 0, commitments: 0 },
    })

    await generateMetadata({ params, searchParams: Promise.resolve({}) })

    const query = mockFindFirst.mock.calls[0][0]
    expect(query.select._count.select.predictions).toEqual({ where: { isPublic: true } })
    expect(query.select._count.select.commitments).toEqual({
      where: { prediction: { isPublic: true } },
    })
  })

  it('noindexes a public profile whose only content is private', async () => {
    // The DB row's raw predictions/commitments counts would be > 0, but the
    // filtered _count (isPublic-only) the query actually requests is 0.
    mockFindFirst.mockResolvedValue({
      name: 'Alice',
      username: 'alice',
      isPublic: true,
      _count: { predictions: 0, commitments: 0 },
    })

    const metadata = await generateMetadata({ params, searchParams: Promise.resolve({}) })

    expect(metadata.robots).toEqual({ index: false, follow: true })
  })

  it('indexes a public profile with at least one public prediction', async () => {
    mockFindFirst.mockResolvedValue({
      name: 'Alice',
      username: 'alice',
      isPublic: true,
      _count: { predictions: 1, commitments: 0 },
    })

    const metadata = await generateMetadata({ params, searchParams: Promise.resolve({}) })

    expect(metadata.robots).toBeUndefined()
  })

  it('noindexes a private user regardless of content', async () => {
    mockFindFirst.mockResolvedValue({
      name: 'Bob',
      username: 'bob',
      isPublic: false,
      _count: { predictions: 5, commitments: 5 },
    })

    const metadata = await generateMetadata({ params, searchParams: Promise.resolve({}) })

    expect(metadata.robots).toEqual({ index: false, follow: false })
  })

  it('noindexes an unknown user', async () => {
    mockFindFirst.mockResolvedValue(null)

    const metadata = await generateMetadata({ params, searchParams: Promise.resolve({}) })

    expect(metadata.robots).toEqual({ index: false })
  })
})
