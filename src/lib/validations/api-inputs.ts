import { z } from 'zod'
import { locales } from '@/i18n/config'
import { NOTIFICATION_TYPE_DEFAULTS } from '@/lib/services/notification'
import type { NotificationType } from '@prisma/client'

/** PATCH /api/notifications/preferences. `type` is checked with hasOwn so inherited keys
 *  like "constructor" cannot pass the lookup. */
export const notificationPreferenceSchema = z.object({
  type: z
    .string()
    .refine((t) => Object.hasOwn(NOTIFICATION_TYPE_DEFAULTS, t), 'Invalid notification type')
    .transform((t) => t as NotificationType),
  inApp: z.boolean().optional(),
  email: z.boolean().optional(),
  browserPush: z.boolean().optional(),
})

/** POST /api/forecasts/[id]/translate and /api/comments/[id]/translate. */
export const translateBodySchema = z.object({
  language: z.enum(locales),
})

/** POST /api/ai/suggest-tags. Limits mirror the forecast create schema (claim 500, details 5000). */
export const suggestTagsBodySchema = z.object({
  claim: z.string().trim().min(1, 'Claim is required').max(500),
  details: z.string().max(5000).optional(),
})

const runMode = z.enum(['dry-run', 'apply'])

/** PATCH /api/user/preferences. */
export const userPreferencesSchema = z.object({ showAiPanel: z.boolean() })

/** POST /api/cron/requote. Empty `archetypes` is a deliberate no-op (see requote.yml). */
export const requoteBodySchema = z.object({
  archetypes: z.array(z.string()).optional(),
  dryRun: z.boolean().optional(),
})

/** POST /api/admin/evidence-pool/retire-legacy-null. Absent mode = dry run. */
export const retireLegacyNullBodySchema = z.object({ mode: runMode.optional() })

/** POST /api/admin/evidence-pool/remediate. `maxIds` is the per-call cap of the route. */
export const remediateBodySchema = (maxIds: number) =>
  z.object({
    ids: z.array(z.string().min(1)).min(1, 'ids must be a non-empty array of prediction ids').max(maxIds, `at most ${maxIds} ids per call`),
    mode: runMode.optional(),
    scope: z.enum(['a6', 'usable', 'amnesty']).optional(),
  })

/** POST /api/admin/forecasts/republish. */
export const republishBodySchema = (maxIds: number) =>
  z.object({
    forecastIds: z
      .array(z.string().min(1))
      .min(1, 'forecastIds must be a non-empty array of prediction ids')
      .max(maxIds, `at most ${maxIds} forecastIds per call`),
    mode: runMode.optional(),
  })

/** POST /api/admin/forecasts/backfill-temporal. `mode` is required: there is no safe default. */
export const backfillTemporalBodySchema = z.object({
  mode: runMode,
  limit: z.number().optional(),
  ids: z.array(z.string()).optional(),
  skipIds: z.array(z.string()).optional(),
  force: z.boolean().optional(),
})

/** news-indexer author admin proxies: the body is forwarded as-is, upstream owns the field checks. */
export const forwardedObjectBodySchema = z.object({}).passthrough()
