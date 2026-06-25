/**
 * One-time, idempotent backfill: canonicalize non-English forecasts to English.
 *
 * For every forecast whose claim is in a non-Latin script and hasn't been
 * processed yet (`original_language IS NULL`), detect + translate the text to
 * English, make English the canonical claim/details/rules, regenerate the slug
 * from the English claim (keeping the old slug as a 308 alias), record the
 * detected source language, and seed the author's original text as a
 * same-language translation. Then fill in the remaining locale translations.
 *
 * Dry-run by default (prints what it would do). Pass --apply to write.
 * Run with: npx tsx scripts/backfill-english-canonical.ts [--apply]
 *
 * Requires GEMINI_API_KEY and DATABASE_URL in environment.
 */

import { config } from 'dotenv'
config({ path: '.env.local' })
config({ path: '.env' })

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import { slugify } from '../src/lib/utils/slugify'

const APPLY = process.argv.includes('--apply')
const DELAY_MS = 1200 // stay under Gemini quota

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const adapter = new PrismaPg(pool)
  const prisma = new PrismaClient({ adapter } as any)

  const {
    normalizeForecastToEnglish,
    hasNonLatinScript,
    sourceHash,
    TRANSLATABLE_FIELDS,
    translatePredictionToAllLocales,
  } = await import('../src/lib/services/translation')

  // Unprocessed forecasts only (idempotent: a processed row has original_language set).
  const candidates = await prisma.prediction.findMany({
    where: { originalLanguage: null },
    select: { id: true, slug: true, claimText: true, detailsText: true, resolutionRules: true },
    orderBy: { createdAt: 'desc' },
  })

  const nonLatin = candidates.filter(
    (p) => hasNonLatinScript(`${p.claimText}\n${p.detailsText ?? ''}\n${p.resolutionRules ?? ''}`),
  )

  console.log(`${candidates.length} unprocessed forecasts; ${nonLatin.length} non-Latin.`)
  console.log(APPLY ? '*** APPLY mode — writing changes ***' : '(dry run — pass --apply to write)\n')

  let canonicalized = 0
  let markedEnglish = 0
  let skipped = 0

  for (const p of nonLatin) {
    const norm = await normalizeForecastToEnglish({
      claimText: p.claimText,
      detailsText: p.detailsText,
      resolutionRules: p.resolutionRules,
    })

    if (norm.language === null) {
      console.warn(`[skip] ${p.id} — detection/translation failed; will retry next run`)
      skipped++
      await sleep()
      continue
    }

    if (norm.isEnglish) {
      // Model reports the source is already English — just mark it processed.
      console.log(`[en] ${p.id} — "${p.claimText.slice(0, 50)}" → marked English`)
      if (APPLY) await prisma.prediction.update({ where: { id: p.id }, data: { originalLanguage: 'en' } })
      markedEnglish++
      await sleep()
      continue
    }

    // Build a fresh, collision-free English slug (guard digit-only / empty).
    const rawSlug = slugify(norm.english.claimText)
    const base = /[a-z]/.test(rawSlug) ? rawSlug : 'forecast'
    const taken = await prisma.prediction.findMany({
      where: { slug: { startsWith: base }, NOT: { id: p.id } },
      select: { slug: true },
    })
    const takenSet = new Set(taken.map((t) => t.slug).filter(Boolean) as string[])
    let newSlug = base
    let n = 1
    while (takenSet.has(newSlug)) newSlug = `${base}-${n++}`

    const seedRows = TRANSLATABLE_FIELDS.flatMap((field) => {
      const original = norm.original[field]
      const english = norm.english[field]
      return original && english
        ? [{ predictionId: p.id, fieldName: field, language: norm.language as string, translatedText: original, sourceHash: sourceHash(english) }]
        : []
    })

    console.log(
      `[${norm.language}] ${p.id}\n  slug:  ${p.slug} -> ${newSlug}\n  claim: ${p.claimText.slice(0, 60)}\n      -> ${norm.english.claimText.slice(0, 60)}`,
    )

    if (APPLY) {
      await prisma.$transaction(async (tx) => {
        if (p.slug && p.slug !== newSlug) {
          await tx.predictionSlugAlias.upsert({
            where: { slug: p.slug },
            create: { slug: p.slug, predictionId: p.id },
            update: { predictionId: p.id },
          })
        }
        await tx.prediction.update({
          where: { id: p.id },
          data: {
            claimText: norm.english.claimText,
            detailsText: norm.english.detailsText,
            resolutionRules: norm.english.resolutionRules,
            slug: newSlug,
            originalLanguage: norm.language,
          },
        })
        for (const row of seedRows) {
          await tx.predictionTranslation.upsert({
            where: { predictionId_fieldName_language: { predictionId: row.predictionId, fieldName: row.fieldName, language: row.language } },
            create: row,
            update: { translatedText: row.translatedText, sourceHash: row.sourceHash },
          })
        }
      })
      // Fill the remaining locales (the source language is already seeded above).
      await translatePredictionToAllLocales(p.id).catch((err) =>
        console.error(`  [translate-locales fail] ${p.id}:`, err instanceof Error ? err.message : err),
      )
    }
    canonicalized++
    await sleep()
  }

  console.log(`\nDone. canonicalized=${canonicalized} markedEnglish=${markedEnglish} skipped=${skipped}`)
  if (!APPLY) console.log('No changes written. Re-run with --apply to execute.')
  await prisma.$disconnect()
  await pool.end()
}

const sleep = () => new Promise((r) => setTimeout(r, DELAY_MS))

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
