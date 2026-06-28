import { createHash } from 'crypto'
import { llmService } from '@/lib/llm'
import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'
import { locales, defaultLocale } from '@/i18n/config'
import { notifyTranslationFailed } from '@/lib/services/telegram'

const log = createLogger('translation-service')

export const TRANSLATABLE_FIELDS = ['claimText', 'detailsText', 'resolutionRules'] as const
type TranslatableField = (typeof TRANSLATABLE_FIELDS)[number]

/** SHA-256 of a source string — the content key for the translation cache. */
export function sourceHash(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

/**
 * Full English language names for the translate prompt. The model needs a real
 * language name ("Hebrew") — the bare locale code ("he") is ambiguous (it reads
 * as the English word "he") and yields more literal, stilted output. Falls back
 * to the code itself for any locale not listed here.
 */
const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  he: 'Hebrew',
  ru: 'Russian',
  eo: 'Esperanto',
  ar: 'Arabic',
}

export const languageName = (locale: string): string => LANGUAGE_NAMES[locale] ?? locale

/**
 * Translates a prediction to all non-default locales in the background.
 */
export async function translatePredictionToAllLocales(predictionId: string): Promise<void> {
  const targetLocales = locales.filter((l) => l !== defaultLocale)
  
  // We use Promise.allSettled to ensure one language failure doesn't block others
  // and we don't await the whole thing if called from a request (though usually we will)
  await Promise.allSettled(
    targetLocales.map((locale) => translatePrediction(predictionId, locale))
  )
}

/**
 * Translate one field. The prompt is kept in-repo (not the generic Bedrock
 * `translate` prompt) because translation quality is critical and benefits from
 * versioned review: it sets a news/forecasting register, keeps proper nouns and
 * acronyms, renders YES/NO outcomes naturally (not literal calques), and can use
 * the forecast claim as disambiguating context.
 */
export async function callGeminiTranslate(
  text: string,
  language: string,
  context?: string,
): Promise<string> {
  const target = languageName(language)
  const prompt = [
    `You are a professional translator localizing a prediction-market forecast into ${target}.`,
    '',
    `Translate the text below into natural, fluent ${target} as a native news editor would write it — convey the exact meaning, do not translate word for word.`,
    '',
    'Rules:',
    `- Keep proper nouns, organisation names and acronyms (CDC, WHO, USA, UN, …) in their standard ${target} form; never invent a translation for them.`,
    '- Keep all numbers, dates and units exactly as given.',
    '- For forecast resolution wording, render the binary outcomes (the equivalents of "YES" and "NO") naturally and unambiguously — avoid literal one-word calques.',
    '- Match the concise register of news/analysis writing.',
    '- Return ONLY the translated text: no quotes, no notes, no explanation.',
    context
      ? `\nContext — this text is part of the forecast: "${context}". Use it only to disambiguate terms and grammatical agreement; translate ONLY the text below.`
      : '',
    '',
    'Text to translate:',
    text,
  ].join('\n')

  const response = await llmService.generateContent({
    prompt,
    temperature: 0.1,
  })
  return response.text.trim()
}

/** Scripts that unambiguously signal non-English source text (Hebrew, Arabic,
 *  Syriac, Cyrillic, Greek, Kana, CJK, Hangul). Pure-Latin input skips the LLM
 *  and is assumed English — Latin-script non-English (fr/de/es) is a known gap. */
const NON_LATIN_SCRIPT =
  /[\u0370-\u03FF\u0400-\u04FF\u0590-\u05FF\u0600-\u06FF\u0700-\u074F\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]/

export function hasNonLatinScript(text: string): boolean {
  return NON_LATIN_SCRIPT.test(text)
}

// Persian uses the Arabic block plus these letters; their presence distinguishes fa from ar.
const PERSIAN_LETTERS = new Set('پچژگکیﮎﯽ')

/**
 * Best-effort source-language code from the dominant non-Latin script — for showing the
 * author the generated forecast in the language they typed in. Covers the scripts users
 * actually author in (he/ar/fa/ru/el); returns null for Latin or unrecognised text.
 */
export function detectScriptLanguage(text: string): string | null {
  let he = 0, ar = 0, cy = 0, fa = 0, el = 0
  for (const ch of text) {
    const o = ch.codePointAt(0) ?? 0
    if (o >= 0x0590 && o <= 0x05FF) he++
    else if (o >= 0x0400 && o <= 0x04FF) cy++
    else if (o >= 0x0600 && o <= 0x06FF) { ar++; if (PERSIAN_LETTERS.has(ch)) fa++ }
    else if (o >= 0x0370 && o <= 0x03FF) el++
  }
  const top = Math.max(he, ar, cy, el)
  if (top === 0) return null
  if (he === top) return 'he'
  if (cy === top) return 'ru'
  if (el === top) return 'el'
  return fa > 0 ? 'fa' : 'ar'
}

export interface LocalizedForecast {
  language: string
  claimText: string
  detailsText: string
  resolutionRules: string
  options: string[]
}

/**
 * Translate a (just-generated, English) forecast's author-facing text into the language
 * the author typed in, so the express create preview is shown in their own language. The
 * English stays canonical; this is display/edit only. Fail-open: any failure (or English
 * input) returns null and the preview stays English. Option counts must be preserved (for
 * MULTIPLE_CHOICE) — a mismatch after translation falls back to the original options.
 */
export async function localizeForecastForAuthor(
  fields: { claimText: string; detailsText?: string | null; resolutionRules?: string | null; options?: string[] },
  authoredText: string,
): Promise<LocalizedForecast | null> {
  const lang = detectScriptLanguage(authoredText)
  if (!lang) return null
  try {
    const [claimText, detailsText, resolutionRules, optionsJoined] = await Promise.all([
      callGeminiTranslate(fields.claimText, lang),
      fields.detailsText ? callGeminiTranslate(fields.detailsText, lang) : Promise.resolve(''),
      fields.resolutionRules ? callGeminiTranslate(fields.resolutionRules, lang) : Promise.resolve(''),
      fields.options?.length ? callGeminiTranslate(fields.options.join('\n'), lang) : Promise.resolve(''),
    ])
    const srcOptions = fields.options ?? []
    const translatedOptions = optionsJoined ? optionsJoined.split('\n').map(s => s.trim()).filter(Boolean) : []
    // Keep the English options if translation changed their count (MC integrity).
    const options = translatedOptions.length === srcOptions.length ? translatedOptions : srcOptions
    return { language: lang, claimText: claimText.trim(), detailsText: detailsText.trim(), resolutionRules: resolutionRules.trim(), options }
  } catch (err) {
    log.warn({ err, lang }, 'localizeForecastForAuthor failed; preview stays English')
    return null
  }
}

export interface ForecastTextFields {
  claimText: string
  detailsText?: string | null
  resolutionRules?: string | null
}

export interface NormalizedForecast {
  /** Detected source language (ISO 639-1), or null when unknown / assumed English. */
  language: string | null
  /** True when no translation happened (already English, or detection failed). */
  isEnglish: boolean
  /** English (canonical) version of each field. */
  english: ForecastTextFields
  /** The author's original text, unchanged. */
  original: ForecastTextFields
}

/**
 * One Gemini call: detect the source language and translate each non-empty field
 * to English. Throws on an LLM or parse failure so the caller can fall back.
 */
async function detectAndTranslateToEnglish(
  fields: ForecastTextFields,
): Promise<{ language: string; english: ForecastTextFields }> {
  const prompt = [
    'You are localizing a prediction-market forecast. Detect the language of the',
    'fields below and translate each NON-EMPTY field into natural, fluent English',
    '(news/forecasting register; keep proper nouns, acronyms, numbers and dates).',
    'Respond with ONLY minified JSON, no code fence, exactly this shape:',
    '{"language":"<ISO 639-1 code of the source>","claimText":"...","detailsText":"...","resolutionRules":"..."}',
    'Include claimText always; include detailsText / resolutionRules only when their input is non-empty.',
    '',
    `claimText: ${fields.claimText}`,
    fields.detailsText ? `detailsText: ${fields.detailsText}` : '',
    fields.resolutionRules ? `resolutionRules: ${fields.resolutionRules}` : '',
  ]
    .filter(Boolean)
    .join('\n')

  const res = await llmService.generateContent({ prompt, temperature: 0.1 })
  const match = res.text.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('No JSON object in detect-translate response')
  const parsed = JSON.parse(match[0]) as Record<string, unknown>
  const language =
    typeof parsed.language === 'string' ? parsed.language.toLowerCase().slice(0, 10) : ''
  if (!language) throw new Error('No language in detect-translate response')

  const pick = (k: TranslatableField, fallback: string | null | undefined) =>
    typeof parsed[k] === 'string' && (parsed[k] as string).trim()
      ? (parsed[k] as string).trim()
      : fallback ?? null
  return {
    language,
    english: {
      claimText: (pick('claimText', fields.claimText) as string) || fields.claimText,
      detailsText: pick('detailsText', fields.detailsText),
      resolutionRules: pick('resolutionRules', fields.resolutionRules),
    },
  }
}

/**
 * Canonicalize a forecast's text to English. Pure-Latin input is assumed English
 * and returned unchanged (no LLM). Non-Latin input is detected + translated in a
 * single Gemini call; on ANY failure the original text is returned unchanged so
 * forecast creation never breaks. Callers persist `language` as `originalLanguage`
 * and seed the original text as a same-language translation.
 */
export async function normalizeForecastToEnglish(
  fields: ForecastTextFields,
): Promise<NormalizedForecast> {
  const original: ForecastTextFields = {
    claimText: fields.claimText,
    detailsText: fields.detailsText ?? null,
    resolutionRules: fields.resolutionRules ?? null,
  }
  const combined = [fields.claimText, fields.detailsText, fields.resolutionRules]
    .filter(Boolean)
    .join('\n')

  if (!hasNonLatinScript(combined)) {
    return { language: 'en', isEnglish: true, english: { ...original }, original }
  }

  try {
    const { language, english } = await detectAndTranslateToEnglish(fields)
    if (language === 'en') return { language: 'en', isEnglish: true, english: { ...original }, original }
    return { language, isEnglish: false, english, original }
  } catch (err) {
    log.error({ err }, 'Forecast English normalization failed; keeping original text')
    return { language: null, isEnglish: true, english: { ...original }, original }
  }
}

/**
 * Translate a candidate forecast title to English for cross-language dedup.
 *
 * The dedup gate compares a candidate against recent forecasts whose stored
 * claims are English-canonical (see {@link normalizeForecastToEnglish}). A
 * non-English candidate shares no keywords with them, so the local Jaccard
 * check scores 0 and the LLM gate can miss the match. Translating the candidate
 * first puts both sides in the same language. Pure-Latin titles are returned
 * unchanged (no cost); a translation failure falls back to the original text,
 * preserving the existing fail-open behaviour.
 */
export async function normalizeTitleForDedup(text: string): Promise<string> {
  if (!hasNonLatinScript(text)) return text
  const { english } = await normalizeForecastToEnglish({ claimText: text })
  return english.claimText
}

/**
 * Returns translated fields for a prediction, fetching from cache or translating on demand.
 * Only translates fields that are non-empty in the source prediction.
 */
export async function translatePrediction(
  predictionId: string,
  language: string,
): Promise<Partial<Record<TranslatableField, string>>> {
  const prediction = await prisma.prediction.findUnique({
    where: { id: predictionId },
    select: { claimText: true, detailsText: true, resolutionRules: true },
  })

  if (!prediction) {
    throw new Error(`Prediction ${predictionId} not found`)
  }

  // Determine which fields need translation
  const fieldsToTranslate: TranslatableField[] = TRANSLATABLE_FIELDS.filter(
    (f) => !!prediction[f],
  )

  // Fetch cached translations for this prediction + language
  const cached = await prisma.predictionTranslation.findMany({
    where: {
      predictionId,
      language,
      fieldName: { in: fieldsToTranslate },
    },
    select: { fieldName: true, translatedText: true, sourceHash: true },
  })

  const cachedMap = new Map(cached.map((c) => [c.fieldName, c]))

  const result: Partial<Record<TranslatableField, string>> = {}

  for (const field of fieldsToTranslate) {
    const sourceText = prediction[field] as string
    const hash = sourceHash(sourceText)

    // Cache hit only when the translation was produced from the *current* source.
    // A stale row (source edited, or legacy row with null hash) falls through and
    // re-translates, so an updated detailsText is never served as old Hebrew.
    const hit = cachedMap.get(field)
    if (hit && hit.sourceHash === hash) {
      result[field] = hit.translatedText
      continue
    }

    // Give non-claim fields the claim as disambiguating context.
    const context = field === 'claimText' ? undefined : prediction.claimText || undefined

    try {
      log.info({ predictionId, field, language }, 'Translating field')
      const translated = await callGeminiTranslate(sourceText, language, context ?? undefined)

      await prisma.predictionTranslation.upsert({
        where: {
          predictionId_fieldName_language: { predictionId, fieldName: field, language },
        },
        create: { predictionId, fieldName: field, language, translatedText: translated, sourceHash: hash },
        update: { translatedText: translated, sourceHash: hash },
      })

      result[field] = translated
    } catch (err) {
      log.error({ err, predictionId, field, language }, 'Translation failed, returning original')
      notifyTranslationFailed(predictionId, language, field, err)
      result[field] = sourceText
    }
  }

  return result
}

/**
 * Returns cached translated fields for a prediction WITHOUT triggering new translations.
 * Safe to call from SSR pages — never calls Gemini. Returns {} on cache miss.
 */
export async function getCachedPredictionTranslation(
  predictionId: string,
  language: string,
): Promise<Partial<Record<TranslatableField, string>>> {
  const cached = await prisma.predictionTranslation.findMany({
    where: { predictionId, language },
    select: { fieldName: true, translatedText: true },
  })

  return Object.fromEntries(
    cached
      .filter((c): c is typeof c & { fieldName: TranslatableField } =>
        TRANSLATABLE_FIELDS.includes(c.fieldName as TranslatableField)
      )
      .map((c) => [c.fieldName, c.translatedText]),
  ) as Partial<Record<TranslatableField, string>>
}

/**
 * Returns translated text for a comment, fetching from cache or translating on demand.
 */
export async function translateComment(commentId: string, language: string): Promise<string> {
  const comment = await prisma.comment.findUnique({
    where: { id: commentId },
    select: { text: true },
  })

  if (!comment) {
    throw new Error(`Comment ${commentId} not found`)
  }

  const cached = await prisma.commentTranslation.findUnique({
    where: { commentId_language: { commentId, language } },
    select: { translatedText: true },
  })

  if (cached) {
    return cached.translatedText
  }

  try {
    log.info({ commentId, language }, 'Translating comment')
    const translated = await callGeminiTranslate(comment.text, language)

    await prisma.commentTranslation.upsert({
      where: { commentId_language: { commentId, language } },
      create: { commentId, language, translatedText: translated },
      update: { translatedText: translated },
    })

    return translated
  } catch (err) {
    log.error({ err, commentId, language }, 'Comment translation failed, returning original')
    return comment.text
  }
}
