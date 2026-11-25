/** Languages news-indexer accepts for an outlet's display name and description. */
export const IDENTITY_LANGS = ['en', 'he', 'ru', 'eo'] as const

/** Text keyed by language (`en`, `he`, `ru`, `eo`), any subset (news-indexer#557). */
export type LocalizedText = Partial<Record<string, string>>

/** `text` in `locale`, else English, else any language it has; null when it has none. */
export function localizedText(text: LocalizedText, locale: string): string | null {
  return text[locale] || text.en || Object.values(text).find(Boolean) || null
}

/** news-indexer stores a channel either as a handle (`ynetnews`, `@ynetnews`) or as a full
 *  `https://t.me/...` URL; prefixing the URL form produced `https://t.me/https://t.me/...`. */
export function telegramHref(channel: string): string {
  return /^https?:\/\//.test(channel) ? channel : `https://t.me/${channel.replace(/^@/, '')}`
}
