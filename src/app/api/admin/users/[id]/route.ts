import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-middleware'
import { z } from 'zod'
import { updateUserRole } from '@/lib/services/user'

const updateUserSchema = z.object({
  role: z.enum(['USER', 'RESOLVER', 'APPROVER', 'ADMIN']),
})

export const PATCH = withAuth(async (req, user, { params }) => {
  const { id } = params

  if (user.id === id) {
    return NextResponse.json({ error: 'Cannot modify your own roles' }, { status: 400 })
  }

  const body = await req.json()
  const result = updateUserSchema.safeParse(body)
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }

  const updatedUser = await updateUserRole(id, result.data.role)

  return NextResponse.json(updatedUser)
}, { roles: ['ADMIN'] })
