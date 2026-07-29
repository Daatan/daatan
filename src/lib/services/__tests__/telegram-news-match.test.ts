import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { notifyNewsArticleMatched } from '@/lib/services/telegram'

const PREDICTION = { id: 'p1', claimText: 'Will Netanyahu form the next government?', slug: 'nety' }
const MATCH = { similarity: 0.368 }
const ESTIMATE = { probability: 71, previous: 63, ciLow: 55, ciHigh: 85 }

const mockFindUnique = vi.fn()
const mockUpdate = vi.fn()
vi.mock('@/lib/prisma', () => ({
  prisma: {
    prediction: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
    },
  },
}))

function calledMethod(call: unknown[]): string {
  return String(call[0]).split('/').pop() ?? ''
}

function calledBody(call: unknown[]): { chat_id: string; message_id?: number; text: string } {
  return JSON.parse(String((call[1] as { body: string }).body))
}

function sentMessage(): string {
  const call = vi.mocked(global.fetch).mock.calls[0]
  return calledBody(call).text
}

describe('notifyNewsArticleMatched', () => {
  beforeEach(() => {
    vi.stubEnv('APP_ENV', 'staging') // anything but 'development', which short-circuits
    vi.stubEnv('TELEGRAM_BOT_TOKEN', 'tok')
    vi.stubEnv('TELEGRAM_CHAT_ID', '-100')
    mockFindUnique.mockReset().mockResolvedValue({ telegramMessageId: null, telegramChatId: null })
    mockUpdate.mockReset().mockResolvedValue({})
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, result: { message_id: 555 } }),
    }) as never
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('reports what the article said (stance) and how much it counted (relevance), plus the move', async () => {
    // The three numbers that make a match legible: which way the article argues, whether the
    // Oracle judged it to bear on the claim at all, and how far the estimate moved. Without
    // stance and relevance the message says the number changed but never why.
    await notifyNewsArticleMatched(
      PREDICTION,
      { title: 'Lapid says he can form a government', url: 'https://x.com/a', source: 'Ynet', stance: -0.72, relevance: 0.8 },
      MATCH,
      ESTIMATE,
    )

    const msg = sentMessage()
    expect(msg).toContain('Oracle 63% → 71%')  // old → new
    expect(msg).toContain('stance -0.72')      // signed: reads as "argues NO"
    expect(msg).toContain('relevance 0.80')
    expect(msg).toContain('match 37%')         // the embedding cosine, last: the weakest signal
  })

  it('renders a positive stance with an explicit +', async () => {
    await notifyNewsArticleMatched(
      PREDICTION,
      { title: 'T', url: 'https://x.com/a', source: null, stance: 0.42, relevance: 0.6 },
      MATCH,
      ESTIMATE,
    )
    expect(sentMessage()).toContain('stance +0.42')
  })

  it('omits stance/relevance when unknown rather than printing null', async () => {
    // Prod daatan will keep returning no relevance until this release ships, and an older Oracle
    // response may carry neither. The message must degrade to today's, not render "relevance null".
    await notifyNewsArticleMatched(
      PREDICTION,
      { title: 'T', url: 'https://x.com/a', source: 'Ynet' },
      MATCH,
      ESTIMATE,
    )

    const msg = sentMessage()
    expect(msg).not.toContain('null')
    expect(msg).not.toContain('stance')
    expect(msg).not.toContain('relevance')
    expect(msg).toContain('match 37%')
  })

  it('sends a new message and persists its id when no notification exists yet (daatan#1215)', async () => {
    await notifyNewsArticleMatched(
      PREDICTION,
      { title: 'T', url: 'https://x.com/a', source: 'Ynet' },
      MATCH,
      ESTIMATE,
    )

    expect(calledMethod(vi.mocked(global.fetch).mock.calls[0])).toBe('sendMessage')
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { telegramMessageId: 555, telegramChatId: '-100' },
    })
  })

  it('edits the existing message in place instead of sending a new one (daatan#1215)', async () => {
    mockFindUnique.mockResolvedValue({ telegramMessageId: 42, telegramChatId: '-100' })

    await notifyNewsArticleMatched(
      PREDICTION,
      { title: 'T', url: 'https://x.com/a', source: 'Ynet' },
      MATCH,
      ESTIMATE,
    )

    expect(global.fetch).toHaveBeenCalledTimes(1)
    const call = vi.mocked(global.fetch).mock.calls[0]
    expect(calledMethod(call)).toBe('editMessageText')
    expect(calledBody(call).message_id).toBe(42)
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('falls back to a new send and adopts its id when the edit fails (daatan#1215)', async () => {
    mockFindUnique.mockResolvedValue({ telegramMessageId: 42, telegramChatId: '-100' })
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, json: async () => ({ ok: false, description: 'message to edit not found' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, result: { message_id: 999 } }) }) as never

    await notifyNewsArticleMatched(
      PREDICTION,
      { title: 'T', url: 'https://x.com/a', source: 'Ynet' },
      MATCH,
      ESTIMATE,
    )

    expect(global.fetch).toHaveBeenCalledTimes(2)
    expect(calledMethod(vi.mocked(global.fetch).mock.calls[0])).toBe('editMessageText')
    expect(calledMethod(vi.mocked(global.fetch).mock.calls[1])).toBe('sendMessage')
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { telegramMessageId: 999, telegramChatId: '-100' },
    })
  })
})
