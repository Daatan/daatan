/**
 * @jest-environment node
 *
 * Manual number-rating feedback (daatan#1223) — the callback_query/note-reply
 * branches of the Telegram webhook, as distinct from the existing secret-gate
 * tests in route.test.ts (which don't touch prisma or these code paths).
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

const SECRET = 'correct-webhook-secret-value'
const ADMIN_MAP = JSON.stringify({ '111': 'user-mark', '222': 'user-andrey' })

const prismaMock = {
  articleRatingPrompt: { findUnique: vi.fn() },
  evidencePoolArticleFeedback: {
    upsert: vi.fn(),
    groupBy: vi.fn(),
    update: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
  },
}
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

const telegramMock = {
  answerTelegramCallback: vi.fn(),
  updateRatingPromptButtons: vi.fn(),
  sendRatingDrilldownDm: vi.fn(),
  updateDrilldownButtons: vi.fn(),
  finalizeRatingDrilldown: vi.fn(),
}
vi.mock('@/lib/services/telegram', () => telegramMock)

async function loadRoute() {
  vi.resetModules()
  vi.stubEnv('TELEGRAM_WEBHOOK_SECRET', SECRET)
  vi.stubEnv('TELEGRAM_ROLLBACK_CHAT_IDS', '111222')
  vi.stubEnv('TELEGRAM_BOT_TOKEN', 'test-token')
  vi.stubEnv('TELEGRAM_ADMIN_MAP', ADMIN_MAP)
  return import('@/app/api/telegram/rollback/route')
}

function postWith(body: unknown) {
  return new Request('http://localhost/api/telegram/rollback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-telegram-bot-api-secret-token': SECRET },
    body: JSON.stringify(body),
  })
}

function callback(data: string, fromId: number | string, extra?: object) {
  return {
    callback_query: {
      id: 'cb-1',
      data,
      from: { id: fromId },
      message: { message_id: 555, chat: { id: '-100' } },
      ...extra,
    },
  }
}

describe('POST /api/telegram/rollback — manual number-rating feedback (daatan#1223)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })))
    Object.values(prismaMock.articleRatingPrompt).forEach((fn) => fn.mockReset())
    Object.values(prismaMock.evidencePoolArticleFeedback).forEach((fn) => fn.mockReset())
    Object.values(telegramMock).forEach((fn) => fn.mockReset())
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('accepts a tap from a Telegram user NOT in TELEGRAM_ADMIN_MAP — any channel member votes by design', async () => {
    prismaMock.articleRatingPrompt.findUnique.mockResolvedValue({
      id: 'prompt-1',
      evidencePoolArticle: { title: 'T', url: 'https://x.com/a', source: 'Ynet' },
    })
    prismaMock.evidencePoolArticleFeedback.upsert.mockResolvedValue({ id: 'fb-1', flaggedFields: [] })
    prismaMock.evidencePoolArticleFeedback.groupBy.mockResolvedValue([{ rating: 3, _count: 1 }])

    const { POST } = await loadRoute()
    const res = await POST(postWith(callback('nf:r:3', 999)))

    expect(res.status).toBe(200)
    expect(prismaMock.evidencePoolArticleFeedback.upsert).toHaveBeenCalledWith({
      where: { promptId_raterTelegramId: { promptId: 'prompt-1', raterTelegramId: '999' } },
      create: { promptId: 'prompt-1', raterTelegramId: '999', raterName: null, raterUserId: null, rating: 3 },
      update: { rating: 3, raterName: null },
    })
    expect(telegramMock.answerTelegramCallback).toHaveBeenCalledWith('cb-1', 'Rated 3/5')
  })

  it("captures the tapper's display name, preferring full name over @username", async () => {
    prismaMock.articleRatingPrompt.findUnique.mockResolvedValue({
      id: 'prompt-1',
      evidencePoolArticle: { title: 'T', url: 'https://x.com/a', source: 'Ynet' },
    })
    prismaMock.evidencePoolArticleFeedback.upsert.mockResolvedValue({ id: 'fb-1', flaggedFields: [] })
    prismaMock.evidencePoolArticleFeedback.groupBy.mockResolvedValue([])

    const { POST } = await loadRoute()
    await POST(
      postWith({
        callback_query: {
          id: 'cb-1',
          data: 'nf:r:4',
          from: { id: 999, first_name: 'Dana', last_name: 'K', username: 'danak' },
          message: { message_id: 555, chat: { id: '-100' } },
        },
      }),
    )

    expect(prismaMock.evidencePoolArticleFeedback.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ raterName: 'Dana K' }),
      }),
    )
  })

  it('a high rating (5) upserts the row, refreshes per-value tally counts, and does not open a drilldown', async () => {
    prismaMock.articleRatingPrompt.findUnique.mockResolvedValue({
      id: 'prompt-1',
      evidencePoolArticle: { title: 'T', url: 'https://x.com/a', source: 'Ynet' },
    })
    prismaMock.evidencePoolArticleFeedback.upsert.mockResolvedValue({ id: 'fb-1', flaggedFields: [] })
    prismaMock.evidencePoolArticleFeedback.groupBy.mockResolvedValue([{ rating: 5, _count: 1 }])

    const { POST } = await loadRoute()
    const res = await POST(postWith(callback('nf:r:5', 111)))

    expect(res.status).toBe(200)
    // 111 IS in TELEGRAM_ADMIN_MAP — the row gets the optional daatan User link.
    expect(prismaMock.evidencePoolArticleFeedback.upsert).toHaveBeenCalledWith({
      where: { promptId_raterTelegramId: { promptId: 'prompt-1', raterTelegramId: '111' } },
      create: { promptId: 'prompt-1', raterTelegramId: '111', raterName: null, raterUserId: 'user-mark', rating: 5 },
      update: { rating: 5, raterName: null },
    })
    expect(telegramMock.updateRatingPromptButtons).toHaveBeenCalledWith('-100', 555, [0, 0, 0, 0, 1])
    expect(telegramMock.sendRatingDrilldownDm).not.toHaveBeenCalled()
    expect(telegramMock.answerTelegramCallback).toHaveBeenCalledWith('cb-1', 'Rated 5/5')
  })

  it('a rating of exactly 3 (the neutral midpoint) does not open the drilldown', async () => {
    prismaMock.articleRatingPrompt.findUnique.mockResolvedValue({
      id: 'prompt-1',
      evidencePoolArticle: { title: 'T', url: 'https://x.com/a', source: 'Ynet' },
    })
    prismaMock.evidencePoolArticleFeedback.upsert.mockResolvedValue({ id: 'fb-1', flaggedFields: [] })
    prismaMock.evidencePoolArticleFeedback.groupBy.mockResolvedValue([])

    const { POST } = await loadRoute()
    await POST(postWith(callback('nf:r:3', 111)))

    expect(telegramMock.sendRatingDrilldownDm).not.toHaveBeenCalled()
  })

  it('a low rating (<=2) upserts the row and opens the private drilldown DM, persisting its message id', async () => {
    prismaMock.articleRatingPrompt.findUnique.mockResolvedValue({
      id: 'prompt-1',
      evidencePoolArticle: { title: 'T', url: 'https://x.com/a', source: 'Ynet' },
    })
    prismaMock.evidencePoolArticleFeedback.upsert.mockResolvedValue({ id: 'fb-1', flaggedFields: [] })
    prismaMock.evidencePoolArticleFeedback.groupBy.mockResolvedValue([{ rating: 1, _count: 1 }])
    telegramMock.sendRatingDrilldownDm.mockResolvedValue({ message_id: 888 })

    const { POST } = await loadRoute()
    await POST(postWith(callback('nf:r:1', 111)))

    expect(prismaMock.evidencePoolArticleFeedback.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: { promptId: 'prompt-1', raterTelegramId: '111', raterName: null, raterUserId: 'user-mark', rating: 1 },
      }),
    )
    expect(telegramMock.sendRatingDrilldownDm).toHaveBeenCalledWith({
      raterTelegramId: '111',
      article: { title: 'T', url: 'https://x.com/a', source: 'Ynet' },
      flaggedFields: [],
    })
    expect(prismaMock.evidencePoolArticleFeedback.update).toHaveBeenCalledWith({
      where: { id: 'fb-1' },
      data: { drilldownChatId: '111', drilldownMessageId: 888 },
    })
    expect(telegramMock.answerTelegramCallback).toHaveBeenCalledWith('cb-1', 'Rated 1/5')
  })

  it('a low rating whose drilldown DM cannot be sent (never /start-ed the bot) still stores the rating, with a /start hint toast', async () => {
    prismaMock.articleRatingPrompt.findUnique.mockResolvedValue({
      id: 'prompt-1',
      evidencePoolArticle: { title: 'T', url: 'https://x.com/a', source: 'Ynet' },
    })
    prismaMock.evidencePoolArticleFeedback.upsert.mockResolvedValue({ id: 'fb-1', flaggedFields: [] })
    prismaMock.evidencePoolArticleFeedback.groupBy.mockResolvedValue([{ rating: 2, _count: 1 }])
    telegramMock.sendRatingDrilldownDm.mockResolvedValue(null)

    const { POST } = await loadRoute()
    await POST(postWith(callback('nf:r:2', 999)))

    expect(prismaMock.evidencePoolArticleFeedback.upsert).toHaveBeenCalled()
    // No drilldown message id to persist — the only update call would be the drilldown one.
    expect(prismaMock.evidencePoolArticleFeedback.update).not.toHaveBeenCalled()
    expect(telegramMock.answerTelegramCallback).toHaveBeenCalledWith('cb-1', expect.stringContaining('/start'))
  })

  it('a tap on an expired/unknown rating-prompt message answers with an expiry notice, no upsert', async () => {
    prismaMock.articleRatingPrompt.findUnique.mockResolvedValue(null)

    const { POST } = await loadRoute()
    await POST(postWith(callback('nf:r:3', 111)))

    expect(telegramMock.answerTelegramCallback).toHaveBeenCalledWith('cb-1', expect.stringContaining('expired'))
    expect(prismaMock.evidencePoolArticleFeedback.upsert).not.toHaveBeenCalled()
  })

  it('ignores an out-of-range rating value with no DB write', async () => {
    const { POST } = await loadRoute()
    await POST(postWith(callback('nf:r:9', 111)))

    expect(prismaMock.articleRatingPrompt.findUnique).not.toHaveBeenCalled()
    expect(telegramMock.answerTelegramCallback).toHaveBeenCalledWith('cb-1')
  })

  it('toggling an unset field adds it to flaggedFields and refreshes the drilldown keyboard', async () => {
    prismaMock.evidencePoolArticleFeedback.findFirst.mockResolvedValue({ id: 'fb-1', flaggedFields: ['STANCE'] })

    const { POST } = await loadRoute()
    await POST(postWith(callback('nf:t:FACT_SIGNAL', 111)))

    expect(prismaMock.evidencePoolArticleFeedback.update).toHaveBeenCalledWith({
      where: { id: 'fb-1' },
      data: { flaggedFields: ['STANCE', 'FACT_SIGNAL'] },
    })
    expect(telegramMock.updateDrilldownButtons).toHaveBeenCalledWith('-100', 555, ['STANCE', 'FACT_SIGNAL'])
  })

  it('toggling an already-set field removes it', async () => {
    prismaMock.evidencePoolArticleFeedback.findFirst.mockResolvedValue({ id: 'fb-1', flaggedFields: ['STANCE', 'FACT_SIGNAL'] })

    const { POST } = await loadRoute()
    await POST(postWith(callback('nf:t:STANCE', 111)))

    expect(prismaMock.evidencePoolArticleFeedback.update).toHaveBeenCalledWith({
      where: { id: 'fb-1' },
      data: { flaggedFields: ['FACT_SIGNAL'] },
    })
  })

  it('ignores a toggle for a field that is not a real NumberFeedbackField value', async () => {
    const { POST } = await loadRoute()
    await POST(postWith(callback('nf:t:NOT_REAL', 111)))

    expect(prismaMock.evidencePoolArticleFeedback.findFirst).not.toHaveBeenCalled()
    expect(telegramMock.answerTelegramCallback).toHaveBeenCalledWith('cb-1')
  })

  it('Done finalizes the drilldown with the current rating and flagged fields', async () => {
    prismaMock.evidencePoolArticleFeedback.findFirst.mockResolvedValue({ id: 'fb-1', rating: 2, flaggedFields: ['CREDIBILITY'] })

    const { POST } = await loadRoute()
    await POST(postWith(callback('nf:d', 111)))

    expect(telegramMock.finalizeRatingDrilldown).toHaveBeenCalledWith('-100', 555, 2, ['CREDIBILITY'])
    expect(telegramMock.answerTelegramCallback).toHaveBeenCalledWith('cb-1', 'Saved')
  })

  it('a reply to the article-match message with an existing rating appends the note — from any member', async () => {
    prismaMock.articleRatingPrompt.findUnique.mockResolvedValue({ id: 'prompt-1' })
    prismaMock.evidencePoolArticleFeedback.findUnique.mockResolvedValue({ id: 'fb-1', note: null })

    const { POST } = await loadRoute()
    const res = await POST(
      postWith({
        message: {
          text: 'the similarity number looked off',
          chat: { id: '-100' },
          // 999 is NOT in TELEGRAM_ADMIN_MAP — notes attach by Telegram identity, no gate.
          from: { id: 999 },
          reply_to_message: { message_id: 555 },
        },
      }),
    )

    expect(res.status).toBe(200)
    expect(prismaMock.evidencePoolArticleFeedback.update).toHaveBeenCalledWith({
      where: { id: 'fb-1' },
      data: { note: 'the similarity number looked off' },
    })
  })

  it('a reply to a message with no prior rating is left unhandled (falls through, no note saved)', async () => {
    prismaMock.articleRatingPrompt.findUnique.mockResolvedValue(null)
    prismaMock.evidencePoolArticleFeedback.findFirst.mockResolvedValue(null)

    const { POST } = await loadRoute()
    await POST(
      postWith({
        message: {
          text: 'stray reply',
          chat: { id: '-100' },
          from: { id: 111 },
          reply_to_message: { message_id: 999 },
        },
      }),
    )

    expect(prismaMock.evidencePoolArticleFeedback.update).not.toHaveBeenCalled()
  })
})
