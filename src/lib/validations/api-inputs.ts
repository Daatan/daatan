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
