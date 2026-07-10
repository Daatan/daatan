import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

vi.mock('@/env', () => ({
  env: { NEWS_INDEXER_URL: 'https://scrapper.test', NEWS_INDEXER_API_KEY: 'test-key' },
}))
vi.mock('@/auth', () => ({ auth: vi.fn() }))
vi.mock('@/lib/services/telegram', () => ({
  notifyServerError: vi.fn(),
  notifySecurityError: vi.fn(),
}))
vi.mock('@/lib/services/news-indexer-authors', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/services/news-indexer-authors')>()),
  proxyAuthorsAdmin: vi.fn(async () => NextResponse.json({ ok: true })),
}))

import { auth } from '@/auth'
import { proxyAuthorsAdmin } from '@/lib/services/news-indexer-authors'
import { GET, POST } from '../route'
import { PATCH, DELETE } from '../[id]/route'
import { POST as POST_ALIAS } from '../[id]/aliases/route'
import { DELETE as DELETE_ALIAS } from '../[id]/aliases/[aliasId]/route'

const UUID = 'd1a8046c-b8a1-4a41-b12e-7ddd89ef275c'
const ALIAS_UUID = '4563dfba-8bee-4421-9033-84120b60c933'

const mockAuth = vi.mocked(auth as unknown as () => Promise<unknown>)
const mockProxy = vi.mocked(proxyAuthorsAdmin)

const asRole = (role: string) => mockAuth.mockResolvedValue({ user: { id: 'u1', role } })

const req = (method: string, body?: unknown) =>
  new NextRequest('http://localhost/api/admin/news-indexer/authors', {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

const ctx = (params: Record<string, string>) => ({ params: Promise.resolve(params) })

beforeEach(() => {
  vi.clearAllMocks()
  mockProxy.mockResolvedValue(NextResponse.json({ ok: true }))
})

describe('authors proxy — access control', () => {
  it('rejects an unauthenticated caller with 401 and never calls upstream', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(req('GET'), ctx({}))
    expect(res.status).toBe(401)
    expect(mockProxy).not.toHaveBeenCalled()
  })

  it('rejects a non-admin caller with 403 and never calls upstream', async () => {
    asRole('USER')
    const res = await GET(req('GET'), ctx({}))
    expect(res.status).toBe(403)
    expect(mockProxy).not.toHaveBeenCalled()
  })

  it('lets an ADMIN list curated people', async () => {
    asRole('ADMIN')
    const res = await GET(req('GET'), ctx({}))
    expect(res.status).toBe(200)
    expect(mockProxy).toHaveBeenCalledWith('/authors/admin/people')
  })
})

describe('authors proxy — id validation', () => {
  beforeEach(() => asRole('ADMIN'))

  it('forwards a well-formed person id', async () => {
    await PATCH(req('PATCH', { canonical_name: 'Ben Caspit' }), ctx({ id: UUID }))
    expect(mockProxy).toHaveBeenCalledWith(`/authors/${UUID}`, {
      method: 'PATCH',
      body: { canonical_name: 'Ben Caspit' },
    })
  })

  it.each(['..', 'admin/people', 'not-a-uuid'])(
    'rejects person id %j with 400 before it reaches the upstream URL',
    async (id) => {
      const res = await DELETE(req('DELETE'), ctx({ id }))
      expect(res.status).toBe(400)
      expect(mockProxy).not.toHaveBeenCalled()
    },
  )

  it('rejects a malformed alias id with 400', async () => {
    const res = await DELETE_ALIAS(req('DELETE'), ctx({ id: UUID, aliasId: '../../ledger' }))
    expect(res.status).toBe(400)
    expect(mockProxy).not.toHaveBeenCalled()
  })

  it('forwards a well-formed alias delete', async () => {
    await DELETE_ALIAS(req('DELETE'), ctx({ id: UUID, aliasId: ALIAS_UUID }))
    expect(mockProxy).toHaveBeenCalledWith(`/authors/${UUID}/aliases/${ALIAS_UUID}`, { method: 'DELETE' })
  })

  it.each(['..', 'admin/people', 'not-a-uuid'])(
    'rejects an alias create on person id %j with 400',
    async (id) => {
      const res = await POST_ALIAS(req('POST', { alias: 'בן כספית' }), ctx({ id }))
      expect(res.status).toBe(400)
      expect(mockProxy).not.toHaveBeenCalled()
    },
  )
})

describe('authors proxy — alias create', () => {
  beforeEach(() => asRole('ADMIN'))

  it('rejects an unauthenticated caller with 401 and never calls upstream', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await POST_ALIAS(req('POST', { alias: 'x' }), ctx({ id: UUID }))
    expect(res.status).toBe(401)
    expect(mockProxy).not.toHaveBeenCalled()
  })

  it('rejects a non-admin caller with 403 and never calls upstream', async () => {
    asRole('USER')
    const res = await POST_ALIAS(req('POST', { alias: 'x' }), ctx({ id: UUID }))
    expect(res.status).toBe(403)
    expect(mockProxy).not.toHaveBeenCalled()
  })

  it('rejects a non-object body with 400', async () => {
    const res = await POST_ALIAS(req('POST', 'oops'), ctx({ id: UUID }))
    expect(res.status).toBe(400)
    expect(mockProxy).not.toHaveBeenCalled()
  })

  it('forwards a well-formed alias create', async () => {
    await POST_ALIAS(req('POST', { alias: 'בן כספית' }), ctx({ id: UUID }))
    expect(mockProxy).toHaveBeenCalledWith(`/authors/${UUID}/aliases`, {
      method: 'POST',
      body: { alias: 'בן כספית' },
    })
  })
})

describe('authors proxy — body handling', () => {
  beforeEach(() => asRole('ADMIN'))

  it('rejects a non-object body with 400', async () => {
    const res = await POST(req('POST', 'oops'), ctx({}))
    expect(res.status).toBe(400)
    expect(mockProxy).not.toHaveBeenCalled()
  })

  it('forwards a person create', async () => {
    await POST(req('POST', { canonical_name: 'Amit Segal', notes: null }), ctx({}))
    expect(mockProxy).toHaveBeenCalledWith('/authors', {
      method: 'POST',
      body: { canonical_name: 'Amit Segal', notes: null },
    })
  })
})
