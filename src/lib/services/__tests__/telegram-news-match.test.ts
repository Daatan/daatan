import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { notifyNewsArticleMatched } from '@/lib/services/telegram'

const PREDICTION = { id: 'p1', claimText: 'Will Netanyahu form the next government?', slug: 'nety' }
const MATCH = { similarity: 0.368 }
const ESTIMATE = { probability: 71, previous: 63, ciLow: 55, ciHigh: 85 }
const RATING = { evidencePoolArticleId: 'epa-1', contextSnapshotId: 'snap-1' }

const mockCreate = vi.fn()
vi.mock('@/lib/prisma', () => ({
  prisma: {
    articleRatingPrompt: {
      create: (...args: unknown[]) => mockCreate(...args),
    },
  },
}))

function calledMethod(call: unknown[]): string {
  return String(call[0]).split('/').pop() ?? ''
}

function calledBody(call: unknown[]): { chat_id: string; text: string; reply_markup?: unknown } {
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
    mockCreate.mockReset().mockResolvedValue({})
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, result: { message_id: 555 } }),
    }) as never
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('reports the move, and what the article said (stance/relevance/match) as table rows', async () => {
    // The numbers that make a match legible: which way the article argues, whether the Oracle
    // judged it to bear on the claim at all, and how far the estimate moved. Without stance
    // and relevance the message says the number changed but never why.
    await notifyNewsArticleMatched(
      PREDICTION,
      { title: 'Lapid says he can form a government', url: 'https://x.com/a', source: 'Ynet', stance: -0.72, relevance: 0.8 },
      MATCH,
      ESTIMATE,
    )

    const msg = sentMessage()
    expect(msg).toContain('Oracle 63% → 71%') // old → new
    expect(msg).toContain('<pre>')
    expect(msg).toMatch(/stance\s+-0\.72/) // signed: reads as "argues NO"
    expect(msg).toMatch(/relevance\s+0\.80/)
    expect(msg).toMatch(/match\s+37%/) // the embedding cosine: the weakest signal
    expect(msg).toMatch(/range\s+55–85%/)
  })

  it('links both the article and the forecast by name', async () => {
    await notifyNewsArticleMatched(
      PREDICTION,
      { title: 'Lapid says he can form a government', url: 'https://x.com/a', source: 'Ynet' },
      MATCH,
      ESTIMATE,
    )

    const msg = sentMessage()
    expect(msg).toContain('<a href="https://x.com/a">Lapid says he can form a government</a> — Ynet')
    expect(msg).toContain(`>${PREDICTION.claimText}</a>`)
  })

  it('quotes the article extract when given, omitting the line otherwise', async () => {
    await notifyNewsArticleMatched(
      PREDICTION,
      { title: 'T', url: 'https://x.com/a', source: 'Ynet', extract: 'Lapid told reporters he can form a government.' },
      MATCH,
      ESTIMATE,
    )
    expect(sentMessage()).toContain('<i>«Lapid told reporters he can form a government.»</i>')

    vi.mocked(global.fetch).mockClear()
    await notifyNewsArticleMatched(PREDICTION, { title: 'T', url: 'https://x.com/a', source: 'Ynet' }, MATCH, ESTIMATE)
    expect(sentMessage()).not.toContain('«')
  })

  it('renders a positive stance with an explicit +', async () => {
    await notifyNewsArticleMatched(
      PREDICTION,
      { title: 'T', url: 'https://x.com/a', source: null, stance: 0.42, relevance: 0.6 },
      MATCH,
      ESTIMATE,
    )
    expect(sentMessage()).toMatch(/stance\s+\+0\.42/)
  })

  it('omits stance/relevance rows when unknown rather than printing null', async () => {
    // An older Oracle response may carry neither. The table must degrade to fewer rows,
    // not render "stance null".
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
    expect(msg).toMatch(/match\s+37%/)
  })

  it('reports judgment-lane signals (Signal Lanes) as table rows when present', async () => {
    await notifyNewsArticleMatched(
      PREDICTION,
      {
        title: 'T',
        url: 'https://x.com/a',
        source: 'Ynet',
        authorLean: 0.6,
        authorLeanCertainty: 0.8,
        factSignal: 0.3,
        evidenceClass: 'reporting',
        credibilityWeight: 1.24,
      },
      MATCH,
      ESTIMATE,
    )

    const msg = sentMessage()
    expect(msg).toMatch(/author_lean\s+\+0\.60 · cert 0\.80/)
    expect(msg).toMatch(/fact_signal\s+\+0\.30/)
    expect(msg).toMatch(/credibility\s+1\.24/)
    expect(msg).toMatch(/class\s+reporting/)
  })

  it('renders only the judgment fields that are present, omitting the rest', async () => {
    // Matches most matches today: the credibility cutover flag is OFF and author_lean/
    // fact_signal are sparse by design (null on pure reporting).
    await notifyNewsArticleMatched(
      PREDICTION,
      { title: 'T', url: 'https://x.com/a', source: 'Ynet', factSignal: -0.45 },
      MATCH,
      ESTIMATE,
    )

    const msg = sentMessage()
    expect(msg).toMatch(/fact_signal\s+-0\.45/)
    expect(msg).not.toContain('author_lean')
    expect(msg).not.toContain('credibility')
  })

  it('shows an articles row only for a multi-article push', async () => {
    await notifyNewsArticleMatched(
      PREDICTION,
      { title: 'T', url: 'https://x.com/a', source: 'Ynet' },
      { similarity: 0.368, articleCount: 3 },
      ESTIMATE,
    )
    expect(sentMessage()).toMatch(/articles\s+3/)

    vi.mocked(global.fetch).mockClear()
    await notifyNewsArticleMatched(PREDICTION, { title: 'T', url: 'https://x.com/a', source: 'Ynet' }, MATCH, ESTIMATE)
    expect(sentMessage()).not.toContain('articles')
  })

  it('attaches the 1-5 rating buttons and persists the prompt row keyed on the sent message (daatan#1223)', async () => {
    await notifyNewsArticleMatched(
      PREDICTION,
      { title: 'T', url: 'https://x.com/a', source: 'Ynet' },
      MATCH,
      ESTIMATE,
      RATING,
    )

    const call = vi.mocked(global.fetch).mock.calls[0]
    expect(calledMethod(call)).toBe('sendMessage')
    expect(calledBody(call).reply_markup).toEqual({
      inline_keyboard: [
        [
          { text: '1️⃣', callback_data: 'nf:r:1' },
          { text: '2️⃣', callback_data: 'nf:r:2' },
          { text: '3️⃣', callback_data: 'nf:r:3' },
          { text: '4️⃣', callback_data: 'nf:r:4' },
          { text: '5️⃣', callback_data: 'nf:r:5' },
        ],
      ],
    })
    expect(mockCreate).toHaveBeenCalledWith({
      data: {
        evidencePoolArticleId: 'epa-1',
        predictionId: 'p1',
        contextSnapshotId: 'snap-1',
        snapshotSimilarity: 0.368,
        messageChatId: '-100',
        messageId: 555,
      },
    })
  })

  it('sends without buttons and persists nothing when no evidence-pool row was resolved', async () => {
    await notifyNewsArticleMatched(
      PREDICTION,
      { title: 'T', url: 'https://x.com/a', source: 'Ynet' },
      MATCH,
      ESTIMATE,
      null,
    )

    expect(calledBody(vi.mocked(global.fetch).mock.calls[0]).reply_markup).toBeUndefined()
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('does not persist a prompt row when the send fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => null }) as never
    await notifyNewsArticleMatched(
      PREDICTION,
      { title: 'T', url: 'https://x.com/a', source: 'Ynet' },
      MATCH,
      ESTIMATE,
      RATING,
    )
    expect(mockCreate).not.toHaveBeenCalled()
  })
})
