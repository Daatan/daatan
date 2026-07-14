import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { notifyNewsArticleMatched } from '@/lib/services/telegram'

const PREDICTION = { id: 'p1', claimText: 'Will Netanyahu form the next government?', slug: 'nety' }
const MATCH = { similarity: 0.368 }
const ESTIMATE = { probability: 71, previous: 63, ciLow: 55, ciHigh: 85 }

function sentMessage(): string {
  const call = vi.mocked(global.fetch).mock.calls[0]
  return JSON.parse(String(call[1]?.body)).text
}

describe('notifyNewsArticleMatched', () => {
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

  it('reports what the article said (stance) and how much it counted (relevance), plus the move', async () => {
    // The three numbers that make a match legible: which way the article argues, whether the
    // Oracle judged it to bear on the claim at all, and how far the estimate moved. Without
    // stance and relevance the message says the number changed but never why.
    notifyNewsArticleMatched(
      PREDICTION,
      { title: 'Lapid says he can form a government', url: 'https://x.com/a', source: 'Ynet', stance: -0.72, relevance: 0.8 },
      MATCH,
      ESTIMATE,
    )
    await vi.waitFor(() => expect(global.fetch).toHaveBeenCalled())

    const msg = sentMessage()
    expect(msg).toContain('Oracle 63% → 71%')  // old → new
    expect(msg).toContain('stance -0.72')      // signed: reads as "argues NO"
    expect(msg).toContain('relevance 0.80')
    expect(msg).toContain('match 37%')         // the embedding cosine, last: the weakest signal
  })

  it('renders a positive stance with an explicit +', async () => {
    notifyNewsArticleMatched(
      PREDICTION,
      { title: 'T', url: 'https://x.com/a', source: null, stance: 0.42, relevance: 0.6 },
      MATCH,
      ESTIMATE,
    )
    await vi.waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(sentMessage()).toContain('stance +0.42')
  })

  it('omits stance/relevance when unknown rather than printing null', async () => {
    // Prod daatan will keep returning no relevance until this release ships, and an older Oracle
    // response may carry neither. The message must degrade to today's, not render "relevance null".
    notifyNewsArticleMatched(
      PREDICTION,
      { title: 'T', url: 'https://x.com/a', source: 'Ynet' },
      MATCH,
      ESTIMATE,
    )
    await vi.waitFor(() => expect(global.fetch).toHaveBeenCalled())

    const msg = sentMessage()
    expect(msg).not.toContain('null')
    expect(msg).not.toContain('stance')
    expect(msg).not.toContain('relevance')
    expect(msg).toContain('match 37%')
  })
})
