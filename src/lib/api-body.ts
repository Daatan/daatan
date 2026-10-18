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
