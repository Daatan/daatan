import crypto from 'crypto'
import type { OutcomeType } from '@prisma/client'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { slugify, generateUniqueSlug } from '@/lib/utils/slugify'
import { hashUrl } from '@/lib/utils/hash'
import { embedText, embedAndStoreForecast } from '@/lib/services/embedding'
import { createLogger } from '@/lib/logger'
import { notifyIndexNow } from '@/lib/services/indexnow'
import { communityProbability } from '@/lib/forecast-math'
import {
  normalizeForecastToEnglish,
  translatePredictionToAllLocales,
  sourceHash,
  TRANSLATABLE_FIELDS,
} from '@/lib/services/translation'

const log = createLogger('forecast')

/** True when `err` is a Prisma P2002 unique-constraint violation on the `slug` column. */
function isSlugUniqueConstraintError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false
  if (!('code' in err) || err.code !== 'P2002') return false
  if (!('meta' in err) || typeof err.meta !== 'object' || err.meta === null) return false
  if (!('target' in err.meta)) return false
  const target = err.meta.target
  return Array.isArray(target) && target.includes('slug')
}

// Structural check (not `instanceof`): Prisma throws P2025 ("record required but
// not found") when delete/update targets a row that no longer exists.
function isRecordNotFoundError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === 'P2025'
}

const PREDICTION_AUTHOR_SELECT = {
  id: true,
  name: true,
  username: true,
  image: true,
  rs: true,
  role: true,
} as const

const NEWS_ANCHOR_SELECT = {
  id: true,
  title: true,
  url: true,
  source: true,
  imageUrl: true,
} as const

export interface ListForecastsQuery {
  where: Record<string, unknown>
  orderBy: Record<string, 'asc' | 'desc'>
  page: number
  limit: number
  isCuSort: boolean
  sortOrder: 'asc' | 'desc'
}

export async function listForecasts(query: ListForecastsQuery) {
  const [predictions, total] = await Promise.all([
    prisma.prediction.findMany({
      where: query.where,
      include: {
        author: { select: PREDICTION_AUTHOR_SELECT },
        newsAnchor: { select: NEWS_ANCHOR_SELECT },
        tags: { select: { name: true } },
        options: { orderBy: { displayOrder: 'asc' } },
        _count: { select: { commitments: true } },
        commitments: {
          select: {
            cuCommitted: true,
            userId: true,
            binaryChoice: true,
            optionId: true,
          },
        },
      },
      orderBy: query.orderBy,
      skip: query.isCuSort ? 0 : (query.page - 1) * query.limit,
      take: query.isCuSort ? 200 : query.limit,
    }),
    prisma.prediction.count({ where: query.where }),
  ])
  return { predictions, total }
}

export function enrichPredictions(
  predictions: Awaited<ReturnType<typeof listForecasts>>['predictions'],
  userId: string | undefined,
  query: Pick<ListForecastsQuery, 'page' | 'limit' | 'sortOrder' | 'isCuSort'>,
) {
  const enriched = predictions.map(({ commitments, ...pred }) => {
    const totalCuCommitted = commitments
      ? commitments.reduce((sum, c) => sum + c.cuCommitted, 0)
      : 0
    const userHasCommitted = userId && commitments
      ? commitments.some((c) => c.userId === userId)
      : false

    let yesCount = 0
    let noCount = 0
    // Canonical community probability (mean of stated P(YES)) — the same number
    // the detail page shows. Kept separate from yes/noCount, which are CU-weighted
    // stake sums used only for the YES/NO split bar.
    let communityProb: number | null = null
    if (pred.outcomeType === 'BINARY' && commitments) {
      yesCount = commitments
        .filter(c => c.binaryChoice === true)
        .reduce((sum, c) => sum + c.cuCommitted, 0)
      noCount = commitments
        .filter(c => c.binaryChoice === false)
        .reduce((sum, c) => sum + Math.abs(c.cuCommitted), 0)
      communityProb = communityProbability(commitments)
    }

    const options = pred.options?.map((opt) => ({
      ...opt,
      commitmentsCount: commitments
        ? commitments.filter((c) => c.optionId === opt.id).length
        : 0,
    })) ?? []

    return { ...pred, totalCuCommitted, userHasCommitted, yesCount, noCount, communityProbability: communityProb, options }
  })

  if (!query.isCuSort) return enriched

  return enriched
    .sort((a, b) =>
      query.sortOrder === 'asc'
        ? a.totalCuCommitted - b.totalCuCommitted
        : b.totalCuCommitted - a.totalCuCommitted,
    )
    .slice((query.page - 1) * query.limit, query.page * query.limit)
}

export async function upsertNewsAnchor(url: string, title?: string) {
  const urlHash = hashUrl(url)
  return prisma.newsAnchor.upsert({
    where: { urlHash },
    update: {},
    create: {
      url,
      urlHash,
      title: title || url,
      source: new URL(url).hostname.replace('www.', ''),
    },
  })
}

export async function verifyUserExists(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  })
}

export interface CreateForecastInput {
  authorId: string
  claimText: string
  detailsText?: string
  outcomeType: string
  outcomePayload?: Record<string, unknown>
  resolutionRules?: string
  resolveByDatetime: string
  isPublic?: boolean
  source?: string | null
  confidence?: number | null
  newsAnchorId?: string
  tags?: string[]
  /** When the forecast was created by importing an external market (PM/Kalshi), link it. */
  externalMarketId?: string
}

export async function createForecast(input: CreateForecastInput) {
  const shareToken = crypto.randomBytes(8).toString('hex')

  // Canonicalize to English so the URL slug and the default UI are English. The
  // author's original-language text is preserved below as a translation. On a
  // pure-English input (or any failure) this is a no-op returning the original.
  const normalized = await normalizeForecastToEnglish({
    claimText: input.claimText,
    detailsText: input.detailsText,
    resolutionRules: input.resolutionRules,
  })
  const claimText = normalized.english.claimText
  const detailsText = normalized.english.detailsText ?? undefined
  const resolutionRules = normalized.english.resolutionRules ?? undefined
  const originalLanguage = normalized.isEnglish ? null : normalized.language

  // A claim that slugifies to nothing meaningful — digits only, or non-Latin
  // text that survived a failed canonicalization — would otherwise collide into
  // "2026-1"-style slugs. Fall back to a stable base when there's no letter.
  const rawSlug = slugify(claimText)
  const baseSlug = /[a-z]/.test(rawSlug) ? rawSlug : 'forecast'

  const existingSlugs = await prisma.prediction
    .findMany({
      where: { slug: { startsWith: baseSlug } },
      select: { slug: true },
    })
    .then(rows => rows.map(r => r.slug).filter((s): s is string => s !== null))

  let uniqueSlug = generateUniqueSlug(baseSlug, existingSlugs)
  let prediction: { id: string } | null = null
  let retries = 0

  while (retries < 3) {
    try {
      prediction = await prisma.prediction.create({
        data: {
          authorId: input.authorId,
          newsAnchorId: input.newsAnchorId,
          claimText,
          slug: uniqueSlug,
          detailsText,
          originalLanguage,
          outcomeType: input.outcomeType as OutcomeType,
          outcomePayload: (input.outcomePayload ?? {}) as object,
          resolutionRules,
          resolveByDatetime: new Date(input.resolveByDatetime),
          status: 'DRAFT',
          isPublic: input.isPublic ?? true,
          source: input.source ?? null,
          confidence: input.confidence ?? null,
          externalMarketId: input.externalMarketId,
          externalMarketLinkedAt: input.externalMarketId ? new Date() : undefined,
          externalMarketLinkMethod: input.externalMarketId ? 'imported' : undefined,
          shareToken,
          tags: input.tags?.length
            ? {
              connectOrCreate: input.tags
                .filter((t): t is string => typeof t === 'string' && t.length > 0)
                .map((tagName) => {
                  const tagSlug = slugify(tagName)
                  return { where: { slug: tagSlug }, create: { name: tagName, slug: tagSlug } }
                }),
            }
            : undefined,
        },
        select: { id: true },
      })
      break
    } catch (err) {
      // Structural check (not `instanceof`): Prisma throws a real
      // PrismaClientKnownRequestError in prod, but callers/tests may surface a
      // plain error carrying the same { code, meta } shape.
      if (isSlugUniqueConstraintError(err)) {
        retries++
        uniqueSlug = `${baseSlug}-${crypto.randomBytes(3).toString('hex')}`
        continue
      }
      throw err
    }
  }

  if (!prediction) throw new Error('Failed to generate a unique URL slug after multiple attempts')

  // Preserve the author's original-language wording as a translation, so the
  // source-language UI shows exactly what they wrote and the background job never
  // re-translates English back into their language. Hashed to the English source
  // so the translation cache treats these rows as fresh.
  if (!normalized.isEnglish && normalized.language) {
    const lang = normalized.language
    const rows = TRANSLATABLE_FIELDS.flatMap((field) => {
      const original = normalized.original[field]
      const english = normalized.english[field]
      return original && english
        ? [{ predictionId: prediction!.id, fieldName: field, language: lang, translatedText: original, sourceHash: sourceHash(english) }]
        : []
    })
    if (rows.length) await prisma.predictionTranslation.createMany({ data: rows, skipDuplicates: true })
  }

  // Fire-and-forget: store embedding for similar-forecast search (English claim)
  embedAndStoreForecast(prediction.id, claimText).catch((err) =>
    log.error({ err, id: prediction.id }, 'embed failed')
  )

  if (input.outcomeType === 'MULTIPLE_CHOICE') {
    const payload = input.outcomePayload as { options?: string[] } | undefined
    if (payload?.options?.length) {
      await prisma.predictionOption.createMany({
        data: payload.options.map((text, index) => ({
          predictionId: prediction!.id,
          text,
          displayOrder: index,
        })),
      })
    }
  }

  return prisma.prediction.findUnique({
    where: { id: prediction.id },
    include: {
      author: { select: { id: true, name: true, username: true, image: true } },
      newsAnchor: true,
      options: { orderBy: { displayOrder: 'asc' } },
    },
  })
}

// ── Similar forecasts ──────────────────────────────────────────────────────────

// Cosine similarity threshold: 1 - distance. 0.75 means reasonably similar.
const COSINE_THRESHOLD = 0.75

export interface SimilarForecast {
  id: string
  slug: string | null
  claimText: string
  status: string
  resolveByDatetime: Date
  author: { name: string | null; username: string | null }
  score: number
}

interface SimilarRow {
  id: string
  slug: string | null
  claimText: string
  status: string
  resolveByDatetime: Date
  authorName: string | null
  authorUsername: string | null
  score: number
  tagNames: string[] | null
}

export async function findSimilarForecasts({
  claimText,
  tags,
  excludeId,
  limit = 3,
}: {
  claimText: string
  tags: string[]
  excludeId?: string
  limit?: number
}): Promise<SimilarForecast[]> {
  const embedding = await embedText(claimText)

  if (!embedding) return []
  if (!embedding.every(Number.isFinite)) return []

  // vectorStr contains only finite floats (digits, commas, brackets, minus) — safe to inline
  const vectorStr = `[${embedding.join(',')}]`
  const fetchLimit = limit * 5 // fetch extra to allow tag-boosted re-sorting

  const rows = await prisma.$queryRaw<SimilarRow[]>(
    Prisma.sql`
      SELECT
        p.id,
        p.slug,
        p."claimText",
        p.status,
        p."resolveByDatetime",
        u.name AS "authorName",
        u.username AS "authorUsername",
        (1 - (p.embedding <=> ${Prisma.raw(`'${vectorStr}'::vector`)}))::float AS score,
        array_agg(t.name) FILTER (WHERE t.name IS NOT NULL) AS "tagNames"
      FROM predictions p
      JOIN users u ON u.id = p."authorId"
      LEFT JOIN "_PredictionToTag" pt ON pt."A" = p.id
      LEFT JOIN tags t ON t.id = pt."B"
      WHERE p.status IN ('ACTIVE', 'PENDING_APPROVAL')
        AND p.embedding IS NOT NULL
        AND p.id != ${excludeId ?? ''}
      GROUP BY p.id, u.name, u.username, p.embedding
      HAVING (1 - (p.embedding <=> ${Prisma.raw(`'${vectorStr}'::vector`)})) >= ${COSINE_THRESHOLD}
      ORDER BY p.embedding <=> ${Prisma.raw(`'${vectorStr}'::vector`)}
      LIMIT ${fetchLimit}
    `
  )

  const tagSet = new Set(tags.map(t => t.toLowerCase()))

  return rows
    .map(r => ({
      id: r.id,
      slug: r.slug,
      claimText: r.claimText,
      status: r.status,
      resolveByDatetime: r.resolveByDatetime,
      author: { name: r.authorName, username: r.authorUsername },
      score: r.score,
      sharedTags: (r.tagNames ?? []).filter(n => tagSet.has(n.toLowerCase())).length,
    }))
    .sort((a, b) => b.score - a.score || b.sharedTags - a.sharedTags)
    .slice(0, limit)
    .map(({ sharedTags: _, ...rest }) => rest)
}

// ── Single forecast ───────────────────────────────────────────────────────────

/**
 * Resolve a (possibly stale) slug to the forecast's current canonical slug via
 * the slug-alias table. Returns null when the slug isn't a known alias, or when
 * the forecast no longer has a slug. Used by the page routes to 308-redirect an
 * old URL (e.g. a non-English slug fixed during canonicalization) to the new one.
 */
export async function getCanonicalSlugForAlias(slug: string): Promise<string | null> {
  const alias = await prisma.predictionSlugAlias.findUnique({
    where: { slug },
    select: { prediction: { select: { slug: true } } },
  })
  return alias?.prediction.slug ?? null
}

/** Outcome of canonicalizing one existing forecast (see canonicalizeForecastToEnglish). */
export type CanonicalizeResult = 'canonicalized' | 'english' | 'failed' | 'skipped'

/**
 * Backfill one existing forecast to the English-canonical model (idempotent).
 * `skipped` when already processed (original_language set) or missing; `english`
 * when the source is detected as English (just marks it); `failed` when detection
 * failed (left untouched for a later retry); `canonicalized` when translated:
 * English becomes canonical, the old slug is kept as an alias, the new English
 * slug is set, original_language is recorded, the author's original text is seeded
 * as a same-language translation, the English claim is re-embedded, and the other
 * locales are filled.
 */
export async function canonicalizeForecastToEnglish(predictionId: string): Promise<CanonicalizeResult> {
  const p = await prisma.prediction.findUnique({
    where: { id: predictionId },
    select: { id: true, slug: true, claimText: true, detailsText: true, resolutionRules: true, originalLanguage: true },
  })
  if (!p || p.originalLanguage !== null) return 'skipped'

  const norm = await normalizeForecastToEnglish({
    claimText: p.claimText,
    detailsText: p.detailsText,
    resolutionRules: p.resolutionRules,
  })
  if (norm.language === null) return 'failed'
  if (norm.isEnglish) {
    await prisma.prediction.update({ where: { id: p.id }, data: { originalLanguage: 'en' } })
    return 'english'
  }

  const lang = norm.language
  const rawSlug = slugify(norm.english.claimText)
  const base = /[a-z]/.test(rawSlug) ? rawSlug : 'forecast'
  const taken = await prisma.prediction.findMany({
    where: { slug: { startsWith: base }, NOT: { id: p.id } },
    select: { slug: true },
  })
  const takenSet = new Set(taken.map(t => t.slug).filter((s): s is string => s !== null))
  let newSlug = base
  let n = 1
  while (takenSet.has(newSlug)) newSlug = `${base}-${n++}`

  const seedRows = TRANSLATABLE_FIELDS.flatMap((field) => {
    const original = norm.original[field]
    const english = norm.english[field]
    return original && english
      ? [{ predictionId: p.id, fieldName: field, language: lang, translatedText: original, sourceHash: sourceHash(english) }]
      : []
  })

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
        originalLanguage: lang,
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

  await embedAndStoreForecast(p.id, norm.english.claimText).catch((err) =>
    log.error({ err, id: p.id }, 'embed failed during canonicalization'),
  )
  await translatePredictionToAllLocales(p.id).catch((err) =>
    log.error({ err, id: p.id }, 'locale fill failed during canonicalization'),
  )
  return 'canonicalized'
}

export async function getForecastById(idOrSlug: string) {
  return prisma.prediction.findFirst({
    where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
    include: {
      author: { select: { id: true, name: true, username: true, image: true, rs: true, role: true, isBot: true } },
      newsAnchor: true,
      tags: { select: { id: true, name: true, slug: true } },
      options: { orderBy: { displayOrder: 'asc' } },
      commitments: {
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { id: true, name: true, username: true, image: true } },
          option: { select: { id: true, text: true } },
        },
      },
      // The detail page refetches /api/forecasts/[id] on mount and overwrites the
      // SSR prediction, so this must carry externalMarket too — otherwise the linked
      // market (and its chart line) is wiped after first paint. Shape mirrors the
      // SSR loader in app/forecasts/[id]/page.tsx; `embedding` is deliberately excluded.
      externalMarket: {
        select: {
          provider: true,
          slug: true,
          url: true,
          question: true,
          resolved: true,
          snapshots: {
            orderBy: { createdAt: 'asc' },
            select: { createdAt: true, probability: true },
          },
        },
      },
      _count: { select: { commitments: true } },
    },
  })
}

export async function getPredictionOwnershipInfo(id: string) {
  return prisma.prediction.findUnique({
    where: { id },
    select: { authorId: true, status: true, lockedAt: true },
  })
}

export async function getPredictionBasicInfo(id: string) {
  return prisma.prediction.findUnique({
    where: { id },
    select: { id: true, claimText: true, authorId: true, slug: true },
  })
}

export async function getPredictionWithTags(id: string) {
  return prisma.prediction.findUnique({
    where: { id },
    select: { claimText: true, tags: { select: { name: true } } },
  })
}

export async function getUserCommitment(predictionId: string, userId: string) {
  return prisma.commitment.findFirst({
    where: { predictionId, userId },
    select: {
      id: true,
      cuCommitted: true,
      binaryChoice: true,
      optionId: true,
      createdAt: true,
      rsChange: true,
      brierScore: true,
      option: { select: { id: true, text: true } },
    },
  })
}

export interface UpdateForecastData {
  claimText?: string
  detailsText?: string | null
  resolutionRules?: string | null
  resolveByDatetime?: string
  isPublic?: boolean
  options?: string[]
}

export async function updateForecast(id: string, data: UpdateForecastData) {
  const translatableFieldsChanged =
    data.claimText || data.detailsText !== undefined || data.resolutionRules !== undefined
  if (translatableFieldsChanged) {
    await prisma.predictionTranslation.deleteMany({ where: { predictionId: id } })
  }

  return prisma.$transaction(async (tx) => {
    if (data.options) {
      await tx.predictionOption.deleteMany({ where: { predictionId: id } })
      await tx.predictionOption.createMany({
        data: data.options.map((text, index) => ({ predictionId: id, text, displayOrder: index })),
      })
    }

    return tx.prediction.update({
      where: { id },
      data: {
        claimText: data.claimText,
        detailsText: data.detailsText,
        resolutionRules: data.resolutionRules,
        resolveByDatetime: data.resolveByDatetime ? new Date(data.resolveByDatetime) : undefined,
        isPublic: data.isPublic,
      },
      include: {
        author: { select: { id: true, name: true, username: true, image: true } },
        newsAnchor: true,
        options: { orderBy: { displayOrder: 'asc' } },
      },
    })
  })
}

/**
 * Delete a prediction. Idempotent: if the record is already gone (e.g. a
 * double-click or concurrent delete), returns null instead of throwing, so the
 * route can answer 404 rather than surfacing a 500.
 */
export async function deleteForecast(id: string) {
  try {
    return await prisma.prediction.delete({ where: { id } })
  } catch (err) {
    if (isRecordNotFoundError(err)) return null
    throw err
  }
}

export async function publishForecast(id: string) {
  const now = new Date()
  const result = await prisma.prediction.update({
    where: { id },
    data: { status: 'ACTIVE', publishedAt: now },
    include: {
      author: { select: { id: true, name: true, username: true, image: true } },
      newsAnchor: true,
      options: { orderBy: { displayOrder: 'asc' } },
    },
  })
  if (result.isPublic) notifyIndexNow(result.slug ?? result.id)
  return result
}

export async function approveForecast(predictionId: string) {
  const now = new Date()
  const result = await prisma.prediction.update({
    where: { id: predictionId },
    data: { status: 'ACTIVE', publishedAt: now },
    include: {
      author: { select: { id: true, name: true, username: true, image: true, isBot: true } },
      options: { orderBy: { displayOrder: 'asc' } },
    },
  })
  if (result.isPublic) notifyIndexNow(result.slug ?? result.id)
  return result
}

export interface RejectForecastOptions {
  keywords: string[]
  description: string
  rejectorId: string
  authorId: string
}

export async function rejectForecast(predictionId: string, opts: RejectForecastOptions) {
  const now = new Date()
  const updated = await prisma.prediction.update({
    where: { id: predictionId },
    data: {
      status: 'VOID',
      resolutionOutcome: 'void',
      resolvedAt: now,
      resolutionNote: 'Rejected during approval workflow',
    },
    include: { author: { select: { id: true, name: true, username: true } } },
  })

  const botConfig = await prisma.botConfig.findUnique({ where: { userId: opts.authorId } })
  if (botConfig) {
    await prisma.botRejectedTopic.create({
      data: {
        botId: botConfig.id,
        keywords: opts.keywords,
        description: opts.description,
        rejectedById: opts.rejectorId,
      },
    })
  }

  return updated
}

export async function updateForecastStatus(id: string, status: string) {
  return prisma.prediction.update({
    where: { id },
    data: { status: status as 'DRAFT' | 'ACTIVE' | 'PENDING' | 'PENDING_APPROVAL' | 'RESOLVED_CORRECT' | 'RESOLVED_WRONG' | 'VOID' | 'UNRESOLVABLE' },
  })
}

// ── Admin queries ─────────────────────────────────────────────────────────────

export interface AdminForecastsQuery {
  search?: string
  page: number
  limit: number
}

export async function listAdminForecasts({ search, page, limit }: AdminForecastsQuery) {
  const where: Record<string, unknown> = {}
  if (search) {
    where.OR = [
      { claimText: { contains: search, mode: 'insensitive' } },
      { author: { name: { contains: search, mode: 'insensitive' } } },
      { author: { email: { contains: search, mode: 'insensitive' } } },
    ]
  }

  const [predictions, total] = await Promise.all([
    prisma.prediction.findMany({
      where,
      include: {
        author: { select: { name: true, email: true } },
        _count: { select: { commitments: true, comments: true } },
      },
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.prediction.count({ where }),
  ])

  return { predictions, total, pages: Math.ceil(total / limit) }
}

export async function listPendingApprovals({ page, limit }: { page: number; limit: number }) {
  const where = { status: 'PENDING_APPROVAL' as const }
  const [predictions, total] = await Promise.all([
    prisma.prediction.findMany({
      where,
      include: {
        author: { select: { id: true, name: true, username: true, email: true, image: true, isBot: true } },
        _count: { select: { commitments: true, comments: true } },
      },
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.prediction.count({ where }),
  ])

  return { predictions, total, pages: Math.ceil(total / limit) }
}

/** Fetch a prediction with its options — for the research route. */
export async function getForecastForResearch(id: string) {
  return prisma.prediction.findUnique({
    where: { id },
    include: { options: true },
  })
}

/** Find predictions that are missing resolution rules — for the backfill-rules admin route. */
export async function findPredictionsWithoutRules() {
  return prisma.prediction.findMany({
    where: { resolutionRules: null },
    select: { id: true, claimText: true, detailsText: true, outcomeType: true },
    orderBy: { createdAt: 'asc' },
  })
}

/** Set resolution rules on a single prediction — for the backfill-rules admin route. */
export async function updateForecastResolutionRules(id: string, rules: string) {
  return prisma.prediction.update({
    where: { id },
    data: { resolutionRules: rules },
  })
}
