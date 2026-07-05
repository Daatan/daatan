import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createLogger } from '@/lib/logger'
import { notifyResourceNotFound, notifySecurityError } from '@/lib/services/telegram'

const log = createLogger('api-error')

/**
 * Standard API error response shape:
 * { error: string, details?: Array<{ path, message }> }
 *
 * - `error` is always a human-readable string
 * - `details` is only present for validation errors (Zod)
 */

interface ValidationDetail {
  path: PropertyKey[]
  message: string
}

interface ApiErrorBody {
  error: string
  details?: ValidationDetail[]
}

/** Return a standardised JSON error response. */
export function apiError(
  message: string,
  status: number,
  details?: ValidationDetail[],
  options?: { notify?: boolean; pathname?: string }
): NextResponse<ApiErrorBody> {
  if (options?.notify && options.pathname) {
    if (status === 404) {
      notifyResourceNotFound(options.pathname, message)
    } else if (status === 403 || status === 401) {
      notifySecurityError(options.pathname, status, message)
    }
  }
  return NextResponse.json({ error: message, details }, { status })
}

/**
 * Handle caught errors at the end of a route handler.
 * - ZodError → 400 with field-level details
 * - Everything else → 500 with generic message
 * - In staging: include error details for debugging
 */
export function handleRouteError(
  error: unknown,
  fallbackMessage = 'Internal server error',
): NextResponse<ApiErrorBody> {
  if (error instanceof z.ZodError) {
    const details = error.issues.map((i) => ({
      path: i.path,
      message: i.message,
    }))

    // Create a more descriptive error message: "Validation failed: path (message)"
    const firstIssue = details[0]
    let detailedMessage = 'Validation failed'
    if (firstIssue) {
      const pathStr = firstIssue.path.join('.')
      detailedMessage = `Validation failed: ${pathStr ? pathStr + ' ' : ''}(${firstIssue.message})`
    }

    return NextResponse.json(
      {
        error: detailedMessage,
        details,
      },
      { status: 400 },
    )
  }

  // Prisma unique-constraint violation → 409 (e.g. a double-submit racing the
  // existence check). Duck-typed to avoid importing the Prisma error class.
  if (error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'P2002') {
    return NextResponse.json({ error: 'This resource already exists' }, { status: 409 })
  }

  log.error({ err: error }, fallbackMessage)

  // Include error details in staging for easier debugging. APP_ENV, not
  // NEXT_PUBLIC_ENV: staging runs the same promoted Docker image as
  // production, so this must read the runtime instance var — see src/env.ts.
  const isStaging = process.env.APP_ENV === 'staging'
  const body: ApiErrorBody = { error: fallbackMessage }
  if (isStaging && error instanceof Error) {
    body.details = [{ path: [], message: error.message }]
  }

  return NextResponse.json(body, { status: 500 })
}
