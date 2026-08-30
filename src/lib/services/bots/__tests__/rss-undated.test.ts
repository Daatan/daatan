import { describe, it, expect } from 'vitest'

import { parsePublishedAt, detectHotTopics, type RssItem } from '../rss'

const item = (title: string, source: string, publishedAt: Date | null): RssItem => ({
  title,
  url: `https://example.com/${encodeURIComponent(title)}`,
  source,
  publishedAt,
})

describe('parsePublishedAt (daatan#1679)', () => {
  it('returns null for an absent date rather than the current time', () => {
    expect(parsePublishedAt(undefined)).toBeNull()
    expect(parsePublishedAt(null)).toBeNull()
    expect(parsePublishedAt('')).toBeNull()
  })

  it('returns null for an unparseable date', () => {
    expect(parsePublishedAt('not-a-date')).toBeNull()
  })

  it('parses a real date', () => {
    expect(parsePublishedAt('2022-12-29T00:00:00Z')?.toISOString()).toBe('2022-12-29T00:00:00.000Z')
  })
})

describe('detectHotTopics fails closed on undated items (daatan#1679)', () => {
  const now = Date.now()
  const fresh = new Date(now - 60 * 60 * 1000)

  it('drops undated items instead of treating them as just-published', () => {
    const topics = detectHotTopics(
      [
        item('Netanyahu returns as prime minister', 'a.com', null),
        item('Netanyahu returns as prime minister', 'b.com', null),
      ],
      2,
      24,
    )

    expect(topics).toEqual([])
  })

  it('still clusters dated items inside the window', () => {
    const topics = detectHotTopics(
      [
        item('Netanyahu returns as prime minister', 'a.com', fresh),
        item('Netanyahu returns as prime minister', 'b.com', fresh),
      ],
      2,
      24,
    )

    expect(topics).toHaveLength(1)
    expect(topics[0].sourceCount).toBe(2)
  })

  it('does not let an undated item make up the source count for a real story', () => {
    const topics = detectHotTopics(
      [
        item('Netanyahu returns as prime minister', 'a.com', fresh),
        item('Netanyahu returns as prime minister', 'b.com', null),
      ],
      2,
      24,
    )

    expect(topics).toEqual([])
  })
})
