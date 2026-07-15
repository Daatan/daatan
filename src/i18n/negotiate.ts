import { locales, type Locale } from './config'

/**
 * Picks the best supported locale from an Accept-Language header.
 * Respects q-values and matches on the base language (he-IL → he).
 * Returns null when nothing matches.
 */
export function negotiateLocale(header: string | null | undefined): Locale | null {
  if (!header) return null

  const ranges = header
    .split(',')
    .map((part) => {
      const [tag = '', ...params] = part.trim().split(';')
      const qParam = params.map((p) => p.trim()).find((p) => p.startsWith('q='))
      const q = qParam ? Number.parseFloat(qParam.slice(2)) : 1
      return { tag: tag.trim().toLowerCase(), q }
    })
    .filter(({ tag, q }) => tag !== '' && tag !== '*' && Number.isFinite(q) && q > 0)
    .sort((a, b) => b.q - a.q)

  for (const { tag } of ranges) {
    const base = tag.split('-')[0] as Locale
    if (locales.includes(base)) return base
  }
  return null
}
