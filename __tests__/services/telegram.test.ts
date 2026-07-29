import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

// notifyNewsArticleMatched (daatan#1215) reads/writes Prediction.telegramMessageId
// /telegramChatId to edit its running message in place instead of resending —
// stub it to "no notification sent yet" so every test in this file exercises the
// plain-send path (the edit-in-place behavior itself is covered in
// src/lib/services/__tests__/telegram-news-match.test.ts).
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

import {
  notifyForecastPublished,
  notifyNewCommitment,
  notifyNewComment,
  notifyForecastResolved,
  notifyNewsArticleMatched,
  notifyBackupVerificationFailed,
  notifySecurityError,
} from '@/lib/services/telegram'

describe('Telegram notification service', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
    process.env.TELEGRAM_BOT_TOKEN = 'test-token'
    process.env.TELEGRAM_CHAT_ID = '-100123'
    process.env.APP_ENV = 'production'
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, result: { message_id: 555 } }),
    } as Response)
    mockFindUnique.mockReset().mockResolvedValue({ telegramMessageId: null, telegramChatId: null })
    mockUpdate.mockReset().mockResolvedValue({})
  })

  afterEach(() => {
    process.env = originalEnv
    vi.restoreAllMocks()
  })

  it('sends forecast published notification', async () => {
    notifyForecastPublished(
      { id: 'p1', claimText: 'Will BTC reach 100k?' },
      { name: 'Mark', username: 'mark' },
    )

    // Allow the fire-and-forget promise to resolve
    await vi.waitFor(() => {
      expect(fetch).toHaveBeenCalledOnce()
    })

    const call = vi.mocked(fetch).mock.calls[0]
    expect(call[0]).toBe('https://api.telegram.org/bottest-token/sendMessage')
    const body = JSON.parse(call[1]!.body as string)
    expect(body.chat_id).toBe('-100123')
    expect(body.text).toContain('New forecast published')
    expect(body.text).toContain('Will BTC reach 100k?')
    expect(body.text).toContain('Mark')
    expect(body.text).toMatch(/^\[prod\]/)
  })

  it('prefixes with [staging] on staging', async () => {
    process.env.APP_ENV = 'staging'

    notifyForecastPublished(
      { id: 'p1', claimText: 'Test claim' },
      { name: 'User', username: null },
    )

    await vi.waitFor(() => {
      expect(fetch).toHaveBeenCalledOnce()
    })

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)
    expect(body.text).toMatch(/^\[staging\]/)
  })

  it('skips when TELEGRAM_BOT_TOKEN is missing', async () => {
    delete process.env.TELEGRAM_BOT_TOKEN

    notifyForecastPublished(
      { id: 'p1', claimText: 'Test' },
      { name: 'User', username: null },
    )

    // Give a tick for the async function to potentially fire
    await new Promise((r) => setTimeout(r, 50))
    expect(fetch).not.toHaveBeenCalled()
  })

  it('sends commitment notification with choice', async () => {
    notifyNewCommitment(
      { id: 'p1', claimText: 'Will it rain?' },
      { name: 'Alice', username: 'alice' },
      50,
      'Yes',
    )

    await vi.waitFor(() => {
      expect(fetch).toHaveBeenCalledOnce()
    })

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)
    expect(body.text).toContain('Alice')
    expect(body.text).toContain('50 CU')
    expect(body.text).toContain('Yes')
  })

  it('sends comment notification', async () => {
    notifyNewComment(
      { id: 'p1', claimText: 'Some prediction' },
      { name: 'Bob', username: null },
      'I think this is likely',
    )

    await vi.waitFor(() => {
      expect(fetch).toHaveBeenCalledOnce()
    })

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)
    expect(body.text).toContain('Bob')
    expect(body.text).toContain('I think this is likely')
  })

  it('sends resolution notification', async () => {
    notifyForecastResolved(
      { id: 'p1', claimText: 'Will BTC moon?' },
      'correct',
      5,
    )

    await vi.waitFor(() => {
      expect(fetch).toHaveBeenCalledOnce()
    })

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)
    expect(body.text).toContain('CORRECT')
    expect(body.text).toContain('5 commitments')
  })

  it('does not throw on fetch error', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('Network error'))

    // Should not throw
    notifyForecastPublished(
      { id: 'p1', claimText: 'Test' },
      { name: 'User', username: null },
    )

    await new Promise((r) => setTimeout(r, 50))
    expect(fetch).toHaveBeenCalledOnce()
  })
})

describe('Telegram channel routing (clean vs noisy)', () => {
  const originalEnv = process.env
  const NOISY = '-100noisy'
  const CLEAN = '-100clean'

  beforeEach(() => {
    process.env = { ...originalEnv }
    process.env.TELEGRAM_BOT_TOKEN = 'test-token'
    process.env.TELEGRAM_CHAT_ID = NOISY
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, result: { message_id: 555 } }),
    } as Response)
    mockFindUnique.mockReset().mockResolvedValue({ telegramMessageId: null, telegramChatId: null })
    mockUpdate.mockReset().mockResolvedValue({})
  })

  afterEach(() => {
    process.env = originalEnv
    vi.restoreAllMocks()
  })

  async function lastChatId(): Promise<string> {
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)
    return body.chat_id
  }

  it('routes a clean event to the clean channel in production', async () => {
    process.env.APP_ENV = 'production'
    process.env.TELEGRAM_CLEAN_CHAT_ID = CLEAN

    notifyForecastPublished({ id: 'p1', claimText: 'x' }, { name: 'M', username: null })

    expect(await lastChatId()).toBe(CLEAN)
  })

  it('falls back to the noisy channel when the clean id is unset in production', async () => {
    process.env.APP_ENV = 'production'
    delete process.env.TELEGRAM_CLEAN_CHAT_ID

    notifyBackupVerificationFailed('disk full')

    expect(await lastChatId()).toBe(NOISY)
  })

  it('routes clean events to the noisy channel on staging (clean is prod-only)', async () => {
    process.env.APP_ENV = 'staging'
    process.env.TELEGRAM_CLEAN_CHAT_ID = CLEAN

    notifyForecastPublished({ id: 'p1', claimText: 'x' }, { name: 'M', username: null })

    expect(await lastChatId()).toBe(NOISY)
  })

  it('keeps noisy events on the noisy channel even in production with a clean id set', async () => {
    process.env.APP_ENV = 'production'
    process.env.TELEGRAM_CLEAN_CHAT_ID = CLEAN

    notifyNewsArticleMatched(
      { id: 'p1', claimText: 'x' },
      { title: 'Headline', url: 'https://e.com/a', source: 'Reuters' },
      { similarity: 0.9 },
      { probability: 72, previous: null, ciLow: null, ciHigh: null },
    )

    expect(await lastChatId()).toBe(NOISY)
  })

  it('news-article match flows through the shared helper (gets the env prefix)', async () => {
    process.env.APP_ENV = 'production'

    notifyNewsArticleMatched(
      { id: 'p1', claimText: 'x' },
      { title: 'Headline', url: 'https://e.com/a', source: null },
      { similarity: 0.5 },
      { probability: 58, previous: null, ciLow: null, ciHigh: null },
    )

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)
    expect(body.text).toMatch(/^\[prod\] /)
    expect(body.text).toContain('Oracle')
  })

  it('labels a first estimate, a move, and an unchanged value distinctly', async () => {
    process.env.APP_ENV = 'production'

    const send = (probability: number, previous: number | null) =>
      notifyNewsArticleMatched(
        { id: 'p1', claimText: 'x' },
        { title: 'Headline', url: 'https://e.com/a', source: null },
        { similarity: 0.5 },
        { probability, previous, ciLow: null, ciHigh: null },
      )

    send(58, null)
    send(58, 45)
    send(58, 58)

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3))
    const texts = vi.mocked(fetch).mock.calls.map(
      (c) => JSON.parse(c[1]!.body as string).text as string,
    )
    expect(texts[0]).toContain('Oracle 58%</b> · first estimate')
    expect(texts[1]).toContain('Oracle 45% → 58%</b>  (+13)')
    expect(texts[2]).toContain('Oracle 58%</b> · unchanged')
  })

  it('signs a downward move with a bare minus, not a double sign', async () => {
    process.env.APP_ENV = 'production'

    notifyNewsArticleMatched(
      { id: 'p1', claimText: 'x' },
      { title: 'Headline', url: 'https://e.com/a', source: null },
      { similarity: 0.5 },
      { probability: 40, previous: 58, ciLow: null, ciHigh: null },
    )

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)
    expect(body.text).toContain('Oracle 58% → 40%</b>  (-18)')
  })

  it('renders the confidence range when it is wide enough to be informative', async () => {
    process.env.APP_ENV = 'production'

    notifyNewsArticleMatched(
      { id: 'p1', claimText: 'x' },
      { title: 'Headline', url: 'https://e.com/a', source: null },
      { similarity: 0.5 },
      { probability: 58, previous: 45, ciLow: 44, ciHigh: 72 },
    )

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)
    expect(body.text).toContain('range 44–72%')
  })

  it('omits the range line for a missing or degenerate confidence interval', async () => {
    process.env.APP_ENV = 'production'

    const send = (ciLow: number | null, ciHigh: number | null) =>
      notifyNewsArticleMatched(
        { id: 'p1', claimText: 'x' },
        { title: 'Headline', url: 'https://e.com/a', source: null },
        { similarity: 0.5 },
        { probability: 58, previous: 45, ciLow, ciHigh },
      )

    send(null, null)
    send(58, 58) // zero-width band
    send(57, 58) // 1-point band, still noise

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3))
    const texts = vi.mocked(fetch).mock.calls.map(
      (c) => JSON.parse(c[1]!.body as string).text as string,
    )
    texts.forEach((t) => expect(t).not.toContain('range'))
  })

  it('shows the article count only when more than one article backs the estimate', async () => {
    process.env.APP_ENV = 'production'

    const send = (articleCount?: number) =>
      notifyNewsArticleMatched(
        { id: 'p1', claimText: 'x' },
        { title: 'Headline', url: 'https://e.com/a', source: 'Haaretz' },
        { similarity: 0.72, articleCount },
        { probability: 58, previous: 45, ciLow: null, ciHigh: null },
      )

    send(undefined)
    send(1)
    send(3)

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3))
    const texts = vi.mocked(fetch).mock.calls.map(
      (c) => JSON.parse(c[1]!.body as string).text as string,
    )
    expect(texts[0]).toContain('match 72%')
    expect(texts[0]).not.toContain('articles ·')
    expect(texts[1]).not.toContain('articles ·')
    expect(texts[2]).toContain('3 articles · match 72%')
  })
})

/**
 * Every message is sent with `parse_mode: 'HTML'`, so any dynamic value that
 * reaches the message must have `<`, `>`, `&`, `"` escaped — otherwise a
 * headline like "AT&T settles" or a `?a=1&b=2` tracking URL breaks Telegram's
 * parser and the message silently fails to send (confirmed live against the
 * real Telegram API before this fix).
 */
describe('HTML escaping', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
    process.env.TELEGRAM_BOT_TOKEN = 'test-token'
    process.env.TELEGRAM_CHAT_ID = '-100123'
    process.env.APP_ENV = 'production'
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, result: { message_id: 555 } }),
    } as Response)
    mockFindUnique.mockReset().mockResolvedValue({ telegramMessageId: null, telegramChatId: null })
    mockUpdate.mockReset().mockResolvedValue({})
  })

  afterEach(() => {
    process.env = originalEnv
    vi.restoreAllMocks()
  })

  async function sentText(): Promise<string> {
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    return JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string).text
  }

  it('escapes an "&" in the claim text so it cannot break the surrounding quotes', async () => {
    notifyForecastPublished(
      { id: 'p1', claimText: 'Will AT&T settle by 2027?' },
      { name: 'Mark', username: 'mark' },
    )
    const text = await sentText()
    expect(text).toContain('Will AT&amp;T settle by 2027?')
    expect(text).not.toContain('AT&T settle') // the raw, unescaped form must not appear
  })

  it('escapes a display name containing HTML metacharacters', async () => {
    notifyForecastPublished(
      { id: 'p1', claimText: 'x' },
      { name: 'Mark <admin>', username: null },
    )
    const text = await sentText()
    expect(text).toContain('by Mark &lt;admin&gt;')
  })

  it('escapes a free-text commitment choice label', async () => {
    notifyNewCommitment(
      { id: 'p1', claimText: 'x' },
      { name: 'M', username: null },
      10,
      'Team A & Team B',
    )
    const text = await sentText()
    expect(text).toContain('Team A &amp; Team B')
  })

  it('escapes comment text', async () => {
    notifyNewComment(
      { id: 'p1', claimText: 'x' },
      { name: 'M', username: null },
      'I <3 this & disagree',
    )
    const text = await sentText()
    expect(text).toContain('I &lt;3 this &amp; disagree')
  })

  it('escapes the article URL used as an href attribute value — the reported live bug', async () => {
    notifyNewsArticleMatched(
      { id: 'p1', claimText: 'x' },
      { title: 'Headline', url: 'https://example.com/a?utm_source=x&utm_medium=y', source: null },
      { similarity: 0.5 },
      { probability: 58, previous: null, ciLow: null, ciHigh: null },
    )
    const text = await sentText()
    expect(text).toContain('href="https://example.com/a?utm_source=x&amp;utm_medium=y"')
    expect(text).not.toContain('utm_source=x&utm_medium=y') // raw "&" must not reach Telegram
  })

  it('escapes the article title and source name', async () => {
    notifyNewsArticleMatched(
      { id: 'p1', claimText: 'x' },
      { title: 'Israel & Hezbollah agree terms', url: 'https://e.com/a', source: 'AT&T News' },
      { similarity: 0.5 },
      { probability: 58, previous: null, ciLow: null, ciHigh: null },
    )
    const text = await sentText()
    expect(text).toContain('Israel &amp; Hezbollah agree terms')
    expect(text).toContain('AT&amp;T News')
  })

  it('escapes an attacker-controlled request path', async () => {
    notifySecurityError('/api/x?q=<script>alert(1)</script>', 403, 'blocked')
    const text = await sentText()
    expect(text).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(text).not.toContain('<script>')
  })

  it('truncates the raw text first, then escapes — so the length limit applies to real characters, not entity-expanded ones', async () => {
    // 120-char limit; padding puts the "&" exactly at the cut point. If escaping
    // ran before truncating, the entity-expanded "&amp;" (5 chars) would shift
    // where the cut lands and could split an entity in half.
    const claimText = 'A'.repeat(119) + '&' + 'B'.repeat(20)
    notifyForecastPublished({ id: 'p1', claimText }, { name: 'M', username: null })
    const text = await sentText()
    expect(text).toContain('A'.repeat(119) + '&amp;...')
    expect(text).not.toContain('B') // everything past the raw 120-char cut is gone
  })
})
