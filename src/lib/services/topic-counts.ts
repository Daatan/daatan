import { unstable_cache } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'
import { TOPIC_SLUGS, type TopicCounts } from '@/lib/topics'

const log = createLogger('topic-counts')

const fetchOpenTopicCounts = unstable_cache(
  async (): Promise<Record<string, number>> => {
    const tags = await prisma.tag.findMany({
      where: { slug: { in: [...TOPIC_SLUGS] } },
      select: { slug: true, _count: { select: { predictions: { where: { status: 'ACTIVE', isPublic: true } } } } },
    })
    return Object.fromEntries(tags.map(tag => [tag.slug, tag._count.predictions]))
  },
  ['open-topic-counts'],
  { revalidate: 300, tags: ['forecasts'] },
)

/**
 * Open public forecasts per standard topic (slug → count), for ordering the feed's topic chips
 * (daatan#2330). Empty on a DB error, which makes the filter show every topic in standard order.
 */
export async function getOpenTopicCounts(): Promise<TopicCounts> {
  try {
    return await fetchOpenTopicCounts()
  } catch (err) {
    log.warn({ err }, 'Failed to count open forecasts per topic')
    return {}
  }
}
