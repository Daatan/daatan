/**
 * Question-form framing + FAQPage JSON-LD builders for natural-language search
 * intent (daatan#1295, mirrors elections#116's src/lib/elections/seo-schema.ts).
 * Pure — pages fetch data + translated copy strings and pass them in.
 *
 * The question template wraps the claim rather than rewriting it: claims are
 * full declarative sentences ("Bitcoin will hit $100k by …"), so "What are the
 * chances that <claim>?" is grammatical for any claim, where a real per-claim
 * rewrite ("Will Bitcoin hit $100k…?") would need per-claim authoring. Resolved
 * forecasts get past-tense framing ("Did this come true: …?") so a settled
 * question never reads as still open.
 */

const RESOLVED_STATUSES = new Set(['RESOLVED_CORRECT', 'RESOLVED_WRONG'])

export type ForecastSeoLocale = 'en' | 'he' | 'ru'

const DATE_LOCALES: Record<ForecastSeoLocale, string> = {
  en: 'en-US',
  he: 'he-IL',
  ru: 'ru-RU',
}

export interface ForecastSeoCopy {
  questionOpen: string
  questionResolved: string
  answerAiEstimate: string
  answerCommunity: string
  answerAsOf: string
  answerResolvedYes: string
  answerResolvedWrong: string
  answerNoEstimate: string
  statusVoid: string
  statusUnresolvable: string
}

export interface ForecastSeoInput {
  locale: ForecastSeoLocale
  /** Claim text already resolved to the page's language by the caller. */
  claim: string
  status: string
  aiProbability: number | null
  communityProbability: number | null
  /** ISO timestamp of the latest probability update, if any. */
  lastUpdatedISO: string | null
}

function cleanClaim(claim: string): string {
  return claim.trim().replace(/[.\s]+$/, '')
}

function formatDate(iso: string, locale: ForecastSeoLocale): string {
  return new Date(iso).toLocaleDateString(DATE_LOCALES[locale], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export function forecastQuestion(
  copy: ForecastSeoCopy,
  locale: ForecastSeoLocale,
  claim: string,
  status: string,
): string {
  const c = cleanClaim(claim)
  if (RESOLVED_STATUSES.has(status)) {
    return `${copy.questionResolved} ${c}?`
  }
  // Hebrew's ש is a clitic — it attaches directly to the next word, no space.
  return locale === 'he' ? `${copy.questionOpen}${c}?` : `${copy.questionOpen} ${c}?`
}

export function forecastAnswer(copy: ForecastSeoCopy, input: ForecastSeoInput): string {
  if (input.status === 'RESOLVED_CORRECT') return copy.answerResolvedYes
  if (input.status === 'RESOLVED_WRONG') return copy.answerResolvedWrong
  if (input.status === 'VOID') return `${copy.statusVoid}.`
  if (input.status === 'UNRESOLVABLE') return `${copy.statusUnresolvable}.`

  const parts: string[] = []
  if (input.aiProbability != null) parts.push(`${copy.answerAiEstimate} ${Math.round(input.aiProbability)}%`)
  if (input.communityProbability != null) {
    parts.push(`${copy.answerCommunity} ${Math.round(input.communityProbability)}%`)
  }
  if (parts.length === 0) return copy.answerNoEstimate

  const body = parts.join('; ')
  const asOf = input.lastUpdatedISO
    ? `${copy.answerAsOf} ${formatDate(input.lastUpdatedISO, input.locale)}: `
    : ''
  return `${asOf}${body}.`
}

/** FAQPage wrapping the one question this page answers. FAQPage subtypes
 *  CreativeWork, so dateModified is valid schema.org here — that plus the
 *  visible "updated" line are the freshness signals #1295 asks for. */
export function forecastFaqJsonLd(copy: ForecastSeoCopy, input: ForecastSeoInput): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    ...(input.lastUpdatedISO ? { dateModified: input.lastUpdatedISO } : {}),
    mainEntity: [
      {
        '@type': 'Question',
        name: forecastQuestion(copy, input.locale, input.claim, input.status),
        acceptedAnswer: { '@type': 'Answer', text: forecastAnswer(copy, input) },
      },
    ],
  }
}

/**
 * The true "last probability update" timestamp: the latest ContextSnapshot
 * that carried an externalProbability (ascending-ordered chart data — take the
 * tail), falling back to the row's own updatedAt. Prisma's `@updatedAt` bumps
 * on ANY field change (a comment count, a translation cache write), so it's
 * not by itself an accurate probability-freshness signal.
 */
export function latestProbabilityUpdateISO(
  updatedAt: Date | string,
  probabilityHistory: { createdAt: string }[],
): string {
  const latestSnapshot = probabilityHistory[probabilityHistory.length - 1]?.createdAt
  if (latestSnapshot) return latestSnapshot
  return typeof updatedAt === 'string' ? updatedAt : updatedAt.toISOString()
}
