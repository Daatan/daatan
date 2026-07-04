import { SchemaType, type Schema } from '@google/generative-ai'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { Prisma, ClaimDirection, ClaimArchetype } from '@prisma/client'
import { getPromptTemplate, fillPrompt } from '@/lib/llm/bedrock-prompts'
import { llmService } from '@/lib/llm'
import { createLogger } from '@/lib/logger'

const log = createLogger('temporal-classifier')

/** Bump whenever the prompt text materially changes, in the same change. */
export const CLASSIFIER_VERSION = 'v1'

const CLASSIFY_TIMEOUT_MS = 15_000

export const temporalClassifierSchema: Schema = {
  description: 'Temporal classification of a forecast claim',
  type: SchemaType.OBJECT,
  properties: {
    claim_deadline: {
      type: SchemaType.STRING,
      description: 'ISO date (YYYY-MM-DD) the claim text implies, or null if none',
      nullable: true,
    },
    direction: {
      type: SchemaType.STRING,
      description: 'arrival | survival | none',
    },
    archetype: {
      type: SchemaType.STRING,
      description: 'diffuse | scheduled | threshold | none',
    },
    tau_lead_days: {
      type: SchemaType.NUMBER,
      description: 'Mandatory lead-time days before the deadline, 0 if none',
    },
    confidence: {
      type: SchemaType.NUMBER,
      description: '0..1 confidence in the classification',
    },
    notes: {
      type: SchemaType.STRING,
      description: 'One sentence for a human auditor',
    },
  },
  required: ['direction', 'archetype', 'tau_lead_days', 'confidence', 'notes'],
}

const rawClassificationSchema = z.object({
  claim_deadline: z.string().nullable().optional(),
  direction: z.enum(['arrival', 'survival', 'none']),
  archetype: z.enum(['diffuse', 'scheduled', 'threshold', 'none']),
  tau_lead_days: z.number().int().nonnegative(),
  confidence: z.number().min(0).max(1),
  notes: z.string(),
})

export interface TemporalClassification {
  direction: 'arrival' | 'survival' | 'none'
  archetype: 'diffuse' | 'scheduled' | 'threshold' | 'none'
  /** Normalized to 23:59:59.999 UTC of the extracted day, or null. */
  claimDeadline: Date | null
  tauLeadDays: number
  confidence: number
  notes: string
}

const DIRECTION_MAP: Record<TemporalClassification['direction'], ClaimDirection> = {
  arrival: ClaimDirection.ARRIVAL,
  survival: ClaimDirection.SURVIVAL,
  none: ClaimDirection.NONE,
}

const ARCHETYPE_MAP: Record<TemporalClassification['archetype'], ClaimArchetype> = {
  diffuse: ClaimArchetype.DIFFUSE,
  scheduled: ClaimArchetype.SCHEDULED,
  threshold: ClaimArchetype.THRESHOLD,
  none: ClaimArchetype.NONE,
}

/** A date-only YYYY-MM-DD string, fixed to end-of-day UTC (the one place this
 *  convention is decided). Rejects malformed or implausibly distant dates. */
function normalizeDeadline(raw: string | null | undefined): Date | null {
  if (!raw) return null
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim())
  if (!match) return null
  const date = new Date(`${raw.trim()}T23:59:59.999Z`)
  if (Number.isNaN(date.getTime())) return null
  const yearsOut = (date.getTime() - Date.now()) / (365 * 24 * 3600_000)
  if (yearsOut > 30 || yearsOut < -30) return null
  return date
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('classification timed out')), ms)),
  ])
}

/**
 * Classify a claim's temporal structure with one LLM call. Fail-open: returns
 * null on any failure (LLM down, malformed output, timeout) rather than
 * throwing — the forecast is simply left unclassified and picked up later by
 * the requote cron's self-heal pass.
 */
export async function classifyClaim(input: {
  claimText: string
  resolveByDatetime: Date
}): Promise<TemporalClassification | null> {
  try {
    const template = await getPromptTemplate('temporal-classifier')
    const prompt = fillPrompt(template, {
      resolveByDatetime: input.resolveByDatetime.toISOString(),
      currentDate: new Date().toISOString(),
      claimText: input.claimText,
    })

    const response = await withTimeout(
      llmService.generateContent({ prompt, schema: temporalClassifierSchema, temperature: 0 }),
      CLASSIFY_TIMEOUT_MS,
    )

    const raw = rawClassificationSchema.parse(JSON.parse(response.text))

    return {
      direction: raw.direction,
      archetype: raw.archetype,
      claimDeadline: normalizeDeadline(raw.claim_deadline),
      tauLeadDays: raw.tau_lead_days,
      confidence: raw.confidence,
      notes: raw.notes,
    }
  } catch (err) {
    log.warn({ err, claimText: input.claimText.substring(0, 100) }, 'Temporal classification failed')
    return null
  }
}

export interface ClassifyAndStoreInput {
  id: string
  claimText: string
  resolveByDatetime: Date
  outcomeType: string
}

/**
 * Classify a claim and persist the result onto its Prediction row. Non-BINARY
 * forecasts (the glide only ever prices BINARY claims) short-circuit to
 * archetype/direction NONE without an LLM call, but still stamp a version so
 * the self-heal pass doesn't retry them forever.
 */
export async function classifyAndStoreTemporal(
  input: ClassifyAndStoreInput,
): Promise<TemporalClassification | null> {
  if (input.outcomeType !== 'BINARY') {
    await prisma.prediction.update({
      where: { id: input.id },
      data: {
        claimDirection: ClaimDirection.NONE,
        claimArchetype: ClaimArchetype.NONE,
        classifierVersion: CLASSIFIER_VERSION,
        classifiedAt: new Date(),
      },
    })
    return null
  }

  const result = await classifyClaim(input)
  if (!result) return null

  await prisma.prediction.update({
    where: { id: input.id },
    data: {
      claimDeadline: result.claimDeadline,
      claimDirection: DIRECTION_MAP[result.direction],
      claimArchetype: ARCHETYPE_MAP[result.archetype],
      tauLeadDays: result.tauLeadDays,
      classifierVersion: CLASSIFIER_VERSION,
      classifiedAt: new Date(),
      classifierOutput: {
        direction: result.direction,
        archetype: result.archetype,
        claimDeadline: result.claimDeadline?.toISOString() ?? null,
        tauLeadDays: result.tauLeadDays,
        confidence: result.confidence,
        notes: result.notes,
      } satisfies Prisma.InputJsonValue,
    },
  })

  return result
}
