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

  it('canonicalizes a username profile to /profile/<username>', async () => {
    mockFindFirst.mockResolvedValue({
      id: 'cuid1',
      name: 'Alice',
      username: 'alice',
      isPublic: true,
      _count: { predictions: 1, commitments: 0 },
    })

    const metadata = await generateMetadata({ params, searchParams: Promise.resolve({}) })

    expect(metadata.alternates?.canonical).toMatch(/\/profile\/alice$/)
    expect(metadata.title).toBe('Alice (@alice) — Forecast Track Record')
  })

  it('canonicalizes a usernameless profile to its id, not /profile/null (#2052)', async () => {
    mockFindFirst.mockResolvedValue({
      id: 'cmt9ytmot030x01l3qomow7nh',
      name: 'Yoel',
      username: null,
      isPublic: true,
      _count: { predictions: 1, commitments: 0 },
    })

    const metadata = await generateMetadata({
      params: Promise.resolve({ id: 'cmt9ytmot030x01l3qomow7nh' }),
      searchParams: Promise.resolve({}),
    })

    expect(metadata.alternates?.canonical).toMatch(/\/profile\/cmt9ytmot030x01l3qomow7nh$/)
    expect((metadata.openGraph as { url?: string }).url).toBe(metadata.alternates?.canonical)
    expect(metadata.title).toBe('Yoel — Forecast Track Record')
  })

  it('noindexes an unknown user', async () => {
    mockFindFirst.mockResolvedValue(null)

    const metadata = await generateMetadata({ params, searchParams: Promise.resolve({}) })

    expect(metadata.robots).toEqual({ index: false })
  })
})
