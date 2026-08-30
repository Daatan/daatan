import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/env', () => ({ env: { BOT_RUNNER_SECRET: 'test-secret' } }))
vi.mock('@/auth', () => ({ auth: vi.fn() }))
vi.mock('@/lib/services/telegram', () => ({
  notifyServerError: vi.fn(),
  notifySecurityError: vi.fn(),
})) // withAuth's error path notifies on 5xx — keep it a no-op in tests

vi.mock('@/lib/prisma', () => ({
  prisma: { $queryRaw: vi.fn() },
}))
vi.mock('@/lib/services/embedding', () => ({ embedAndStoreExternalMarket: vi.fn() }))

import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { embedAndStoreExternalMarket } from '@/lib/services/embedding'
import { POST } from '../route'

const mockAuth = vi.mocked(auth as unknown as () => Promise<unknown>)
const queryRaw = vi.mocked(prisma.$queryRaw)
const embed = vi.mocked(embedAndStoreExternalMarket)

function req() {
  return new NextRequest('http://localhost/api/admin/backfill-market-embeddings', { method: 'POST' })
}

const ctx = { params: Promise.resolve({}) }

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } })
})

describe('POST /api/admin/backfill-market-embeddings', () => {
  it('rejects a non-admin session', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'u1', role: 'USER' } })
    const res = await POST(req(), ctx)

    expect(res.status).toBe(403)
    expect(queryRaw).not.toHaveBeenCalled()
  })

  it('embeds every row missing an embedding and reports the counts', async () => {
    queryRaw.mockResolvedValue([
      { id: 'm1', question: 'Will X happen?' },
      { id: 'm2', question: 'Will Y happen?' },
    ] as never)
    embed.mockResolvedValue(undefined)

    const res = await POST(req(), ctx)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({ done: 2, failed: 0, total: 2 })
    expect(embed).toHaveBeenCalledWith('m1', 'Will X happen?')
    expect(embed).toHaveBeenCalledWith('m2', 'Will Y happen?')
  })

  it('counts a per-row embed failure without failing the whole run', async () => {
    queryRaw.mockResolvedValue([
      { id: 'm1', question: 'Will X happen?' },
      { id: 'm2', question: 'Will Y happen?' },
    ] as never)
    embed.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('embed down'))

    const res = await POST(req(), ctx)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({ done: 1, failed: 1, total: 2 })
  })

  it('is a no-op when nothing is missing an embedding', async () => {
    queryRaw.mockResolvedValue([])

    const res = await POST(req(), ctx)
    const body = await res.json()

    expect(body).toMatchObject({ done: 0, failed: 0, total: 0 })
    expect(embed).not.toHaveBeenCalled()
  })
})
