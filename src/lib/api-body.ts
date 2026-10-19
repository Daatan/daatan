import { z } from 'zod'

/**
 * Read a request's JSON body and validate it against a zod schema.
 * Malformed JSON surfaces as a ZodError (-> 400 via handleRouteError) instead of a
 * SyntaxError, which would be a 500 and, under withAuth, a server-error Telegram alert.
 */
export async function parseJsonBody<S extends z.ZodType>(
  request: Request,
  schema: S,
): Promise<z.infer<S>> {
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    throw new z.ZodError([{ code: 'custom', path: [], message: 'Request body must be valid JSON', input: undefined }])
  }
  return schema.parse(raw)
}

/**
 * Like parseJsonBody, but an absent body counts as `{}` so a schema of optional fields (admin and
 * cron triggers that default to a dry run) can be called with no payload. A body that is present
 * but not valid JSON is still rejected rather than silently falling back to the defaults.
 */
export async function parseOptionalJsonBody<S extends z.ZodType>(
  request: Request,
  schema: S,
): Promise<z.infer<S>> {
  const text = await request.text()
  if (text.trim() === '') return schema.parse({})
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new z.ZodError([{ code: 'custom', path: [], message: 'Request body must be valid JSON', input: undefined }])
  }
  return schema.parse(raw)
}
