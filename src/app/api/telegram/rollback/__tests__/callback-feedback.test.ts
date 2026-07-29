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
    count: vi.fn(),
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

  it('rejects a tap from a Telegram user not in TELEGRAM_ADMIN_MAP, with no DB write', async () => {
    const { POST } = await loadRoute()
    const res = await POST(postWith(callback('nf:g', 999)))

    expect(res.status).toBe(200)
    expect(telegramMock.answerTelegramCallback).toHaveBeenCalledWith('cb-1', expect.stringContaining('Not authorized'))
    expect(prismaMock.evidencePoolArticleFeedback.upsert).not.toHaveBeenCalled()
  })

  it('👍 tap upserts a GOOD row, refreshes tally counts, and does not open a drilldown', async () => {
    prismaMock.articleRatingPrompt.findUnique.mockResolvedValue({
      id: 'prompt-1',
      evidencePoolArticle: { title: 'T', url: 'https://x.com/a', source: 'Ynet' },
    })
    prismaMock.evidencePoolArticleFeedback.upsert.mockResolvedValue({ id: 'fb-1', flaggedFields: [] })
    prismaMock.evidencePoolArticleFeedback.count.mockResolvedValueOnce(1).mockResolvedValueOnce(0)

    const { POST } = await loadRoute()
    const res = await POST(postWith(callback('nf:g', 111)))

    expect(res.status).toBe(200)
    expect(prismaMock.evidencePoolArticleFeedback.upsert).toHaveBeenCalledWith({
      where: { promptId_raterUserId: { promptId: 'prompt-1', raterUserId: 'user-mark' } },
      create: { promptId: 'prompt-1', raterUserId: 'user-mark', rating: 'GOOD' },
      update: { rating: 'GOOD' },
    })
    expect(telegramMock.updateRatingPromptButtons).toHaveBeenCalledWith('-100', 555, 1, 0)
    expect(telegramMock.sendRatingDrilldownDm).not.toHaveBeenCalled()
    expect(telegramMock.answerTelegramCallback).toHaveBeenCalledWith('cb-1', expect.stringContaining('Recorded'))
  })

  it('👎 tap upserts a BAD row and opens the private drilldown DM, persisting its message id', async () => {
    prismaMock.articleRatingPrompt.findUnique.mockResolvedValue({
      id: 'prompt-1',
      evidencePoolArticle: { title: 'T', url: 'https://x.com/a', source: 'Ynet' },
    })
    prismaMock.evidencePoolArticleFeedback.upsert.mockResolvedValue({ id: 'fb-1', flaggedFields: [] })
    prismaMock.evidencePoolArticleFeedback.count.mockResolvedValueOnce(0).mockResolvedValueOnce(1)
    telegramMock.sendRatingDrilldownDm.mockResolvedValue({ message_id: 888 })

    const { POST } = await loadRoute()
    await POST(postWith(callback('nf:b', 111)))

    expect(telegramMock.sendRatingDrilldownDm).toHaveBeenCalledWith({
      raterTelegramId: '111',
      article: { title: 'T', url: 'https://x.com/a', source: 'Ynet' },
      flaggedFields: [],
    })
    expect(prismaMock.evidencePoolArticleFeedback.update).toHaveBeenCalledWith({
      where: { id: 'fb-1' },
      data: { drilldownChatId: '111', drilldownMessageId: 888 },
    })
  })

  it('a tap on an expired/unknown rating-prompt message answers with an expiry notice, no upsert', async () => {
    prismaMock.articleRatingPrompt.findUnique.mockResolvedValue(null)

    const { POST } = await loadRoute()
    await POST(postWith(callback('nf:g', 111)))

    expect(telegramMock.answerTelegramCallback).toHaveBeenCalledWith('cb-1', expect.stringContaining('expired'))
    expect(prismaMock.evidencePoolArticleFeedback.upsert).not.toHaveBeenCalled()
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

  it('Done finalizes the drilldown with the current flagged fields', async () => {
    prismaMock.evidencePoolArticleFeedback.findFirst.mockResolvedValue({ id: 'fb-1', flaggedFields: ['CREDIBILITY'] })

    const { POST } = await loadRoute()
    await POST(postWith(callback('nf:d', 111)))

    expect(telegramMock.finalizeRatingDrilldown).toHaveBeenCalledWith('-100', 555, ['CREDIBILITY'])
    expect(telegramMock.answerTelegramCallback).toHaveBeenCalledWith('cb-1', 'Saved')
  })

  it('a reply to the rating-prompt message with an existing rating appends the note', async () => {
    prismaMock.articleRatingPrompt.findUnique.mockResolvedValue({ id: 'prompt-1' })
    prismaMock.evidencePoolArticleFeedback.findUnique.mockResolvedValue({ id: 'fb-1', note: null })

    const { POST } = await loadRoute()
    const res = await POST(
      postWith({
        message: {
          text: 'the similarity number looked off',
          chat: { id: '-100' },
          from: { id: 111 },
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
