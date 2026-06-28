import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-middleware'
import { env } from '@/env'
import { createInvite, listInvites } from '@/lib/services/invite'

export const GET = withAuth(async () => {
  return NextResponse.json({ invites: await listInvites() })
}, { roles: ['ADMIN'] })

export const POST = withAuth(async () => {
  const { id, rawToken, createdAt } = await createInvite()
  const base = (env.APP_URL || env.NEXTAUTH_URL).replace(/\/$/, '')
  const url = `${base}/auth/signup?invite=${rawToken}`
  return NextResponse.json({ id, url, createdAt }, { status: 201 })
}, { roles: ['ADMIN'] })
