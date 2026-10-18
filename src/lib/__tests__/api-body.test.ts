import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'

vi.mock('@/lib/services/notification', () => ({
  NOTIFICATION_TYPE_DEFAULTS: { PREDICTION_RESOLVED: { inApp: true } },
}))

import { parseJsonBody } from '@/lib/api-body'
import { handleRouteError } from '@/lib/api-error'
import {
  notificationPreferenceSchema,
  translateBodySchema,
  suggestTagsBodySchema,
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
