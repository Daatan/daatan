import { getTranslations } from 'next-intl/server'
import { standardTopic } from '@/lib/topics'
import { tagSlug } from '@/lib/utils/tag-slug'

/**
 * Server-side twin of `useTopicLabel`: standard topics in the reader's language, any other tag
 * as stored (daatan#2333; the landing renders its own topic chips).
 */
export async function getTopicLabel(locale: string): Promise<(name: string) => string> {
  const t = await getTranslations({ locale, namespace: 'topics.names' })
  return (name: string) => {
    const topic = standardTopic(name)
    return topic ? t(tagSlug(topic)) : name
  }
}
