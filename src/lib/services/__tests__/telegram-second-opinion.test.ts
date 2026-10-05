import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { notifyEvidenceSecondOpinionDigest } from '@/lib/services/telegram'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

function sentTexts(): string[] {
  return vi.mocked(global.fetch).mock.calls.map((call) => JSON.parse(String((call[1] as { body: string }).body)).text)
}

describe('notifyEvidenceSecondOpinionDigest — failed second opinions (daatan#1798)', () => {
  beforeEach(() => {
    vi.stubEnv('APP_ENV', 'staging') // anything but 'development', which short-circuits
    vi.stubEnv('TELEGRAM_BOT_TOKEN', 'tok')
    vi.stubEnv('TELEGRAM_CHAT_ID', '-100')
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }) as never
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('sends when the only news is that second opinions failed', async () => {
    notifyEvidenceSecondOpinionDigest({ issues: [], articlesChecked: 4, secondOpinionFailures: { oracle_http: 3, oracle_abstain: 1 } })
    await vi.waitFor(() => expect(global.fetch).toHaveBeenCalled())

    expect(sentTexts()[0]).toContain('No second opinion for 3/4: oracle_http×3')
  })

  it('stays silent when nothing fired and the only misses are abstains', async () => {
    notifyEvidenceSecondOpinionDigest({ issues: [], articlesChecked: 2, secondOpinionFailures: { oracle_abstain: 2 } })
    await new Promise((r) => setTimeout(r, 10))

    expect(global.fetch).not.toHaveBeenCalled()
  })
})
