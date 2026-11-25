import { STANDARD_TAGS } from '@/lib/constants'
import { tagSlug } from '@/lib/utils/tag-slug'

/**
 * The feed's topic filter (daatan#2330): the standard tags, keyed by slug so a tag stored
 * as "politics" still counts as the "Politics" topic. Client-safe: no DB access here.
 */
export const TOPIC_SLUGS: readonly string[] = STANDARD_TAGS.map(tagSlug)

const TOPIC_BY_SLUG = new Map(STANDARD_TAGS.map(name => [tagSlug(name), name]))

/** The standard topic name for any spelling of it ("politics" → "Politics"), or null. */
export function standardTopic(name: string): string | null {
  return TOPIC_BY_SLUG.get(tagSlug(name)) ?? null
}

/** Open-forecast count per topic slug. Empty when the counts are unavailable. */
export type TopicCounts = Readonly<Record<string, number>>

/**
 * Chip order: the selected topics first (in the order they were picked), then the rest by
 * open forecasts, most first. A topic with no open forecasts is hidden unless selected.
 * Without counts every topic shows, in the standard order.
 */
export function orderTopics(selected: readonly string[], counts: TopicCounts): string[] {
  const picked = selected.filter(t => TOPIC_BY_SLUG.has(tagSlug(t)))
  const haveCounts = Object.keys(counts).length > 0
  const rest = STANDARD_TAGS
    .filter(t => !picked.includes(t))
    .map((name, i) => ({ name, i, n: counts[tagSlug(name)] ?? 0 }))
    .filter(({ n }) => !haveCounts || n > 0)
    .sort((a, b) => b.n - a.n || a.i - b.i)
    .map(({ name }) => name)
  return [...picked, ...rest]
}
