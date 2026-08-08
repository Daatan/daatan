import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockBotRunLogCreate = vi.fn()
vi.mock('@/lib/prisma', () => ({
  prisma: {
    botRunLog: {
      create: (...args: unknown[]) => mockBotRunLogCreate(...args),
    },
  },
}))
vi.mock('@/lib/llm', () => ({ createBotLLMService: vi.fn() }))

import { validateResolveByDate, type BotWithUser } from '../shared'

const BOT = { id: 'bot-1' } as unknown as BotWithUser

describe('validateResolveByDate (daatan#1322)', () => {
  beforeEach(() => {
    mockBotRunLogCreate.mockReset().mockResolvedValue({})
  })

  it('rejects an unparseable date and logs "Invalid date format"', async () => {
    const result = await validateResolveByDate(BOT, 'some topic', { title: 'some topic' }, 'not-a-date', false)

    expect(result.ok).toBe(false)
    expect(mockBotRunLogCreate).toHaveBeenCalledTimes(1)
    expect(mockBotRunLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          botId: 'bot-1',
          action: 'ERROR',
          error: 'Invalid date format',
        }),
      }),
    )
  })

  it('rejects a past date and logs "Past resolution date"', async () => {
    const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const result = await validateResolveByDate(BOT, 'some topic', { title: 'some topic' }, pastDate, false)

    expect(result.ok).toBe(false)
    expect(mockBotRunLogCreate).toHaveBeenCalledTimes(1)
    expect(mockBotRunLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          botId: 'bot-1',
          action: 'ERROR',
          error: 'Past resolution date',
        }),
      }),
    )
  })

  it('accepts a valid future date and returns it without logging an error', async () => {
    const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    const result = await validateResolveByDate(BOT, 'some topic', { title: 'some topic' }, futureDate.toISOString(), false)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.resolveBy.getTime()).toBe(futureDate.getTime())
    }
    expect(mockBotRunLogCreate).not.toHaveBeenCalled()
  })

  it('passes the caller-supplied triggerNews payload through to the run log (sourceless has no title)', async () => {
    await validateResolveByDate(BOT, '(LLM-generated, no sources)', {}, 'not-a-date', true)

    expect(mockBotRunLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          triggerNews: {},
          isDryRun: true,
        }),
      }),
    )
  })
})
