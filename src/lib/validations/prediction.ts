import { z } from 'zod'

// ============================================
// NEWS ANCHOR SCHEMAS
// ============================================

export const createNewsAnchorSchema = z.object({
  url: z.string().url('Invalid URL'),
  title: z.string().min(1).max(500),
  source: z.string().max(200).optional(),
  publishedAt: z.string().datetime().optional(),
  snippet: z.string().max(1000).optional(),
  imageUrl: z.string().url().optional(),
})

// ============================================
// PREDICTION SCHEMAS
// ============================================

export const outcomePayloadSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('BINARY'),
  }),
  z.object({
    type: z.literal('MULTIPLE_CHOICE'),
    options: z.array(z.string().min(1).max(500)).min(2).max(10),
  }),
  z.object({
    type: z.literal('NUMERIC_THRESHOLD'),
    metric: z.string().min(1).max(200),
    threshold: z.number(),
    direction: z.enum(['above', 'below', 'exactly']),
    source: z.string().max(500).optional(),
  }),
])

export const createPredictionSchema = z.object({
  // News anchor (optional)
  newsAnchorId: z.string().cuid().optional(),
  newsAnchorUrl: z.string().url().optional(), // Alternative: create anchor from URL
  newsAnchorTitle: z.string().max(500).optional(), // Title when creating from URL

  // Prediction content
  claimText: z.string().min(10, 'Claim must be at least 10 characters').max(500),
  detailsText: z.string().max(5000).optional(),

  // Outcome definition
  outcomeType: z.enum(['BINARY', 'MULTIPLE_CHOICE', 'NUMERIC_THRESHOLD']),
  outcomePayload: z.record(z.string(), z.unknown()).optional(),

  // Resolution (resolutionRules optional for drafts — enforced at publish time)
  resolutionRules: z.string().min(10, 'Resolution rules must be at least 10 characters').max(2000).optional(),
  resolveByDatetime: z.string().datetime(),

  // Tags (0-5 tags from STANDARD_TAGS)
  tags: z.array(z.string().min(1).max(50)).max(5).optional(),

  // Visibility
  isPublic: z.boolean().optional().default(true),

  // Source tracking
  source: z.literal('manual').optional(),

  // AI confidence estimate (0–100), set at creation by express flow or bots
  confidence: z.number().int().min(0).max(100).optional(),

  // External market link, set when the forecast was imported from a PM/Kalshi URL
  externalMarketId: z.string().cuid().optional(),
}).superRefine((data, ctx) => {
  const payload = data.outcomePayload as Record<string, unknown> | undefined

  if (data.outcomeType === 'MULTIPLE_CHOICE') {
    const options = payload?.options
    if (!Array.isArray(options) || options.length < 2 || options.length > 10) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'MULTIPLE_CHOICE requires 2–10 options',
        path: ['outcomePayload', 'options'],
      })
    } else if (options.some((o) => typeof o !== 'string' || o.length === 0 || o.length > 500)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Each option must be a non-empty string (max 500 chars)',
        path: ['outcomePayload', 'options'],
      })
    }
  }

  if (data.outcomeType === 'NUMERIC_THRESHOLD') {
    if (!payload?.metric || typeof payload.metric !== 'string' || payload.metric.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'NUMERIC_THRESHOLD requires a metric string', path: ['outcomePayload', 'metric'] })
    }
    if (payload?.threshold === undefined || typeof payload.threshold !== 'number') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'NUMERIC_THRESHOLD requires a numeric threshold', path: ['outcomePayload', 'threshold'] })
    }
    if (!payload?.direction || !['above', 'below', 'exactly'].includes(payload.direction as string)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'NUMERIC_THRESHOLD direction must be above, below, or exactly', path: ['outcomePayload', 'direction'] })
    }
  }
})

export const updatePredictionSchema = z.object({
  claimText: z.string().min(10).max(500).optional(),
  detailsText: z.string().max(5000).optional().nullable(),
  outcomePayload: z.record(z.string(), z.unknown()).optional(),
  resolutionRules: z.string().max(2000).optional().nullable(),
  resolveByDatetime: z.string().datetime().optional(),
  tags: z.array(z.string().min(1).max(50)).max(5).optional(),
  isPublic: z.boolean().optional(),
})

// ============================================
// COMMITMENT SCHEMAS
// ============================================

export const createCommitmentSchema = z.object({
  // -100..100 for BINARY (sign = direction, magnitude = certainty)
  //    0..100 for MULTIPLE_CHOICE (direction encoded by optionId)
  confidence: z.number().int().min(-100).max(100),
  // Required for MULTIPLE_CHOICE predictions
  optionId: z.string().cuid().optional(),
})

export const updateCommitmentSchema = z.object({
  confidence: z.number().int().min(-100).max(100).optional(),
  optionId: z.string().cuid().optional(),
}).refine(
  (data) => Object.keys(data).length > 0,
  { message: 'Must provide at least one field to update' }
)

export const listCommitmentsQuerySchema = z.object({
  predictionId: z.string().cuid().optional(),
  status: z.enum(['ACTIVE', 'PENDING', 'RESOLVED_CORRECT', 'RESOLVED_WRONG', 'VOID', 'UNRESOLVABLE']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

// ============================================
// RESOLUTION SCHEMAS
// ============================================

export const resolvePredictionSchema = z.object({
  outcome: z.enum(['correct', 'wrong', 'void', 'unresolvable']),
  evidenceLinks: z.array(z.string().url()).optional(),
  resolutionNote: z.string().max(2000).optional(),
  // For multiple choice: which option was correct
  correctOptionId: z.string().cuid().optional(),
})

export const rejectForecastSchema = z.object({
  keywords: z.array(z.string().min(1).max(100)).max(20).optional(),
  description: z.string().max(500).optional(),
})

// ============================================
// QUERY SCHEMAS
// ============================================

export const listPredictionsQuerySchema = z.object({
  status: z.enum(['DRAFT', 'ACTIVE', 'PENDING', 'PENDING_APPROVAL', 'RESOLVED_CORRECT', 'RESOLVED_WRONG', 'VOID', 'UNRESOLVABLE']).optional(),
  authorId: z.string().cuid().optional(),
  tags: z.string().max(500).optional(), // Comma-separated tag names for filtering
  q: z.string().max(200).optional(), // Full-text search on claimText and tags
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z.enum(['newest', 'deadline', 'cu', 'updated']).default('newest'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
})

// ============================================
// TYPE EXPORTS
// ============================================

export type CreateNewsAnchorInput = z.infer<typeof createNewsAnchorSchema>
export type CreatePredictionInput = z.infer<typeof createPredictionSchema>
export type UpdatePredictionInput = z.infer<typeof updatePredictionSchema>
export type CreateCommitmentInput = z.infer<typeof createCommitmentSchema>
export type UpdateCommitmentInput = z.infer<typeof updateCommitmentSchema>
export type ListCommitmentsQuery = z.infer<typeof listCommitmentsQuerySchema>
export type ResolvePredictionInput = z.infer<typeof resolvePredictionSchema>
export type RejectForecastInput = z.infer<typeof rejectForecastSchema>
export type ListPredictionsQuery = z.infer<typeof listPredictionsQuerySchema>

