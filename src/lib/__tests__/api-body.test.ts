import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'

vi.mock('@/lib/services/notification', () => ({
  NOTIFICATION_TYPE_DEFAULTS: { PREDICTION_RESOLVED: { inApp: true } },
}))

import { parseJsonBody, parseOptionalJsonBody } from '@/lib/api-body'
import { handleRouteError } from '@/lib/api-error'
import {
  notificationPreferenceSchema,
  translateBodySchema,
  suggestTagsBodySchema,
  requoteBodySchema,
  retireLegacyNullBodySchema,
  remediateBodySchema,
  republishBodySchema,
  backfillTemporalBodySchema,
  forwardedObjectBodySchema,
  userPreferencesSchema,
} from '@/lib/validations/api-inputs'

const req = (body: string) => new Request('http://localhost/x', { method: 'POST', body })

describe('parseJsonBody', () => {
  it('returns the parsed, validated body', async () => {
    await expect(parseJsonBody(req('{"a":1}'), z.object({ a: z.number() }))).resolves.toEqual({ a: 1 })
  })

  it('maps malformed JSON to a 400 (ZodError), not a 500', async () => {
    const err = await parseJsonBody(req('{nope'), z.object({})).catch((e) => e)
    expect(err).toBeInstanceOf(z.ZodError)
    expect(handleRouteError(err).status).toBe(400)
  })

  it('maps a null body to a 400', async () => {
    const err = await parseJsonBody(req('null'), z.object({ a: z.number() })).catch((e) => e)
    expect(handleRouteError(err).status).toBe(400)
  })
})

describe('notificationPreferenceSchema', () => {
  it('accepts a known type with boolean flags', () => {
    expect(notificationPreferenceSchema.parse({ type: 'PREDICTION_RESOLVED', email: false }).type).toBe('PREDICTION_RESOLVED')
  })

  it.each(['constructor', '__proto__', 'toString', 'NOPE'])('rejects %s', (type) => {
    expect(notificationPreferenceSchema.safeParse({ type }).success).toBe(false)
  })

  it('rejects non-boolean flags', () => {
    expect(notificationPreferenceSchema.safeParse({ type: 'PREDICTION_RESOLVED', inApp: 'yes' }).success).toBe(false)
  })
})

describe('translateBodySchema', () => {
  it('accepts supported locales only', () => {
    expect(translateBodySchema.safeParse({ language: 'ru' }).success).toBe(true)
    expect(translateBodySchema.safeParse({ language: 'fr' }).success).toBe(false)
    expect(translateBodySchema.safeParse({}).success).toBe(false)
  })
})

describe('suggestTagsBodySchema', () => {
  it('requires a non-empty string claim', () => {
    expect(suggestTagsBodySchema.safeParse({ claim: '  ' }).success).toBe(false)
    expect(suggestTagsBodySchema.safeParse({ claim: { a: 1 } }).success).toBe(false)
    expect(suggestTagsBodySchema.safeParse({ claim: 'BTC > 100k' }).success).toBe(true)
  })

  it('caps claim and details length', () => {
    expect(suggestTagsBodySchema.safeParse({ claim: 'x'.repeat(501) }).success).toBe(false)
    expect(suggestTagsBodySchema.safeParse({ claim: 'ok', details: 'x'.repeat(5001) }).success).toBe(false)
  })
})

describe('parseOptionalJsonBody', () => {
  const schema = z.object({ mode: z.enum(['dry-run', 'apply']).optional() })

  it('treats an absent or blank body as {}', async () => {
    await expect(parseOptionalJsonBody(req(''), schema)).resolves.toEqual({})
    await expect(parseOptionalJsonBody(req('  \n'), schema)).resolves.toEqual({})
    await expect(parseOptionalJsonBody(new Request('http://localhost/x', { method: 'POST' }), schema)).resolves.toEqual({})
  })

  it('still validates a present body', async () => {
    await expect(parseOptionalJsonBody(req('{"mode":"apply"}'), schema)).resolves.toEqual({ mode: 'apply' })
    const err = await parseOptionalJsonBody(req('{"mode":"yolo"}'), schema).catch((e) => e)
    expect(handleRouteError(err).status).toBe(400)
  })

  it('rejects malformed JSON instead of falling back to the defaults', async () => {
    const err = await parseOptionalJsonBody(req('{nope'), schema).catch((e) => e)
    expect(err).toBeInstanceOf(z.ZodError)
    expect(handleRouteError(err).status).toBe(400)
  })
})

describe('admin / cron body schemas', () => {
  it('userPreferencesSchema requires a boolean showAiPanel', () => {
    expect(userPreferencesSchema.safeParse({ showAiPanel: false }).success).toBe(true)
    expect(userPreferencesSchema.safeParse({ showAiPanel: 'no' }).success).toBe(false)
    expect(userPreferencesSchema.safeParse({}).success).toBe(false)
  })

  it('requoteBodySchema accepts the workflow payload and an empty body, rejects bad types', () => {
    expect(requoteBodySchema.safeParse({ archetypes: ['diffuse'], dryRun: false }).success).toBe(true)
    expect(requoteBodySchema.safeParse({ archetypes: [] }).success).toBe(true)
    expect(requoteBodySchema.safeParse({}).success).toBe(true)
    expect(requoteBodySchema.safeParse({ archetypes: 'diffuse' }).success).toBe(false)
    expect(requoteBodySchema.safeParse({ dryRun: 'true' }).success).toBe(false)
  })

  it('retireLegacyNullBodySchema defaults to no mode and rejects unknown modes', () => {
    expect(retireLegacyNullBodySchema.parse({})).toEqual({})
    expect(retireLegacyNullBodySchema.safeParse({ mode: 'apply' }).success).toBe(true)
    expect(retireLegacyNullBodySchema.safeParse({ mode: 'nuke' }).success).toBe(false)
  })

  it('remediateBodySchema enforces non-empty ids, the cap, mode and scope', () => {
    const s = remediateBodySchema(2)
    expect(s.safeParse({ ids: ['a'], mode: 'apply', scope: 'usable' }).success).toBe(true)
    expect(s.safeParse({}).success).toBe(false)
    expect(s.safeParse({ ids: [] }).success).toBe(false)
    expect(s.safeParse({ ids: ['a', 'b', 'c'] }).success).toBe(false)
    expect(s.safeParse({ ids: [''] }).success).toBe(false)
    expect(s.safeParse({ ids: ['a'], scope: 'everything' }).success).toBe(false)
  })

  it('republishBodySchema enforces non-empty forecastIds, the cap and mode', () => {
    const s = republishBodySchema(1)
    expect(s.safeParse({ forecastIds: ['a'] }).success).toBe(true)
    expect(s.safeParse({ forecastIds: [] }).success).toBe(false)
    expect(s.safeParse({ forecastIds: ['a', 'b'] }).success).toBe(false)
    expect(s.safeParse({ forecastIds: ['a'], mode: 'x' }).success).toBe(false)
  })

  it('backfillTemporalBodySchema requires mode (no safe default)', () => {
    expect(backfillTemporalBodySchema.safeParse({}).success).toBe(false)
    expect(backfillTemporalBodySchema.safeParse({ mode: 'dry-run', limit: 5, force: true }).success).toBe(true)
    expect(backfillTemporalBodySchema.safeParse({ mode: 'apply', ids: 'a' }).success).toBe(false)
  })

  it('forwardedObjectBodySchema keeps unknown keys but rejects non-objects', () => {
    expect(forwardedObjectBodySchema.parse({ name: 'x', extra: 1 })).toEqual({ name: 'x', extra: 1 })
    expect(forwardedObjectBodySchema.safeParse([]).success).toBe(false)
    expect(forwardedObjectBodySchema.safeParse(null).success).toBe(false)
    expect(forwardedObjectBodySchema.safeParse('x').success).toBe(false)
  })
})
