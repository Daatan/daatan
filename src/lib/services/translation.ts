import { llmService } from '@/lib/llm'
import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'
import { getPromptTemplate, fillPrompt } from '@/lib/llm/bedrock-prompts'
import { locales, defaultLocale } from '@/i18n/config'
import { notifyTranslationFailed } from '@/lib/services/telegram'

const log = createLogger('translation-service')

export const TRANSLATABLE_FIELDS = ['claimText', 'detailsText', 'resolutionRules'] as const
type TranslatableField = (typeof TRANSLATABLE_FIELDS)[number]

/**
 * Full English language names for the translate prompt. The prompt's
 * {{language}} slot must receive a real language name ("Hebrew") — passing the
 * bare locale code ("he") is ambiguous (it reads as the English word "he") and
 * yields noticeably more literal, stilted output. Falls back to the code itself
 * for any locale not listed here.
 */
const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  he: 'Hebrew',
  ru: 'Russian',
  eo: 'Esperanto',
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

export async function callGeminiTranslate(text: string, language: string): Promise<string> {
  const template = await getPromptTemplate('translate')
  const prompt = fillPrompt(template, { text, language: languageName(language) })

  const response = await llmService.generateContent({
    prompt,
    temperature: 0.1,
  })
  return response.text.trim()
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
    select: { fieldName: true, translatedText: true },
  })

  const cachedMap = new Map(cached.map((c) => [c.fieldName, c.translatedText]))

  const result: Partial<Record<TranslatableField, string>> = {}

  for (const field of fieldsToTranslate) {
    const sourceText = prediction[field] as string

    if (cachedMap.has(field)) {
      result[field] = cachedMap.get(field)!
      continue
    }

    // Translate and cache
    try {
      log.info({ predictionId, field, language }, 'Translating field')
      const translated = await callGeminiTranslate(sourceText, language)

      await prisma.predictionTranslation.upsert({
        where: {
          predictionId_fieldName_language: { predictionId, fieldName: field, language },
        },
        create: { predictionId, fieldName: field, language, translatedText: translated },
        update: { translatedText: translated },
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
