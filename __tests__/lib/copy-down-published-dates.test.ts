/**
 * daatan#1679 item 5 — the copy-down decision.
 *
 * Every branch here is a way to make the corpus worse if it fires on the wrong row, so these
 * tests are mostly about what the pass declines to touch.
 */

import { describe, it, expect } from 'vitest'
import { decideCopyDown } from '../../scripts/copy-down-published-dates'

const FABRICATED = '2026-07-11T19:05:56.938135+00:00'
const WEB_URL = 'https://www.eia.gov/todayinenergy/detail.php?id=56560'

describe('decideCopyDown', () => {
  it('copies a repaired date down with its provenance', () => {
    const d = decideCopyDown(FABRICATED, { publishedAt: '2022-12-29T00:00:00+00:00', publishedAtSource: 'page' }, WEB_URL)

    expect(d.action).toBe('copied')
    expect(d.data).toEqual({ publishedDate: '2022-12-29T00:00:00+00:00', publishedDateSource: 'page' })
  })

  it('accepts a date recovered by the archive backfill', () => {
    const d = decideCopyDown(FABRICATED, { publishedAt: '2025-02-28T00:00:00+00:00', publishedAtSource: 'archive' }, WEB_URL)

    expect(d.action).toBe('copied')
    expect(d.data).toMatchObject({ publishedDateSource: 'archive' })
  })

  it('leaves a PUSHED article\'s date alone', () => {
    // Telegram and X posts have no page to read a date off, so post time IS crawl time and the
    // sub-second signature is a false positive — ~431 rows. "Repairing" these would replace a
    // correct date with an older one. This branch is the whole reason item 2 had to land first.
    const d = decideCopyDown(FABRICATED, { publishedAt: '2026-07-11T19:05:00+00:00', publishedAtSource: 'pushed' }, WEB_URL)

    expect(d.action).toBe('kept_pushed')
    expect(d.data).toEqual({ publishedDateSource: 'pushed' })
    expect(d.data).not.toHaveProperty('publishedDate')
  })

  it('nulls and terminally excludes a row news-indexer cannot date either', () => {
    // ni#166 tier 3. Same treatment claimArticleForExtraction gives an undated article (#1682):
    // one we cannot date must never be able to settle anything.
    const d = decideCopyDown(FABRICATED, { publishedAt: null, publishedAtSource: null }, WEB_URL)

    expect(d.action).toBe('nulled')
    expect(d.data).toEqual({
      publishedDate: null,
      publishedDateSource: null,
      status: 'FAILED',
      statusReason: 'undated_published',
      excluded: true,
    })
  })

  it('writes nothing when news-indexer has evicted the article', () => {
    const d = decideCopyDown(FABRICATED, undefined, WEB_URL)

    expect(d.action).toBe('not_found')
    expect(d.data).toBeNull()
  })

  it('stamps a Telegram post news-indexer has no record of as pushed, keeping its date', () => {
    // /articles/by-url reads the crawl store; Telegram posts never enter it, so these come back
    // "not found" forever — 3,460/3,460 on the 2026-09-11 prod dry-run. Their dates are real
    // post times (9/9 sampled within 0.6 min of t.me's own timestamp), so only the provenance
    // is missing.
    const d = decideCopyDown(FABRICATED, undefined, 'https://t.me/hnaftali/23897')

    expect(d.action).toBe('pushed_no_meta')
    expect(d.data).toEqual({ publishedDateSource: 'pushed' })
  })

  it.each([
    'https://example.com/?ref=https://t.me/hnaftali/23897',
    'https://t.me.example.com/post/1',
    'https://not-t.me/channel/1',
    'https://x.com/someone/status/1',
  ])('does not infer pushed provenance for %s', (url) => {
    expect(decideCopyDown(FABRICATED, undefined, url)).toEqual({ action: 'not_found', data: null })
  })

  it('prefers what news-indexer reports over the URL when it does know a Telegram post', () => {
    const d = decideCopyDown(FABRICATED, { publishedAt: null, publishedAtSource: null }, 'https://t.me/hnaftali/23897')

    expect(d.action).toBe('nulled')
  })

  it('records provenance without rewriting an already-matching date', () => {
    const d = decideCopyDown(FABRICATED, { publishedAt: FABRICATED, publishedAtSource: 'feed' }, WEB_URL)

    expect(d.action).toBe('unchanged')
    expect(d.data).toEqual({ publishedDateSource: 'feed' })
  })

  it('still copies down from a news-indexer that reports no provenance', () => {
    // A pre-#426 news-indexer omits the field. That is "unknown", not "untrustworthy" — the
    // date is still better than the fabricated one, and null provenance says exactly that.
    const d = decideCopyDown(FABRICATED, { publishedAt: '2022-12-29T00:00:00+00:00' }, WEB_URL)

    expect(d.action).toBe('copied')
    expect(d.data).toEqual({ publishedDate: '2022-12-29T00:00:00+00:00', publishedDateSource: null })
  })
})
