import { vi, describe, it, expect, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * The bot system is SaaS-only: every bot API route 404s in the self_hosted
 * edition (the feature looks absent) and runs normally on SaaS.
 */

const mockEnv: Record<string, unknown> = { DAATAN_EDITION: 'self_hosted' }
vi.mock('@/env', () => ({ env: mockEnv }))

// withAuth → invoke the handler with a fake admin.
vi.mock('@/lib/api-middleware', () => ({
  withAuth: (h: (req: NextRequest, u: unknown, c: unknown) => unknown) =>
    (req: NextRequest, ctx: unknown) => h(req, { id: 'a1', role: 'ADMIN' }, ctx ?? { params: {} }),
}))

// Stub the bot service so a SaaS-path call doesn't hit the DB.
vi.mock('@/lib/services/bot', () => ({
  listBots: vi.fn(async () => []),
  getBotCount: vi.fn(async () => 0),
  findBotUserByUsername: vi.fn(),
  createBotInDb: vi.fn(),
}))
vi.mock('@/lib/llm', () => ({ createBotLLMService: vi.fn() }))
vi.mock('@/lib/llm/bedrock-prompts', () => ({ getPromptTemplate: vi.fn(), fillPrompt: vi.fn() }))

beforeEach(() => {
  mockEnv.DAATAN_EDITION = 'self_hosted'
})

describe('bot routes — self-hosted gating', () => {
  it('GET /api/admin/bots → 404 on self_hosted', async () => {
    const { GET } = await import('@/app/api/admin/bots/route')
    const res = await GET(new NextRequest('http://localhost/api/admin/bots'), { params: Promise.resolve({}) } as never)
    expect(res.status).toBe(404)
  })

  it('GET /api/admin/bots → 200 (runs) on SaaS', async () => {
    mockEnv.DAATAN_EDITION = 'saas'
    const { GET } = await import('@/app/api/admin/bots/route')
    const res = await GET(new NextRequest('http://localhost/api/admin/bots'), { params: Promise.resolve({}) } as never)
    expect(res.status).toBe(200)
  })

  it('POST /api/bots/run (cron) → 404 on self_hosted before any secret check', async () => {
    const { POST } = await import('@/app/api/bots/run/route')
    const res = await POST(new NextRequest('http://localhost/api/bots/run', { method: 'POST' }))
    expect(res.status).toBe(404) // not 401 — the route is absent, not merely unauthorized
  })
})
