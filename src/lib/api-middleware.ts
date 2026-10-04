import { NextRequest, NextResponse } from 'next/server'
import type { Session } from 'next-auth'
import { auth } from '@/auth'
import { apiError, handleRouteError } from '@/lib/api-error'
import { createLogger } from '@/lib/logger'
import { notifyServerError, notifySecurityError } from '@/lib/services/telegram'
import { recordValidationFailure, stuckUserRouteLabel } from '@/lib/services/stuck-user-alert'
import { z } from 'zod'
import type { UserRole } from '@prisma/client'
import type { AuthUser } from '@/lib/types/user'

export type { AuthUser }

const log = createLogger('api-middleware')

/** Route handler context with typed params (resolved). */
export interface RouteContext {
  params: Record<string, string>
}

/** Raw Next.js 15 context where params is always a Promise. */
interface RawRouteContext {
  params: Promise<Record<string, string>>
}

/** Options for the withAuth wrapper. */
interface WithAuthOptions {
  /** Allowed roles. If empty/undefined, any authenticated user is allowed. */
  roles?: UserRole[]
}

/**
 * Wrap a route handler with authentication and optional role checks.
 * Eliminates the auth() + null check + role check boilerplate.
 */
export function withAuth(
  handler: (
    request: NextRequest,
    user: AuthUser,
    context: RouteContext,
  ) => Promise<NextResponse | Response>,
  options?: WithAuthOptions,
) {
  return async (request: NextRequest, rawContext: RawRouteContext) => {
    let session: Session | null = null
    try {
      session = await auth()

      if (!session?.user?.id) {
        const pathname = request.nextUrl.pathname
        log.warn({ pathname }, 'Missing session in withAuth')
        notifySecurityError(pathname, 401, 'Unauthorized access attempt')
        return apiError('Unauthorized', 401)
      }

      const user = session.user as AuthUser

      if (options?.roles && options.roles.length > 0) {
        if (!options.roles.includes(user.role)) {
          const pathname = request.nextUrl.pathname
          notifySecurityError(pathname, 403, `Insufficient permissions (requires: ${options.roles.join(', ')})`, {
            id: user.id,
            email: user.email,
          })
          return apiError('Forbidden: Insufficient permissions', 403)
        }
      }

      const context: RouteContext = { params: await rawContext.params }
      const response = await handler(request, user, context)
      if (response.status === 400) await trackValidationFailure(request, user, response)
      return response
    } catch (error) {
      const pathname = request.nextUrl.pathname
      log.error({
        err: error,
        url: pathname,
        userId: session?.user?.id,
      }, 'API route error caught in withAuth middleware')
      // Notify TG for unexpected 500-level errors (not user input/auth errors)
      if (error instanceof Error && !(error instanceof z.ZodError)) {
        notifyServerError(pathname, error)
      }
      const response = handleRouteError(error)
      if (session?.user?.id && response.status === 400) {
        await trackValidationFailure(request, session.user as AuthUser, response)
      }
      return response
    }
  }
}

/** Feed 400s on the forecast create/publish path to the stuck-user detector (#1787).
 *  ZodErrors and handler-returned 400s are both user-input failures that never
 *  reach notifyServerError, so repeated ones would otherwise go unseen. */
async function trackValidationFailure(request: NextRequest, user: AuthUser, response: Response): Promise<void> {
  const route = stuckUserRouteLabel(request.method, request.nextUrl.pathname)
  if (!route) return
  let issue = 'HTTP 400'
  try {
    const body = await response.clone().json() as { error?: unknown; details?: Array<{ path?: unknown[]; message?: unknown }> }
    const first = body.details?.[0]
    issue = first
      ? `${(first.path ?? []).join('.') || '(root)'}: ${String(first.message)}`
      : typeof body.error === 'string' ? body.error : issue
  } catch {
    // Non-JSON 400 body — keep the generic label.
  }
  recordValidationFailure({ user, route, issue })
}
