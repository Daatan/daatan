'use client'

import { useTranslations } from 'next-intl'
import { standardTopic } from '@/lib/topics'
import { tagSlug } from '@/lib/utils/tag-slug'

/** Reader-language label for a tag: standard topics are translated, any other tag shows as stored. */
export function useTopicLabel(): (name: string) => string {
  const t = useTranslations('topics.names')
  return (name: string) => {
    const topic = standardTopic(name)
    return topic ? t(tagSlug(topic)) : name
  }
}
