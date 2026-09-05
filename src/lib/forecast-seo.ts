const META_DESCRIPTION_MAX = 158

interface ForecastDescriptionCtx {
  resolveByDatetime?: string | Date
  commitmentCount?: number
  resolution?: { outcome: string; resolvedAt: string | Date }
}

export function buildForecastDescription(
  claimText: string,
  detailsText: string | null | undefined,
  ctx?: ForecastDescriptionCtx,
): string {
  const parts: string[] = []

  if (ctx?.resolution) {
    const { outcome, resolvedAt } = ctx.resolution
    const d = new Date(resolvedAt)
    const label = outcome.charAt(0).toUpperCase() + outcome.slice(1)
    parts.push(
      `Resolved as ${label} on ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`,
    )
  }

  const trimmedDetails = detailsText?.trim()
  if (trimmedDetails && trimmedDetails.length >= 30) {
    parts.push(trimmedDetails)
    return truncate(parts.join('. '), META_DESCRIPTION_MAX)
  }

  parts.push(claimText)

  if (ctx && !ctx.resolution) {
    if (ctx.commitmentCount) {
      parts.push(`${ctx.commitmentCount} forecaster${ctx.commitmentCount !== 1 ? 's' : ''} have committed`)
    }
    if (ctx.resolveByDatetime) {
      const d = new Date(ctx.resolveByDatetime)
      parts.push(`resolves ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`)
    }
  }

  if (parts.length > 1) {
    return truncate(parts.join('. '), META_DESCRIPTION_MAX)
  }

  return truncate(claimText, META_DESCRIPTION_MAX)
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max - 1).trimEnd() + '…'
}

// ---------------------------------------------------------------------------
// <meta name="keywords">
//
// Google ignores the tag and Bing treats stuffed lists as a spam signal, so the
// lists stay short (≤ KEYWORDS_MAX) and specific. Yandex still documents it as a
// possible relevance signal, and the RU audience is real (docs/seo.md, tier 6),
// which is why it exists at all. Strategy + tiers: Daatan/docs seo.md.
// ---------------------------------------------------------------------------

export type KeywordLocale = 'en' | 'he' | 'ru'

const KEYWORDS_MAX = 10

/** Site-wide set, per locale. Root layout uses `en`; `[locale]` pages pick theirs. */
export const GLOBAL_KEYWORDS: Record<KeywordLocale, readonly string[]> = {
  en: [
    'forecasting platform',
    'news forecasts',
    'prediction track record',
    'forecast accuracy',
    'calibrated forecasts',
    'Brier score',
    'forecaster leaderboard',
    'who predicted correctly',
  ],
  he: [
    'פלטפורמת תחזיות',
    'תחזיות חדשות',
    'רקורד תחזיות',
    'דיוק תחזיות',
    'ציון ברייר',
    'דירוג חוזים',
    'מי חזה נכון',
  ],
  ru: [
    'платформа прогнозов',
    'прогнозы новостей',
    'точность прогнозов',
    'калиброванные прогнозы',
    'оценка Брайера',
    'рейтинг прогнозистов',
    'кто предсказал правильно',
  ],
}

export function globalKeywords(locale: string): string[] {
  return [...(GLOBAL_KEYWORDS[locale as KeywordLocale] ?? GLOBAL_KEYWORDS.en)]
}

/** Per-forecast keywords that a page can carry on top of the locale globals. */
const PER_FORECAST_GLOBALS: Record<KeywordLocale, readonly string[]> = {
  en: ['forecast', 'prediction'],
  he: ['תחזית', 'חיזוי'],
  ru: ['прогноз', 'предсказание'],
}

// Capitalised words that are not entities when they stand alone.
const CLAIM_STOPWORDS = new Set([
  'a', 'an', 'the', 'will', 'by', 'on', 'in', 'at', 'of', 'to', 'for', 'and', 'or',
  'not', 'be', 'is', 'are', 'was', 'were', 'before', 'after', 'until', 'than', 'least',
  'end', 'more', 'less', 'no', 'yes', 'this', 'that', 'its', 'their', 'over',
  'under', 'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
  'september', 'october', 'november', 'december', 'q1', 'q2', 'q3', 'q4',
  // Russian: sentence-initial verbs/particles and month names are capitalised too.
  'будет', 'будут', 'ли', 'станет', 'останется', 'сможет', 'к', 'в', 'до', 'на', 'по',
  'и', 'или', 'не', 'что', 'кто', 'когда', 'января', 'февраля', 'марта', 'апреля', 'мая',
  'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
])
// Lower-case connectors allowed *inside* a multi-word entity ("Winds of Winter").
const ENTITY_CONNECTORS = new Set(['of', 'the', 'and', 'de', 'la', 'al', 'von', 'van', 'du'])

/**
 * Proper-noun runs from a claim: consecutive capitalised tokens, optionally joined
 * by a connector ("George RR Martin", "The Winds of Winter", "Saudi Arabia").
 * Purely orthographic, so it does nothing useful for Hebrew (no case) — callers
 * fall back to tags there. Numbers and dates are dropped.
 */
export function extractClaimEntities(claim: string): string[] {
  const tokens = claim.replace(/[“”"'’(),;:!?]/g, ' ').split(/\s+/).filter(Boolean)
  const out: string[] = []
  let run: string[] = []
  let runStartsSentence = false
  const isCap = (t: string) => /^\p{Lu}/u.test(t) && !/\d/.test(t)
  const flush = () => {
    // Trailing connectors ("... of") and leading capitalised stopwords ("Will Saudi
    // Arabia") are sentence grammar, not part of the name. A leading "The" survives
    // inside a title ("The Winds of Winter") but not at sentence start ("The US").
    while (run.length && ENTITY_CONNECTORS.has(run[run.length - 1].toLowerCase())) run.pop()
    while (run.length) {
      const head = run[0].toLowerCase()
      if (!CLAIM_STOPWORDS.has(head)) break
      if (head === 'the' && !runStartsSentence) break
      run.shift()
    }
    if (run.length && !(run.length === 1 && run[0].length < 2)) {
      const phrase = run.join(' ')
      if (!out.includes(phrase)) out.push(phrase)
    }
    run = []
  }
  tokens.forEach((t, i) => {
    const bare = t.replace(/\.$/, '')
    if (isCap(bare)) {
      if (!run.length) runStartsSentence = i === 0
      run.push(bare)
    } else if (run.length && ENTITY_CONNECTORS.has(bare.toLowerCase())) {
      run.push(bare)
    } else {
      flush()
    }
  })
  flush()
  return out
}

/**
 * Keywords for one forecast page: tag names first (curated, highest signal),
 * then entities lifted from the claim(s) — pass the translated claim first and the
 * English one second so a RU page leads with Cyrillic names — then locale generics.
 * Deduped case-insensitively and capped, so a stuffed list is impossible.
 */
export function buildForecastKeywords(
  claimText: string | readonly string[],
  tags: ReadonlyArray<{ name: string }>,
  locale: string = 'en',
): string[] {
  const loc = (locale in PER_FORECAST_GLOBALS ? locale : 'en') as KeywordLocale
  const seen = new Set<string>()
  const out: string[] = []
  const push = (k: string) => {
    const v = k.trim()
    const key = v.toLowerCase()
    if (!v || seen.has(key) || out.length >= KEYWORDS_MAX) return
    seen.add(key)
    out.push(v)
  }
  tags.forEach((t) => push(t.name))
  const claims = typeof claimText === 'string' ? [claimText] : claimText
  claims.forEach((c) => extractClaimEntities(c).forEach(push))
  PER_FORECAST_GLOBALS[loc].forEach(push)
  return out
}
