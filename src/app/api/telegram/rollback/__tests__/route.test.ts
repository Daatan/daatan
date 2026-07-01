/**
 * @jest-environment node
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

// The route captures TELEGRAM_WEBHOOK_SECRET at module load, so the env var
// must be set before the dynamic import in each test.
const SECRET = 'correct-webhook-secret-value'

async function loadRoute() {
  vi.resetModules()
  vi.stubEnv('TELEGRAM_WEBHOOK_SECRET', SECRET)
  vi.stubEnv('TELEGRAM_ROLLBACK_CHAT_IDS', '111222')
  vi.stubEnv('TELEGRAM_BOT_TOKEN', 'test-token')
  return import('@/app/api/telegram/rollback/route')
}

function postWith(secretHeader: string | null, body: unknown) {
  return new Request('http://localhost/api/telegram/rollback', {
    method: 'POST',
    headers: secretHeader === null
      ? { 'Content-Type': 'application/json' }
      : { 'Content-Type': 'application/json', 'x-telegram-bot-api-secret-token': secretHeader },
    body: JSON.stringify(body),
  })
}

describe('POST /api/telegram/rollback — webhook secret gate', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('rejects a request with a wrong secret without processing the message', async () => {
    const { POST } = await loadRoute()
    // Unauthorized chat — would trigger a sendMessage (fetch) call IF the secret gate passed.
    const res = await POST(postWith('wrong-secret', { message: { chat: { id: 999 }, text: '/status' } }))

    expect(res.status).toBe(200) // 200 to avoid Telegram retries
    expect(fetchMock).not.toHaveBeenCalled() // gate rejected before any Telegram call
  })

  it('rejects a request with a missing secret header', async () => {
    const { POST } = await loadRoute()
    const res = await POST(postWith(null, { message: { chat: { id: 999 }, text: '/status' } }))

    expect(res.status).toBe(200)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('passes the secret gate with the correct secret (then enforces chat allow-list)', async () => {
    const { POST } = await loadRoute()
    // Correct secret but unauthorized chat → proceeds past the gate and sends the
    // "not authorized" Telegram message, proving the gate let it through.
    const res = await POST(postWith(SECRET, { message: { chat: { id: 999 }, text: '/status' } }))

    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalled()
    const calledUrl = fetchMock.mock.calls[0][0] as string
    expect(calledUrl).toContain('/sendMessage')
  })

  // Regression: previously the secret check was `if (WEBHOOK_SECRET) {...}`, so an
  // unset secret skipped the gate entirely (fail-open) and let any request through.
  it('fails closed when TELEGRAM_WEBHOOK_SECRET is not configured', async () => {
    vi.resetModules()
    vi.stubEnv('TELEGRAM_WEBHOOK_SECRET', '')
    vi.stubEnv('TELEGRAM_ROLLBACK_CHAT_IDS', '111222')
    vi.stubEnv('TELEGRAM_BOT_TOKEN', 'test-token')
    const { POST } = await import('@/app/api/telegram/rollback/route')

    // Even an allowed chat id is rejected before any processing — with no secret
    // configured the request cannot be authenticated as coming from Telegram.
    const res = await POST(postWith('any-secret', { message: { chat: { id: 111222 }, text: '/status' } }))

    expect(res.status).toBe(200)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
