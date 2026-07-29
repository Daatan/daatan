import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  sendArticleRatingPrompt,
  answerTelegramCallback,
  updateRatingPromptButtons,
  sendRatingDrilldownDm,
  updateDrilldownButtons,
  finalizeRatingDrilldown,
} from '@/lib/services/telegram'

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

function calledBody(call: unknown[]): Record<string, unknown> {
  return JSON.parse(String((call[1] as { body: string }).body))
}

describe('manual number-rating feedback (daatan#1223)', () => {
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

  describe('sendArticleRatingPrompt', () => {
    const input = {
      predictionId: 'pred-1',
      evidencePoolArticleId: 'epa-1',
      contextSnapshotId: 'snap-1',
      similarity: 0.87,
      article: { title: 'Lapid says he can form a government', url: 'https://x.com/a', source: 'Ynet' },
    }

    it('sends a message with 👍/👎 buttons carrying static callback_data (no ids)', async () => {
      await sendArticleRatingPrompt(input)

      const call = vi.mocked(global.fetch).mock.calls[0]
      expect(calledMethod(call)).toBe('sendMessage')
      const body = calledBody(call)
      expect(body.text).toContain(input.article.title)
      expect(body.reply_markup).toEqual({
        inline_keyboard: [
          [
            { text: '👍 Good', callback_data: 'nf:g' },
            { text: '👎 Bad', callback_data: 'nf:b' },
          ],
        ],
      })
    })

    it('persists an ArticleRatingPrompt row keyed on the sent message id, after send', async () => {
      await sendArticleRatingPrompt(input)

      expect(mockCreate).toHaveBeenCalledWith({
        data: {
          evidencePoolArticleId: 'epa-1',
          predictionId: 'pred-1',
          contextSnapshotId: 'snap-1',
          snapshotSimilarity: 0.87,
          messageChatId: '-100',
          messageId: 555,
        },
      })
    })

    it('does not persist a row when the send fails', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => null }) as never
      await sendArticleRatingPrompt(input)
      expect(mockCreate).not.toHaveBeenCalled()
    })

    it('is a no-op in development', async () => {
      vi.stubEnv('APP_ENV', 'development')
      await sendArticleRatingPrompt(input)
      expect(global.fetch).not.toHaveBeenCalled()
    })
  })

  describe('answerTelegramCallback', () => {
    it('posts to answerCallbackQuery with the callback id and optional toast text', async () => {
      await answerTelegramCallback('cb-1', '👍 Recorded')
      const call = vi.mocked(global.fetch).mock.calls[0]
      expect(calledMethod(call)).toBe('answerCallbackQuery')
      expect(calledBody(call)).toEqual({ callback_query_id: 'cb-1', text: '👍 Recorded' })
    })

    it('omits text when not given', async () => {
      await answerTelegramCallback('cb-1')
      expect(calledBody(vi.mocked(global.fetch).mock.calls[0])).toEqual({ callback_query_id: 'cb-1' })
    })
  })

  describe('updateRatingPromptButtons', () => {
    it('refreshes button labels with tally counts, keeping callback_data static', async () => {
      await updateRatingPromptButtons('-100', 555, 2, 1)
      const call = vi.mocked(global.fetch).mock.calls[0]
      expect(calledMethod(call)).toBe('editMessageReplyMarkup')
      const body = calledBody(call)
      expect(body.reply_markup).toEqual({
        inline_keyboard: [
          [
            { text: '👍 Good ·2', callback_data: 'nf:g' },
            { text: '👎 Bad ·1', callback_data: 'nf:b' },
          ],
        ],
      })
    })

    it('omits the count suffix when zero', async () => {
      await updateRatingPromptButtons('-100', 555, 0, 0)
      const body = calledBody(vi.mocked(global.fetch).mock.calls[0])
      expect(body.reply_markup).toEqual({
        inline_keyboard: [
          [
            { text: '👍 Good', callback_data: 'nf:g' },
            { text: '👎 Bad', callback_data: 'nf:b' },
          ],
        ],
      })
    })
  })

  describe('sendRatingDrilldownDm', () => {
    it('sends a private message with a toggle keyboard reflecting already-flagged fields', async () => {
      await sendRatingDrilldownDm({
        raterTelegramId: '999',
        article: { title: 'T', url: 'https://x.com/a', source: 'Ynet' },
        flaggedFields: ['STANCE'],
      })

      const call = vi.mocked(global.fetch).mock.calls[0]
      expect(calledMethod(call)).toBe('sendMessage')
      const body = calledBody(call)
      expect(body.chat_id).toBe('999')
      const keyboard = body.reply_markup as { inline_keyboard: { text: string; callback_data: string }[][] }
      const stanceButton = keyboard.inline_keyboard.flat().find((b) => b.callback_data === 'nf:t:STANCE')
      expect(stanceButton?.text).toContain('✅')
      const relevanceButton = keyboard.inline_keyboard.flat().find((b) => b.callback_data === 'nf:t:RELEVANCE')
      expect(relevanceButton?.text).not.toContain('✅')
      expect(keyboard.inline_keyboard.at(-1)).toEqual([{ text: '✅ Done', callback_data: 'nf:d' }])
    })
  })

  describe('updateDrilldownButtons', () => {
    it('refreshes checkmarks to match the given flagged fields', async () => {
      await updateDrilldownButtons('999', 777, ['FACT_SIGNAL', 'CREDIBILITY'])
      const call = vi.mocked(global.fetch).mock.calls[0]
      expect(calledMethod(call)).toBe('editMessageReplyMarkup')
      const body = calledBody(call)
      const keyboard = body.reply_markup as { inline_keyboard: { text: string; callback_data: string }[][] }
      const flat = keyboard.inline_keyboard.flat()
      expect(flat.find((b) => b.callback_data === 'nf:t:FACT_SIGNAL')?.text).toContain('✅')
      expect(flat.find((b) => b.callback_data === 'nf:t:CREDIBILITY')?.text).toContain('✅')
      expect(flat.find((b) => b.callback_data === 'nf:t:STANCE')?.text).not.toContain('✅')
    })
  })

  describe('finalizeRatingDrilldown', () => {
    it('collapses the keyboard and confirms the flagged fields by label', async () => {
      await finalizeRatingDrilldown('999', 777, ['STANCE', 'FACT_SIGNAL'])
      const call = vi.mocked(global.fetch).mock.calls[0]
      expect(calledMethod(call)).toBe('editMessageText')
      const body = calledBody(call)
      expect(body.text).toBe('Recorded: Bad — Stance, Fact Signal')
      expect(body.reply_markup).toEqual({ inline_keyboard: [] })
    })

    it('reports "none" when no field was flagged', async () => {
      await finalizeRatingDrilldown('999', 777, [])
      const body = calledBody(vi.mocked(global.fetch).mock.calls[0])
      expect(body.text).toBe('Recorded: Bad — none')
    })
  })
})
