import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-middleware'
import { apiError } from '@/lib/api-error'
import { revokeInvite } from '@/lib/services/invite'

export const DELETE = withAuth(async (_req, _user, { params }) => {
  const ok = await revokeInvite(params.id)
  if (!ok) return apiError('Invite not found', 404)
  return NextResponse.json({ ok: true })
}, { roles: ['ADMIN'] })
