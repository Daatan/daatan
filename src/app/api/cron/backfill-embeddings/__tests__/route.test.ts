import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/env', () => ({ env: { BOT_RUNNER_SECRET: 'test-secret' } }))
vi.mock('@/lib/prisma', () => ({ prisma: { $queryRaw: vi.fn(), $executeRaw: vi.fn() } }))

// Deliberately NOT mocking @/lib/services/embedding: the defect this file guards
// lived in `embedAndStoreForecast`'s contract, not in the route's arithmetic, so a
// test that stubs the service out would pass against the broken code too.
import { prisma } from '@/lib/prisma'
import { GET } from '../route'

const queryRaw = vi.mocked(prisma.$queryRaw)
const executeRaw = vi.mocked(prisma.$executeRaw)

const FAKE_768 = Array.from({ length: 768 }, (_, i) => i / 768)

const ROWS = [
  { id: 'pred-1', claimText: 'first claim' },
  { id: 'pred-2', claimText: 'second claim' },
]

const GOOGLE_ENV = [
  'GEMINI_API_KEY',
  'GOOGLE_VERTEX_PROJECT_ID',
  'GOOGLE_VERTEX_CLIENT_EMAIL',
  'GOOGLE_VERTEX_PRIVATE_KEY',
  'GOOGLE_VERTEX_LOCATION',
]

/**
 * A Response body can only be consumed once, and the route embeds two rows — so
 * each call has to get its own instance. `mockResolvedValue` would hand the same
 * object to both and the second read fails with "Body has already been used".
 */
function embedResponses(values: number[]) {
  return vi.fn(() =>
    Promise.resolve(new Response(JSON.stringify({ embedding: { values } }), { status: 200 }))
  )
}

function req(secret = 'test-secret') {
  return new NextRequest('http://localhost/api/cron/backfill-embeddings', {
    headers: { 'x-cron-secret': secret },
  })
}

/** The route runs the SELECT first, then the remaining-count query. */
function stubQueries(remaining: number) {
  queryRaw.mockReset()
  queryRaw
    .mockResolvedValueOnce(ROWS as never)
    .mockResolvedValueOnce([{ count: BigInt(remaining) }] as never)
}

describe('GET /api/cron/backfill-embeddings', () => {
  const saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    vi.clearAllMocks()
    for (const k of GOOGLE_ENV) {
      saved[k] = process.env[k]
      delete process.env[k]
    }
    executeRaw.mockResolvedValue(1 as never)
  })

  afterEach(() => {
    for (const k of GOOGLE_ENV) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
    vi.unstubAllGlobals()
  })

  it('rejects a request without the cron secret', async () => {
    const res = await GET(req('wrong-secret'))
    expect(res.status).toBe(401)
  })

  it('counts stored rows as done', async () => {
    process.env.GEMINI_API_KEY = 'fake-key'
    stubQueries(0)
    vi.stubGlobal('fetch', embedResponses(FAKE_768))

    const body = await (await GET(req())).json()

    expect(body).toMatchObject({ ok: true, done: 2, failed: 0, remaining: 0 })
    expect(executeRaw).toHaveBeenCalledTimes(2)
  })

  /**
   * The regression this route was shipping. With no Google credentials at all,
   * `embedText()` returns null and nothing is stored — but `embedAndStoreForecast`
   * used to `return` silently on that, so the route's try/catch never fired and
   * every skipped row landed in `done`. The response read `{done: 2, failed: 0}`
   * while both rows stayed NULL, which is indistinguishable from a good run.
   *
   * That went from unlikely to plausible with #1472: production no longer carries
   * GEMINI_API_KEY, so a Vertex outage makes every call return null and the nightly
   * cron would have reported clean runs indefinitely.
   */
  it('counts rows that stored nothing as failed, not done', async () => {
    stubQueries(2) // no credentials in env — embedText() returns null without any fetch
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const body = await (await GET(req())).json()

    expect(body).toMatchObject({ ok: true, done: 0, failed: 2 })
    expect(body.remaining).toBe(2) // and the backlog did not move
    expect(executeRaw).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('counts a vector with non-finite values as failed', async () => {
    process.env.GEMINI_API_KEY = 'fake-key'
    stubQueries(2)
    const withNaN = [...FAKE_768]
    withNaN[0] = NaN // JSON-serialises to null, so it survives the 768-length check
    vi.stubGlobal('fetch', embedResponses(withNaN))

    const body = await (await GET(req())).json()

    expect(body).toMatchObject({ done: 0, failed: 2 })
    expect(executeRaw).not.toHaveBeenCalled()
  })
})
