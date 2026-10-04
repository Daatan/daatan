import { slugify } from '@/lib/utils/slugify'

export const MAX_FORECAST_TAGS = 5
export const MAX_TAG_LENGTH = 50

/**
 * Coerce an untrusted tag list (LLM output, client payload) into one the
 * forecast schema accepts: strings only, trimmed, no empties or over-long
 * entries, de-duplicated by slug (connectOrCreate keys on it), first
 * MAX_FORECAST_TAGS kept. Over-long tags are dropped rather than truncated —
 * a cut-off tag makes a garbage slug.
 */
export function normalizeForecastTags(tags: readonly unknown[] | null | undefined): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of tags ?? []) {
    if (typeof raw !== 'string') continue
    const tag = raw.trim()
    if (!tag || tag.length > MAX_TAG_LENGTH) continue
    const key = slugify(tag) || tag.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(tag)
    if (out.length === MAX_FORECAST_TAGS) break
  }
  return out
}
