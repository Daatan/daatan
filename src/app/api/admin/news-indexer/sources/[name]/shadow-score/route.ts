import { NextResponse } from 'next/server'
import { handleRouteError } from '@/lib/api-error'
import { withAuth } from '@/lib/api-middleware'
import { getAuthorShadowRowsForOutlet } from '@/lib/services/sourceLeaderboard'

/** Admin-only: this outlet's rows on retro's author-shadow scoring board (retro PR #315),
 *  for the "Author scoring" section of the outlet detail page. Fails open to `[]` — the
 *  underlying service never throws on a misconfigured/unreachable Oracul. */
export const GET = withAuth(async (_request, _user, { params }) => {
  try {
    const rows = await getAuthorShadowRowsForOutlet(params.name)
    return NextResponse.json({ rows })
  } catch (error) {
    return handleRouteError(error, 'Failed to fetch outlet author scoring')
  }
}, { roles: ['ADMIN'] })
