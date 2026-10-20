import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/env', () => ({ env: { BOT_RUNNER_SECRET: 'test-secret' } }))
vi.mock('@/auth', () => ({ auth: vi.fn() }))
vi.mock('@/lib/services/telegram', () => ({
  notifyServerError: vi.fn(),
  notifySecurityError: vi.fn(),
}))
vi.mock('@/lib/api-edition-guard', () => ({ blockedOnSelfHost: () => null }))
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ allowed: true, resetAt: 0 }),
  rateLimitResponse: vi.fn(),
}))
vi.mock('@/lib/services/bot', () => ({ getBotById: vi.fn() }))
vi.mock('@/lib/services/bots', () => ({ runBotById: vi.fn() }))

import { auth } from '@/auth'
import { getBotById } from '@/lib/services/bot'
import { runBotById } from '@/lib/services/bots'
import { resetBotRunJobsForTest } from '@/lib/services/bots/runJobs'
import { GET, POST } from '../route'

const mockAuth = vi.mocked(auth as unknown as () => Promise<unknown>)
const bot = vi.mocked(getBotById)
const run = vi.mocked(runBotById)

const ctx = { params: Promise.resolve({ id: 'bot-1' }) }
const post = (qs = '') =>
  POST(new NextRequest(`http://localhost/api/admin/bots/bot-1/run${qs}`, { method: 'POST' }), ctx)
const get = () => GET(new NextRequest('http://localhost/api/admin/bots/bot-1/run'), ctx)

beforeEach(() => {
  vi.clearAllMocks()
  resetBotRunJobsForTest()
  mockAuth.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } })
  bot.mockResolvedValue({ id: 'bot-1' } as never)
})

describe('/api/admin/bots/:id/run (#1947)', () => {
  it('answers 202 at once and exposes the result through GET', async () => {
    let finish!: (v: never) => void
    run.mockReturnValue(new Promise((r) => { finish = r as never }))

    const res = await post('?dry=true')
    expect(res.status).toBe(202)
    expect(run).toHaveBeenCalledWith('bot-1', true)
    expect((await (await get()).json()).status).toBe('running')

    finish({ botName: 'B' } as never)
    await vi.waitFor(async () => expect((await (await get()).json()).status).toBe('done'))
    expect((await (await get()).json()).summary).toEqual({ botName: 'B' })
  })

  it('does not start a second run while one is in flight', async () => {
    run.mockReturnValue(new Promise(() => {}))

    await post()
    const second = await post()

    expect(second.status).toBe(202)
    expect((await second.json()).started).toBe(false)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('surfaces a failed run through GET', async () => {
    run.mockRejectedValue(new Error('boom'))

    await post()

    await vi.waitFor(async () => expect((await (await get()).json()).status).toBe('failed'))
    expect((await (await get()).json()).error).toBe('boom')
  })

  it('returns 404 for an unknown bot and starts nothing', async () => {
    bot.mockResolvedValue(null as never)

    expect((await post()).status).toBe(404)
    expect(run).not.toHaveBeenCalled()
  })

  it('reports "none" when nothing has run, and rejects non-admins', async () => {
    expect((await (await get()).json()).status).toBe('none')

    mockAuth.mockResolvedValue({ user: { id: 'u2', role: 'USER' } })
    expect((await get()).status).toBe(403)
  })
})
