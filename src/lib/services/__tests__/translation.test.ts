import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    prediction: { findUnique: vi.fn() },
    predictionTranslation: { findMany: vi.fn(), upsert: vi.fn() },
  },
}))
vi.mock('@/lib/llm', () => ({ llmService: { generateContent: vi.fn() } }))
vi.mock('@/lib/services/telegram', () => ({ notifyTranslationFailed: vi.fn() }))

import {
  translatePrediction,
  sourceHash,
  callGeminiTranslate,
  languageName,
  hasNonLatinScript,
  normalizeForecastToEnglish,
  normalizeTitleForDedup,
  detectScriptLanguage,
  localizeForecastForAuthor,
} from '../translation'
import { prisma } from '@/lib/prisma'
import { llmService } from '@/lib/llm'

const HEBREW_CLAIM = 'לפחות שתי מפלגות ערביות יתמודדו בבחירות 2026.'

const PREDICTION = {
  claimText: 'Ebola will spread to the USA by 2026',
  detailsText: 'Original details, version 1.',
  resolutionRules: 'YES if confirmed by the CDC.',
}

describe('languageName', () => {
  it('maps known locale codes to full English language names', () => {
    expect(languageName('he')).toBe('Hebrew')
    expect(languageName('ru')).toBe('Russian')
    expect(languageName('eo')).toBe('Esperanto')
    expect(languageName('en')).toBe('English')
  })

  it('falls back to the raw code for unknown locales', () => {
    expect(languageName('xx')).toBe('xx')
  })
})

describe('sourceHash', () => {
  it('is deterministic and differs for different text', () => {
    expect(sourceHash('abc')).toBe(sourceHash('abc'))
    expect(sourceHash('abc')).not.toBe(sourceHash('abd'))
    expect(sourceHash('abc')).toHaveLength(64)
  })
})

describe('callGeminiTranslate prompt', () => {
  it('targets the named language, includes context, and trims output', async () => {
    vi.mocked(llmService.generateContent).mockResolvedValue({ text: ' שלום ' } as never)
    const out = await callGeminiTranslate('Hello', 'he', 'the forecast claim')
    expect(out).toBe('שלום') // trimmed
    const prompt = vi.mocked(llmService.generateContent).mock.calls[0][0].prompt
    expect(prompt).toContain('Hebrew') // full language name, not "he"
    expect(prompt).not.toContain(' he ')
    expect(prompt).toContain('the forecast claim')
    expect(prompt).toContain('Hello')
  })
})

describe('translatePrediction — content-aware cache', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(prisma.prediction.findUnique).mockResolvedValue(PREDICTION as never)
    vi.mocked(prisma.predictionTranslation.upsert).mockResolvedValue({} as never)
    vi.mocked(llmService.generateContent).mockResolvedValue({ text: 'TRANSLATED' } as never)
  })

  it('serves the cache only when the source hash matches (no LLM call)', async () => {
    vi.mocked(prisma.predictionTranslation.findMany).mockResolvedValue([
      { fieldName: 'claimText', translatedText: 'he-claim', sourceHash: sourceHash(PREDICTION.claimText) },
      { fieldName: 'detailsText', translatedText: 'he-details', sourceHash: sourceHash(PREDICTION.detailsText) },
      { fieldName: 'resolutionRules', translatedText: 'he-rules', sourceHash: sourceHash(PREDICTION.resolutionRules) },
    ] as never)

    const result = await translatePrediction('p1', 'he')

    expect(result.detailsText).toBe('he-details')
    expect(llmService.generateContent).not.toHaveBeenCalled()
    expect(prisma.predictionTranslation.upsert).not.toHaveBeenCalled()
  })

  it('re-translates a field whose source changed (stale hash)', async () => {
    vi.mocked(prisma.predictionTranslation.findMany).mockResolvedValue([
      { fieldName: 'claimText', translatedText: 'he-claim', sourceHash: sourceHash(PREDICTION.claimText) },
      // detailsText was rewritten — cached hash is for the OLD text
      { fieldName: 'detailsText', translatedText: 'STALE he-details', sourceHash: sourceHash('Old details that no longer match') },
      { fieldName: 'resolutionRules', translatedText: 'he-rules', sourceHash: sourceHash(PREDICTION.resolutionRules) },
    ] as never)

    const result = await translatePrediction('p1', 'he')

    // only detailsText re-translated
    expect(llmService.generateContent).toHaveBeenCalledOnce()
    expect(result.detailsText).toBe('TRANSLATED')
    // re-translated with the new source hash + the claim as context
    expect(prisma.predictionTranslation.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { translatedText: 'TRANSLATED', sourceHash: sourceHash(PREDICTION.detailsText) },
      }),
    )
    const prompt = vi.mocked(llmService.generateContent).mock.calls[0][0].prompt
    expect(prompt).toContain(PREDICTION.claimText) // claim passed as context for detailsText
  })

  it('re-translates legacy rows with a null source hash', async () => {
    vi.mocked(prisma.predictionTranslation.findMany).mockResolvedValue([
      { fieldName: 'claimText', translatedText: 'legacy', sourceHash: null },
    ] as never)

    await translatePrediction('p1', 'he')

    // claimText (null hash) re-translated; detailsText + rules have no row → also translated
    expect(llmService.generateContent).toHaveBeenCalledTimes(3)
  })
})

describe('hasNonLatinScript', () => {
  it('flags non-Latin scripts and passes pure-Latin text', () => {
    expect(hasNonLatinScript(HEBREW_CLAIM)).toBe(true)
    expect(hasNonLatinScript('Большинство')).toBe(true) // Cyrillic
    expect(hasNonLatinScript('Will Bitcoin hit $100k by 2026?')).toBe(false)
    expect(hasNonLatinScript('Café résumé naïve — 2026')).toBe(false) // Latin-1 accents
  })
})

describe('normalizeForecastToEnglish', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns English input unchanged without calling the LLM', async () => {
    const out = await normalizeForecastToEnglish({ claimText: 'Bitcoin hits $100k by 2026' })
    expect(llmService.generateContent).not.toHaveBeenCalled()
    expect(out).toMatchObject({ language: 'en', isEnglish: true })
    expect(out.english.claimText).toBe('Bitcoin hits $100k by 2026')
    expect(out.original.claimText).toBe('Bitcoin hits $100k by 2026')
  })

  it('detects + translates non-Latin input, keeping the original', async () => {
    vi.mocked(llmService.generateContent).mockResolvedValue({
      text: '{"language":"he","claimText":"At least two Arab parties will run in the 2026 elections."}',
    } as never)

    const out = await normalizeForecastToEnglish({ claimText: HEBREW_CLAIM })

    expect(out.isEnglish).toBe(false)
    expect(out.language).toBe('he')
    expect(out.english.claimText).toBe('At least two Arab parties will run in the 2026 elections.')
    expect(out.original.claimText).toBe(HEBREW_CLAIM) // author's wording preserved
  })

  it('treats a detected "en" as already-English (no canonicalization)', async () => {
    // Latin-1 accents don't trip the script gate, but a stray CJK char would —
    // if the model still reports English, we keep the source as canonical.
    vi.mocked(llmService.generateContent).mockResolvedValue({
      text: '{"language":"en","claimText":"whatever"}',
    } as never)
    const out = await normalizeForecastToEnglish({ claimText: 'Tokyo 都 2026 climate pledge holds' })
    expect(out).toMatchObject({ language: 'en', isEnglish: true })
    expect(out.english.claimText).toBe('Tokyo 都 2026 climate pledge holds') // unchanged
  })

  it('falls back to the original (never throws) when the LLM/parse fails', async () => {
    vi.mocked(llmService.generateContent).mockResolvedValue({ text: 'not json' } as never)
    const out = await normalizeForecastToEnglish({ claimText: HEBREW_CLAIM })
    expect(out).toMatchObject({ language: null, isEnglish: true })
    expect(out.english.claimText).toBe(HEBREW_CLAIM)
  })
})

describe('normalizeTitleForDedup', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns an English title unchanged without an LLM call', async () => {
    const out = await normalizeTitleForDedup('At least one political party will withdraw')
    expect(llmService.generateContent).not.toHaveBeenCalled()
    expect(out).toBe('At least one political party will withdraw')
  })

  it('translates a non-English title so it can match English-canonical existing titles', async () => {
    vi.mocked(llmService.generateContent).mockResolvedValue({
      text: '{"language":"he","claimText":"At least one party will withdraw from the Knesset race"}',
    } as never)
    const out = await normalizeTitleForDedup(HEBREW_CLAIM)
    expect(out).toBe('At least one party will withdraw from the Knesset race')
  })

  it('falls back to the original title when translation fails (fail-open)', async () => {
    vi.mocked(llmService.generateContent).mockResolvedValue({ text: 'not json' } as never)
    const out = await normalizeTitleForDedup(HEBREW_CLAIM)
    expect(out).toBe(HEBREW_CLAIM)
  })
})

describe('detectScriptLanguage', () => {
  it('detects the dominant non-Latin script', () => {
    expect(detectScriptLanguage(HEBREW_CLAIM)).toBe('he')
    expect(detectScriptLanguage('Большинство проголосует за')).toBe('ru')
    expect(detectScriptLanguage('سوف يفوز الحزب')).toBe('ar')
    expect(detectScriptLanguage('Η κυβέρνηση θα πέσει')).toBe('el')
  })
  it('returns null for Latin / undetectable text', () => {
    expect(detectScriptLanguage('Bitcoin hits $100k by 2026')).toBeNull()
    expect(detectScriptLanguage('Café résumé 2026')).toBeNull()
  })
})

describe('localizeForecastForAuthor', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns null (no LLM) when the author typed in English', async () => {
    const out = await localizeForecastForAuthor({ claimText: 'X will happen' }, 'English input here')
    expect(out).toBeNull()
    expect(llmService.generateContent).not.toHaveBeenCalled()
  })

  it('translates the author-facing fields into the typed language', async () => {
    vi.mocked(llmService.generateContent).mockResolvedValue({ text: 'מתורגם' } as never)
    const out = await localizeForecastForAuthor(
      { claimText: 'At least one party withdraws', detailsText: 'context', resolutionRules: 'rules', options: [] },
      HEBREW_CLAIM,
    )
    expect(out).not.toBeNull()
    expect(out!.language).toBe('he')
    expect(out!.claimText).toBe('מתורגם')
  })

  it('keeps the original options if translation changes their count (MC integrity)', async () => {
    // One generateContent mock for all fields → options "a\nb" becomes a single line.
    vi.mocked(llmService.generateContent).mockResolvedValue({ text: 'אחד' } as never)
    const out = await localizeForecastForAuthor(
      { claimText: 'c', options: ['Yes', 'No', 'Maybe'] },
      HEBREW_CLAIM,
    )
    expect(out!.options).toEqual(['Yes', 'No', 'Maybe'])
  })

  it('fails open to null when translation throws', async () => {
    vi.mocked(llmService.generateContent).mockRejectedValue(new Error('LLM down') as never)
    const out = await localizeForecastForAuthor({ claimText: 'c' }, HEBREW_CLAIM)
    expect(out).toBeNull()
  })
})
