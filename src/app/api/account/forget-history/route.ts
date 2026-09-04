import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-middleware'
import { apiError } from '@/lib/api-error'
import { forgetHistory } from '@/lib/services/user'

export const POST = withAuth(async (_request, user) => {
  const result = await forgetHistory(user.id)
  if (!result.ok) return apiError(result.error, result.status)
  return NextResponse.json({ ok: true })
})
