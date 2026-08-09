import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/auth', () => ({ auth: vi.fn() }))
vi.mock('@/lib/services/telegram', () => ({
  notifyServerError: vi.fn(),
  notifySecurityError: vi.fn(),
}))

import { auth } from '@/auth'
import { GET } from '../route'

const mockAuth = vi.mocked(auth as unknown as () => Promise<unknown>)
const mockFetch = vi.fn()

const req = (q?: string) => new NextRequest(`http://localhost/api/admin/wikipedia-lookup${q ? `?q=${q}` : ''}`)
const ctx = { params: Promise.resolve({}) }

beforeEach(() => {
  vi.clearAllMocks()
  global.fetch = mockFetch
  mockAuth.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } })
})

describe('GET /api/admin/wikipedia-lookup', () => {
  it('rejects an unauthenticated caller with 401 and never calls Wikipedia', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(req('Reuters'), ctx)
    expect(res.status).toBe(401)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns 400 when q is missing', async () => {
    const res = await GET(req(), ctx)
    expect(res.status).toBe(400)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('maps Wikipedia search results to { title, url, description }', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        pages: [{ key: 'Reuters', title: 'Reuters', description: 'News agency' }],
      }),
    })

    const res = await GET(req('Reuters'), ctx)
    const body = await res.json()

    expect(mockFetch).toHaveBeenCalledWith(
      'https://en.wikipedia.org/w/rest.php/v1/search/page?q=Reuters&limit=5',
      expect.any(Object),
    )
    expect(body).toEqual({
      results: [{ title: 'Reuters', url: 'https://en.wikipedia.org/wiki/Reuters', description: 'News agency' }],
    })
  })

  it('returns 502 when Wikipedia responds with an error status', async () => {
    mockFetch.mockResolvedValue({ ok: false })
    const res = await GET(req('Reuters'), ctx)
    expect(res.status).toBe(502)
  })
})
