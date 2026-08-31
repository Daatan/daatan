import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { notifyNewsArticleMatched, SHADOW_MARKER } from '@/lib/services/telegram'

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

  it('reports the move, and what the article said (stance/relevance) as table rows', async () => {
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
    expect(msg).toContain('<blockquote>') // quote-bar panel, not <pre> (no "copy code" chrome)
    expect(msg).not.toContain('<pre>')
    expect(msg).toContain('<b>stance</b>  -0.72') // signed: reads as "argues NO"
    expect(msg).toContain('<b>relevance</b>  0.80')
    expect(msg).toContain('<b>range</b>  55–85%')
    // The embedding cosine is routing metadata, not evidence — no longer a row (daatan#1661).
    expect(msg).not.toContain('match')
    expect(msg).not.toContain('37%')
    // No shadow fields supplied → no "not in estimate" section either.
    expect(msg).not.toContain(SHADOW_MARKER)
  })

  it("shows the extractor's certainty alongside stance when known", async () => {
    await notifyNewsArticleMatched(
      PREDICTION,
      { title: 'T', url: 'https://x.com/a', source: 'Ynet', stance: -0.72, certainty: 0.77 },
      MATCH,
      ESTIMATE,
    )
    expect(sentMessage()).toContain('<b>stance</b>  -0.72 (cert 0.77)')
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
    expect(sentMessage()).toContain('<b>stance</b>  +0.42')
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
    // Only the live `range` row is left (ESTIMATE carries a CI) — no shadow section.
    expect(msg).toContain('<b>range</b>')
    expect(msg).not.toContain(SHADOW_MARKER)
  })

  it('omits the panel entirely when no row rendered', async () => {
    await notifyNewsArticleMatched(
      PREDICTION,
      { title: 'T', url: 'https://x.com/a', source: 'Ynet' },
      MATCH,
      { probability: 71, previous: 63, ciLow: null, ciHigh: null },
    )
    expect(sentMessage()).not.toContain('<blockquote>')
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
        consensusView: 'expects_no',
        reportKind: 'level',
      },
      MATCH,
      ESTIMATE,
    )

    const msg = sentMessage()
    expect(msg).toContain('<b>author_lean</b>  +0.60 (cert 0.80)')
    expect(msg).toContain('<b>fact_signal</b>  +0.30')
    expect(msg).toContain('<b>credibility</b>  1.24')
    expect(msg).toContain('<b>class</b>  reporting')
    expect(msg).toContain('<b>consensus</b>  expects_no')
    expect(msg).toContain('<b>report_kind</b>  level')
  })

  it('reports reader_confidence with its trap, and the trap is what makes the row worth a line', async () => {
    // retro#681. `reader` answers a different question from the `cert` on `stance`: that one is
    // how firmly the SOURCE commits, this one is how sure the extractor is it read the sentence
    // right. The trap names WHICH misreading was a risk, so it rides in the same row — "medium"
    // alone is noise.
    await notifyNewsArticleMatched(
      PREDICTION,
      {
        title: 'T',
        url: 'https://x.com/a',
        source: 'Ynet',
        readerConfidence: { level: 'low', trap: 'negation' },
      },
      MATCH,
      ESTIMATE,
    )
    expect(sentMessage()).toContain('<b>reader</b>  low (negation)')
  })

  it('omits the trap when none applied, and the whole row when there is no level', async () => {
    await notifyNewsArticleMatched(
      PREDICTION,
      { title: 'T', url: 'https://x.com/a', source: 'Ynet', readerConfidence: { level: 'high' } },
      MATCH,
      ESTIMATE,
    )
    expect(sentMessage()).toContain('<b>reader</b>  high')

    vi.mocked(global.fetch).mockClear()
    await notifyNewsArticleMatched(
      PREDICTION,
      { title: 'T', url: 'https://x.com/a', source: 'Ynet', stance: 0.5, readerConfidence: { trap: 'negation' } },
      MATCH,
      ESTIMATE,
    )
    expect(sentMessage()).not.toContain('<b>reader</b>')
  })

  it('renders a stated level as a bare figure, and a bound with its operator', async () => {
    // retro#683. "= 214 daily departures" reads like an assertion about the QUESTION; the
    // article said "214 daily departures". The operator only earns its place when the article
    // actually asserted a bound.
    await notifyNewsArticleMatched(
      PREDICTION,
      {
        title: 'T',
        url: 'https://x.com/a',
        source: 'Ynet',
        quantity: { value: 214, unit: 'daily departures', comparator: '=' },
      },
      MATCH,
      ESTIMATE,
    )
    expect(sentMessage()).toContain('<b>quantity</b>  214 daily departures')

    vi.mocked(global.fetch).mockClear()
    await notifyNewsArticleMatched(
      PREDICTION,
      {
        title: 'T',
        url: 'https://x.com/a',
        source: 'Ynet',
        quantity: { value: 40, unit: 'million tonnes', comparator: '<', as_of: '2026-06-30' },
      },
      MATCH,
      ESTIMATE,
    )
    expect(sentMessage()).toContain('<b>quantity</b>  &lt; 40 million tonnes @ 2026-06-30')
  })

  it('renders a range with both bounds, and falls back to one when the upper is missing', async () => {
    await notifyNewsArticleMatched(
      PREDICTION,
      {
        title: 'T',
        url: 'https://x.com/a',
        source: 'Ynet',
        quantity: { value: 1.8, unit: 'million containers', comparator: 'between', value_hi: 2.2 },
      },
      MATCH,
      ESTIMATE,
    )
    expect(sentMessage()).toContain('<b>quantity</b>  1.8\u20132.2 million containers')

    vi.mocked(global.fetch).mockClear()
    await notifyNewsArticleMatched(
      PREDICTION,
      {
        title: 'T',
        url: 'https://x.com/a',
        source: 'Ynet',
        quantity: { value: 1.8, unit: 'million containers', comparator: 'between' },
      },
      MATCH,
      ESTIMATE,
    )
    // Never "between 1.8 and undefined" — a range without its upper bound is not a range.
    expect(sentMessage()).toContain('<b>quantity</b>  1.8 million containers')
  })

  it('prints value and unit exactly as extracted, without recombining them', async () => {
    // The live-data caveat from retro#683: the SAME figure comes back as
    // 452 / "thousand active US Army personnel" and as 452000 / "active US Army personnel".
    // Both obey the field description and neither normalises to the other, so the renderer
    // must not try — folding either way prints a number the article never wrote.
    await notifyNewsArticleMatched(
      PREDICTION,
      {
        title: 'T',
        url: 'https://x.com/a',
        source: 'Ynet',
        quantity: { value: 452, unit: 'thousand active US Army personnel', comparator: '=' },
      },
      MATCH,
      ESTIMATE,
    )
    const msg = sentMessage()
    expect(msg).toContain('<b>quantity</b>  452 thousand active US Army personnel')
    expect(msg).not.toContain('452000')
  })

  it('renders grounds as the spelled-out kind, with the basis phrase when the claim named one', async () => {
    // retro#763. The kind is a category a rater checks at a glance; the basis is the half that
    // says whether two articles are repeating ONE reason, so it rides in the same row.
    await notifyNewsArticleMatched(
      PREDICTION,
      {
        title: 'T',
        url: 'https://x.com/a',
        source: 'Ynet',
        grounds: { kind: 'authority_asserted', basis: "the ministry's 12 March statement" },
      },
      MATCH,
      ESTIMATE,
    )
    expect(sentMessage()).toContain("<b>grounds</b>  authority asserted · the ministry's 12 March statement")

    vi.mocked(global.fetch).mockClear()
    await notifyNewsArticleMatched(
      PREDICTION,
      { title: 'T', url: 'https://x.com/a', source: 'Ynet', grounds: { kind: 'writer_assertion' } },
      MATCH,
      ESTIMATE,
    )
    expect(sentMessage()).toContain('<b>grounds</b>  writer assertion')

    vi.mocked(global.fetch).mockClear()
    await notifyNewsArticleMatched(
      PREDICTION,
      { title: 'T', url: 'https://x.com/a', source: 'Ynet', stance: 0.5, grounds: { basis: 'a phrase with no kind' } },
      MATCH,
      ESTIMATE,
    )
    expect(sentMessage()).not.toContain('<b>grounds</b>')
  })

  it('marks the shadow-lane rows as not read by the estimate, below the live rows', async () => {
    // daatan#1661: a rater must be able to tell "this number moved the forecast" from "this
    // number is captured for later". The marker sits between the two groups, once.
    await notifyNewsArticleMatched(
      PREDICTION,
      { title: 'T', url: 'https://x.com/a', source: 'Ynet', stance: 0.5, relevance: 0.9, authorLean: 0.6, evidenceClass: 'opinion' },
      MATCH,
      ESTIMATE,
    )
    const msg = sentMessage()
    const panel = msg.slice(msg.indexOf('<blockquote>'), msg.indexOf('</blockquote>'))
    const marker = panel.indexOf(SHADOW_MARKER)
    expect(marker).toBeGreaterThan(0)
    expect(panel.split(SHADOW_MARKER)).toHaveLength(2)
    expect(panel.indexOf('<b>stance</b>')).toBeLessThan(marker)
    expect(panel.indexOf('<b>relevance</b>')).toBeLessThan(marker)
    expect(panel.indexOf('<b>range</b>')).toBeLessThan(marker)
    expect(panel.indexOf('<b>author_lean</b>')).toBeGreaterThan(marker)
    expect(panel.indexOf('<b>class</b>')).toBeGreaterThan(marker)
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
    expect(msg).toContain('<b>fact_signal</b>  -0.45')
    expect(msg).not.toContain('author_lean')
    expect(msg).not.toContain('credibility')
  })

  it('puts evidence volume in the header: pool size when known, bare count for a multi-article push', async () => {
    await notifyNewsArticleMatched(
      PREDICTION,
      { title: 'T', url: 'https://x.com/a', source: 'Ynet' },
      { similarity: 0.368, articleCount: 3, poolSize: 22 },
      ESTIMATE,
    )
    expect(sentMessage()).toContain('Oracle 63% → 71%</b>  (+8) · 3 new / 22 in pool')

    // No pool (single-run fallback): only a multi-article push shows a count at all.
    vi.mocked(global.fetch).mockClear()
    await notifyNewsArticleMatched(
      PREDICTION,
      { title: 'T', url: 'https://x.com/a', source: 'Ynet' },
      { similarity: 0.368, articleCount: 3 },
      ESTIMATE,
    )
    expect(sentMessage()).toContain('· 3 articles')

    vi.mocked(global.fetch).mockClear()
    await notifyNewsArticleMatched(PREDICTION, { title: 'T', url: 'https://x.com/a', source: 'Ynet' }, MATCH, ESTIMATE)
    expect(sentMessage()).not.toContain('articles')
  })

  it('says how much of the pool was actually readable, not just how big it is (daatan#1475)', async () => {
    // 46% of pool rows are FAILED in production, so a bare "22 in pool" reads as roughly
    // twice the evidence the number was computed from. The header quotes both.
    await notifyNewsArticleMatched(
      PREDICTION,
      { title: 'T', url: 'https://x.com/a', source: 'Ynet' },
      { similarity: 0.368, articleCount: 3, poolSize: 22, usableSize: 9 },
      ESTIMATE,
    )
    expect(sentMessage()).toContain('· 3 new / 9 of 22 usable in pool')
  })

  it('falls back to the bare pool size when usability was not resolved', async () => {
    // The single-run path reports no pool composition at all; it must not print
    // "null of 22".
    await notifyNewsArticleMatched(
      PREDICTION,
      { title: 'T', url: 'https://x.com/a', source: 'Ynet' },
      { similarity: 0.368, articleCount: 3, poolSize: 22, usableSize: null },
      ESTIMATE,
    )
    expect(sentMessage()).toContain('· 3 new / 22 in pool')
  })

  it('reports an all-unreadable pool as zero rather than hiding it', async () => {
    // The forecast this whole issue is about: a pool that exists and holds nothing.
    await notifyNewsArticleMatched(
      PREDICTION,
      { title: 'T', url: 'https://x.com/a', source: 'Ynet' },
      { similarity: 0.368, articleCount: 1, poolSize: 14, usableSize: 0 },
      ESTIMATE,
    )
    expect(sentMessage()).toContain('· 1 new / 0 of 14 usable in pool')
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
        [{ text: '❓ What do these numbers mean?', url: 'http://localhost:3000/help/rating-numbers' }],
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
