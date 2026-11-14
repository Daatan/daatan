/**
 * Question-side threshold parse (daatan#2176, Oracle 1.5 Phase 2 item 2.5).
 *
 * Reads the numeric bar a threshold-shaped question sets ("Brent crude will
 * reach or exceed $130 per barrel…") out of the question text, as
 * `{comparator, value, unit, value_hi?}`. That is the same shape as retro's
 * claim-side `quantity` and `tm.threshold_compare.QuestionThreshold`. Sent to
 * retro as `question_quantity` on `/forecast` and `/pool/aggregate`. Its only
 * reader there is confusion-flag rule 2 (`stance_vs_quantity`), which is
 * log-only. Nothing in the estimate reads it.
 *
 * **Precision over recall.** A wrong bar makes rule 2 report contradictions
 * that are not in the claim, and a missing bar only makes it abstain. So every
 * ambiguity returns null with a reason: two bars in one sentence, "4 of the
 * seven", a bare year, a time span, a bar with no unit. The reasons are
 * logged, and the miss rate is what decides whether an LLM fallback is worth
 * its cost (not in this slice).
 *
 * Conventions, fixed here so a reader does not have to infer them:
 * - "reach", "hit", "cross" and "reach or exceed" mean `>=`. The bar itself
 *   counts, which is how these questions resolve.
 * - "over", "more than", "exceed" and "above" mean `>`.
 * - A currency symbol becomes an ISO code (`$` → `USD`). A word magnitude
 *   ("1 trillion", "$100k") is folded into `value`. The claim side is NOT
 *   normalised, so a scale mismatch makes retro's unit check abstain rather
 *   than guess.
 * - Rank phrasing ("top 10"), comparatives with no number ("more popular
 *   than…") and verbs with no comparator ("earn 30,000 shekels") have no bar,
 *   so they return null.
 *
 * A pure function of the exact string sent to retro as `question`.
 */
import { ClaimArchetype } from '@prisma/client'
import { createLogger } from '@/lib/logger'

const log = createLogger('question-quantity')

export type QuestionQuantity = {
  comparator: '=' | '<' | '<=' | '>' | '>=' | 'between'
  value: number
  unit: string
  value_hi?: number
}

export type QuestionQuantityMiss =
  | 'no_bar'
  | 'multiple_bars'
  | 'k_of_n'
  | 'year_like'
  | 'time_span'
  | 'no_unit'

export type QuestionQuantityParse =
  | { quantity: QuestionQuantity; reason: null }
  | { quantity: null; reason: QuestionQuantityMiss }

type Comparator = QuestionQuantity['comparator']

// Longest phrases first within each group. The prefix scan picks the match that
// starts earliest, so "reach or exceed" wins over "exceed" anyway. The order
// only matters for phrases that start at the same position.
const PREFIX_COMPARATORS: Array<[RegExp, Comparator]> = [
  [/reach(?:es)?\s+or\s+exceed(?:s)?/, '>='],
  [/at\s+least/, '>='],
  [/no\s+(?:less|fewer)\s+than/, '>='],
  [/a\s+minimum\s+of/, '>='],
  [/(?:reach(?:es)?|hit(?:s)?|cross(?:es)?(?:\s+the)?|(?:rise|climb)s?\s+to)/, '>='],
  [/at\s+most/, '<='],
  [/no\s+(?:more|higher)\s+than/, '<='],
  [/a\s+maximum\s+of/, '<='],
  [/(?:more|greater|higher)\s+than/, '>'],
  [/(?:over|above|exceed(?:s|ing)?|surpass(?:es)?)/, '>'],
  [/(?:less|fewer|lower)\s+than/, '<'],
  [/(?:below|under)/, '<'],
  [/exactly/, '='],
]

const POSTFIX_COMPARATORS: Array<[RegExp, Comparator]> = [
  [/^\s*or\s+(?:more|higher|above|greater)\b/, '>='],
  [/^\s*or\s+(?:less|fewer|lower|below)\b/, '<='],
]

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
}

const WORD_MAGNITUDES: Record<string, number> = {
  thousand: 1e3, million: 1e6, billion: 1e9, trillion: 1e12,
}
// Attached abbreviations ("$100k", "$2bn") only count after a currency symbol.
// Without one, "100 m" is as likely metres as millions.
const ATTACHED_MAGNITUDES: Record<string, number> = { k: 1e3, m: 1e6, bn: 1e9, b: 1e9 }

const CURRENCY_SYMBOLS: Record<string, string> = { '$': 'USD', '€': 'EUR', '£': 'GBP', '₪': 'ILS' }
const CURRENCY_WORDS: Record<string, string> = {
  dollar: 'USD', dollars: 'USD', usd: 'USD',
  shekel: 'ILS', shekels: 'ILS', nis: 'ILS', ils: 'ILS',
  euro: 'EUR', euros: 'EUR', eur: 'EUR',
}

// Words that end a unit phrase. The unit is the noun phrase right after the
// number ("8 goals", "500,000,000 registered users"), and these are where the
// sentence moves on to the date, the venue or the comparison.
const UNIT_STOP = new Set([
  'by', 'in', 'on', 'before', 'after', 'at', 'during', 'from', 'of', 'than', 'the',
  'and', 'or', 'will', 'for', 'to', 'as', 'within', 'until', 'when', 'if', 'compared',
  'according', 'between', 'among', 'is', 'are', 'was', 'be', 'that', 'which', 'with',
  'mark', 'level', 'threshold',
])

const TIME_UNITS = /^(?:years?|months?|weeks?|days?|hours?|minutes?|seconds?|decades?|centuries)$/

const NUMBER_RE = new RegExp(
  String.raw`(?:([$€£₪])\s?)?` +
    String.raw`(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|` +
    Object.keys(NUMBER_WORDS).join('|') +
    String.raw`)` +
    String.raw`(?:(k|bn|m|b)\b|\s(thousand|million|billion|trillion)\b)?` +
    String.raw`(\s?%|\s(?:percent|per\s+cent)\b)?`,
  'gi',
)

type Candidate = { comparator: Comparator; value: number; unit: string; start: number }

function prefixComparator(before: string): Comparator | null {
  const tail = before.toLowerCase()
  let best: { index: number; comparator: Comparator } | null = null
  for (const [re, comparator] of PREFIX_COMPARATORS) {
    const m = new RegExp(String.raw`(?:^|[^\w])(` + re.source + String.raw`)\s+$`).exec(tail)
    if (!m) continue
    const index = m.index + m[0].indexOf(m[1])
    if (best === null || index < best.index) best = { index, comparator }
  }
  return best?.comparator ?? null
}

/** The noun phrase after the number, and where it ends. At most three words;
 *  "per <word>" is kept as one unit ("children per woman", "USD per barrel"). */
function unitAfter(after: string, currency: string | null): { unit: string; consumed: number } {
  const words: string[] = []
  const re = /^\s+([A-Za-z][A-Za-z'-]*)/
  let rest = after
  let consumed = 0
  while (words.length < 3) {
    const m = re.exec(rest)
    if (!m) break
    const word = m[1]
    const lower = word.toLowerCase()
    if (lower === 'per') {
      const next = re.exec(rest.slice(m[0].length))
      if (!next || UNIT_STOP.has(next[1].toLowerCase())) break
      words.push('per', next[1])
      consumed += m[0].length + next[0].length
      rest = rest.slice(m[0].length + next[0].length)
      continue
    }
    // With a currency symbol the unit is the currency, optionally "per X".
    // Other words after "$450" belong to the sentence, not the unit.
    if (currency !== null) break
    if (UNIT_STOP.has(lower) || /ly$/.test(lower)) break
    words.push(word)
    consumed += m[0].length
    rest = rest.slice(m[0].length)
  }
  return { unit: words.join(' '), consumed }
}

function parseNumber(raw: string): number {
  const word = NUMBER_WORDS[raw.toLowerCase()]
  return word ?? Number(raw.replace(/,/g, ''))
}

export function parseQuestionQuantity(question: string): QuestionQuantityParse {
  const text = question.replace(/\s+/g, ' ').trim()

  const between = /\bbetween\s+([$€£₪])?(\d[\d,]*(?:\.\d+)?)(?:\s*(%))?\s+and\s+([$€£₪])?(\d[\d,]*(?:\.\d+)?)(?:\s*(%))?/i.exec(text)

  const candidates: Candidate[] = []
  let sawKOfN = false
  let sawYear = false
  let sawTimeSpan = false
  let sawNoUnit = false

  for (const m of text.matchAll(NUMBER_RE)) {
    const start = m.index ?? 0
    const end = start + m[0].length
    const [, symbol, numRaw, attached, wordMag, percent] = m
    // Inside a word ("DDR5-6000", "32GB") or a range ("aged 6-18"): not a bar.
    const prev = text[start - 1] ?? ''
    const next = text[end] ?? ''
    if (/[\w-]/.test(prev) || /[\w-]/.test(next)) continue

    const before = text.slice(0, start)
    const afterNumber = text.slice(end)
    let comparator = prefixComparator(before)

    let value = parseNumber(numRaw)
    if (!Number.isFinite(value)) continue
    const currency = symbol ? CURRENCY_SYMBOLS[symbol] : null
    if (attached) {
      if (!currency) continue
      value *= ATTACHED_MAGNITUDES[attached.toLowerCase()]
    }
    if (wordMag) value *= WORD_MAGNITUDES[wordMag.toLowerCase()]

    let unit: string
    let consumed = 0
    if (percent) {
      unit = 'percent'
    } else {
      const u = unitAfter(afterNumber, currency)
      consumed = u.consumed
      const first = u.unit.split(' ')[0]?.toLowerCase() ?? ''
      if (currency) {
        unit = u.unit ? `${currency} ${u.unit}` : currency
      } else if (CURRENCY_WORDS[first]) {
        unit = [CURRENCY_WORDS[first], ...u.unit.split(' ').slice(1)].join(' ')
      } else {
        unit = u.unit
      }
    }

    let postfix: Comparator | null = null
    for (const [re, c] of POSTFIX_COMPARATORS) {
      if (re.test(afterNumber.slice(consumed))) postfix = c
    }
    if (comparator === null) comparator = postfix
    if (comparator === null) continue

    // "At least 4 of the seven problems": the bar counts a subset, not a quantity.
    if (/^\s+(?:out\s+)?of\s+(?:the\s+)?(?:\d|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/i.test(afterNumber)) {
      sawKOfN = true
      continue
    }
    if (!currency && !percent && !wordMag && unit === '' && Number.isInteger(value) && value >= 1900 && value <= 2100) {
      sawYear = true
      continue
    }
    if (TIME_UNITS.test(unit.split(' ')[0]?.toLowerCase() ?? '')) {
      sawTimeSpan = true
      continue
    }
    if (unit === '') {
      sawNoUnit = true
      continue
    }
    candidates.push({ comparator, value, unit, start })
  }

  if (between && candidates.length === 0) {
    const lo = Number(between[2].replace(/,/g, ''))
    const hi = Number(between[5].replace(/,/g, ''))
    const sym = between[1] ?? between[4]
    const pct = between[3] ?? between[6]
    const currency = sym ? CURRENCY_SYMBOLS[sym] : null
    const after = text.slice(between.index + between[0].length)
    const noun = unitAfter(after, currency).unit
    const unit = pct ? 'percent' : currency ? [currency, noun].filter(Boolean).join(' ') : noun
    if (hi > lo && unit && !TIME_UNITS.test(unit.split(' ')[0].toLowerCase())) {
      return { quantity: { comparator: 'between', value: lo, value_hi: hi, unit }, reason: null }
    }
  }

  const distinct = new Map<string, Candidate>()
  for (const c of candidates) distinct.set(`${c.comparator}|${c.value}|${c.unit.toLowerCase()}`, c)
  if (distinct.size > 1) return { quantity: null, reason: 'multiple_bars' }
  if (distinct.size === 1) {
    const [c] = distinct.values()
    return { quantity: { comparator: c.comparator, value: c.value, unit: c.unit }, reason: null }
  }
  if (sawKOfN) return { quantity: null, reason: 'k_of_n' }
  if (sawTimeSpan) return { quantity: null, reason: 'time_span' }
  if (sawYear) return { quantity: null, reason: 'year_like' }
  if (sawNoUnit) return { quantity: null, reason: 'no_unit' }
  return { quantity: null, reason: 'no_bar' }
}

/** The `question_quantity` request field, or undefined to omit it.
 *
 *  Only THRESHOLD questions are parsed. Other archetypes carry numbers too
 *  ("by 2027", "at least one country"), but their stance is not a comparison
 *  against a bar, so rule 2 has nothing to check. A miss is logged with its
 *  reason. Those lines are the denominator for deciding whether an LLM
 *  fallback is worth adding (daatan#2176). */
export function questionQuantityParam(
  question: string | null | undefined,
  archetype: ClaimArchetype | null | undefined,
  predictionId?: string | null,
): QuestionQuantity | undefined {
  if (archetype !== ClaimArchetype.THRESHOLD || !question) return undefined
  const parsed = parseQuestionQuantity(question)
  if (parsed.quantity) return parsed.quantity
  log.info({ reason: parsed.reason, predictionId: predictionId ?? null }, 'question_quantity_miss')
  return undefined
}

/** Spread-ready form for a request body: `{ question_quantity }` or `{}`. */
export function withQuestionQuantity(
  question: string | null | undefined,
  archetype: ClaimArchetype | null | undefined,
  predictionId?: string | null,
): { question_quantity?: QuestionQuantity } {
  const quantity = questionQuantityParam(question, archetype, predictionId)
  return quantity ? { question_quantity: quantity } : {}
}
