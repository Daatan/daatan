/**
 * daatan#1679 item 5 — the copy-down decision.
 *
 * Every branch here is a way to make the corpus worse if it fires on the wrong row, so these
 * tests are mostly about what the pass declines to touch.
 */

import { describe, it, expect } from 'vitest'
import { decideCopyDown } from '../../scripts/copy-down-published-dates'

const FABRICATED = '2026-07-11T19:05:56.938135+00:00'

describe('decideCopyDown', () => {
  it('copies a repaired date down with its provenance', () => {
    const d = decideCopyDown(FABRICATED, { publishedAt: '2022-12-29T00:00:00+00:00', publishedAtSource: 'page' })

    expect(d.action).toBe('copied')
    expect(d.data).toEqual({ publishedDate: '2022-12-29T00:00:00+00:00', publishedDateSource: 'page' })
  })

  it('accepts a date recovered by the archive backfill', () => {
    const d = decideCopyDown(FABRICATED, { publishedAt: '2025-02-28T00:00:00+00:00', publishedAtSource: 'archive' })

    expect(d.action).toBe('copied')
    expect(d.data).toMatchObject({ publishedDateSource: 'archive' })
  })

  it('leaves a PUSHED article\'s date alone', () => {
    // Telegram and X posts have no page to read a date off, so post time IS crawl time and the
    // sub-second signature is a false positive — ~431 rows. "Repairing" these would replace a
    // correct date with an older one. This branch is the whole reason item 2 had to land first.
    const d = decideCopyDown(FABRICATED, { publishedAt: '2026-07-11T19:05:00+00:00', publishedAtSource: 'pushed' })

    expect(d.action).toBe('kept_pushed')
    expect(d.data).toEqual({ publishedDateSource: 'pushed' })
    expect(d.data).not.toHaveProperty('publishedDate')
  })

  it('nulls and terminally excludes a row news-indexer cannot date either', () => {
    // ni#166 tier 3. Same treatment claimArticleForExtraction gives an undated article (#1682):
    // one we cannot date must never be able to settle anything.
    const d = decideCopyDown(FABRICATED, { publishedAt: null, publishedAtSource: null })

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
    const d = decideCopyDown(FABRICATED, undefined)

    expect(d.action).toBe('not_found')
    expect(d.data).toBeNull()
  })

  it('records provenance without rewriting an already-matching date', () => {
    const d = decideCopyDown(FABRICATED, { publishedAt: FABRICATED, publishedAtSource: 'feed' })

    expect(d.action).toBe('unchanged')
    expect(d.data).toEqual({ publishedDateSource: 'feed' })
  })

  it('still copies down from a news-indexer that reports no provenance', () => {
    // A pre-#426 news-indexer omits the field. That is "unknown", not "untrustworthy" — the
    // date is still better than the fabricated one, and null provenance says exactly that.
    const d = decideCopyDown(FABRICATED, { publishedAt: '2022-12-29T00:00:00+00:00' })

    expect(d.action).toBe('copied')
    expect(d.data).toEqual({ publishedDate: '2022-12-29T00:00:00+00:00', publishedDateSource: null })
  })
})
